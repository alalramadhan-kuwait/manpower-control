-- Annual vacation planning: allocation, vacation periods, approval and publishing to the Calendar.
-- Runs as a Manpower Coordinator, the Section Head and anon inside ONE transaction that always rolls back (the block
-- ends with an exception carrying the results), so no record changes. Uses a far plan year (2031) so the real 2027
-- draft is never touched. Run with the Supabase SQL editor or execute_sql. Expected: every line PASS.
do $$
declare
  y int := 2031;
  head uuid := (select auth_user_id from public.user_profiles where role_code = 'section_head' and is_active limit 1);
  coord uuid := (select auth_user_id from public.user_profiles where role_code = 'manpower_coordinator' and is_active limit 1);
  e1 uuid := (select id from public.employee_directory_v where in_unit12_scope and is_active and position_code = 'field_operator' order by id limit 1);
  e2 uuid := (select id from public.employee_directory_v where in_unit12_scope and is_active and position_code = 'field_operator' order by id offset 1 limit 1);
  m1 date := (select d::date from generate_series(make_date(y, 1, 1), make_date(y, 1, 31), interval '1 day') d where public.pv_is_m1('A', d::date) limit 1);
  pv26_before text := (select md5(coalesce(string_agg(id::text || status || updated_at::text, ',' order by id), '')) from public.leave_records where plan_year = 2026);
  pl27_before text := (select status || ':' || version from public.pv_plans where year = 2027);
  ev uuid; chk uuid; n int; n2 int; c text; out text := '';
  -- run a statement as a user; report PASS when it succeeds (want_ok) or is refused (not want_ok)
begin
  -- ── Coordinator prepares ──
  perform set_config('request.jwt.claims', json_build_object('sub', coord, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.pv_alloc_init(y, jsonb_build_array(jsonb_build_object('employee_id', e1, 'grp', 'field', 'crew', 'A'), jsonb_build_object('employee_id', e2, 'grp', 'field', 'crew', 'B')));
    out := out || 'PASS coordinator starts the allocation' || E'\n';
  exception when others then out := out || 'FAIL alloc init: ' || sqlerrm || E'\n'; end;
  begin ev := public.pv_alloc_set(y, e1, 'field', 'C', null, null, 'auto');
    select r.crew into c from public.pv_alloc_rows r join public.pv_allocs a on a.id = r.alloc_id where a.year = y and r.employee_id = e1;
    out := out || case when c = 'C' then 'PASS' else 'FAIL' end || ' move to another shift' || E'\n';
    perform public.pv_alloc_undo(y, ev);
    select r.crew into c from public.pv_alloc_rows r join public.pv_allocs a on a.id = r.alloc_id where a.year = y and r.employee_id = e1;
    out := out || case when c = 'A' then 'PASS' else 'FAIL' end || ' undo puts the person back' || E'\n';
    perform public.pv_alloc_switch(y, e1, e2);
    select r.crew into c from public.pv_alloc_rows r join public.pv_allocs a on a.id = r.alloc_id where a.year = y and r.employee_id = e1;
    out := out || case when c = 'B' then 'PASS' else 'FAIL' end || ' switch two people' || E'\n';
    perform public.pv_alloc_undo(y);
  exception when others then out := out || 'FAIL set / undo / switch: ' || sqlerrm || E'\n'; end;
  select count(*) into n from public.pv_alloc_events ev2 join public.pv_allocs a on a.id = ev2.alloc_id where a.year = y;
  out := out || case when n = 5 then 'PASS' else 'FAIL' end || ' every change is in the history (' || n || ')' || E'\n';
  execute 'reset role';
  insert into public.pv_server_checks (kind, year, fingerprint, ok, created_for) values ('alloc', y, public.pv_alloc_fingerprint(y), true, coord) returning id into chk;
  execute 'set local role authenticated';
  begin perform public.pv_alloc_approve_checked(chk); out := out || 'FAIL coordinator approved the allocation' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS coordinator cannot approve the allocation' || E'\n'; end;
  begin perform public.pv_draft_set(y, e1, '[]'::jsonb); out := out || 'FAIL vacations before the allocation is approved' || E'\n';
  exception when others then out := out || 'PASS no vacations before the allocation is approved' || E'\n'; end;
  execute 'reset role';

  -- ── Section Head approves the allocation (only on a fresh check of exactly this allocation) ──
  insert into public.pv_server_checks (kind, year, fingerprint, ok, created_for) values ('alloc', y, 'stale', true, head) returning id into chk;
  perform set_config('request.jwt.claims', json_build_object('sub', head, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.pv_alloc_approve_checked(chk); out := out || 'FAIL approval on a stale check' || E'\n';
  exception when others then out := out || case when sqlerrm like 'STALE_CHECK%' then 'PASS' else 'FAIL' end || ' approval on a stale check refused' || E'\n'; end;
  execute 'reset role';
  insert into public.pv_server_checks (kind, year, fingerprint, ok, created_for, result) values ('alloc', y, public.pv_alloc_fingerprint(y), false, head, '{"reason":"test"}') returning id into chk;
  execute 'set local role authenticated';
  begin perform public.pv_alloc_approve_checked(chk); out := out || 'FAIL approval with blocking issues' || E'\n';
  exception when others then out := out || 'PASS approval with blocking issues refused' || E'\n'; end;
  execute 'reset role';
  insert into public.pv_server_checks (kind, year, fingerprint, ok, created_for, result) values ('alloc', y, public.pv_alloc_fingerprint(y), true, head, '{"snapshot":{"test":true}}') returning id into chk;
  execute 'set local role authenticated';
  begin n := public.pv_alloc_approve_checked(chk); out := out || case when n = 1 then 'PASS' else 'FAIL' end || ' Section Head approves the allocation (v' || n || ')' || E'\n';
  exception when others then out := out || 'FAIL allocation approval: ' || sqlerrm || E'\n'; end;
  begin perform public.pv_alloc_set(y, e1, 'field', 'C', null, null, 'auto'); out := out || 'FAIL approved allocation changed' || E'\n';
  exception when others then out := out || 'PASS approved allocation is locked' || E'\n'; end;
  execute 'reset role';

  -- ── Coordinator enters vacations: whole cycles, ≤ 5 periods, no overlap ──
  perform set_config('request.jwt.claims', json_build_object('sub', coord, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.pv_draft_set(y, e1, jsonb_build_array(jsonb_build_object('start', m1, 'end', m1 + 5))); out := out || 'FAIL part of a cycle accepted' || E'\n';
  exception when others then out := out || 'PASS part of a cycle refused' || E'\n'; end;
  begin perform public.pv_draft_set(y, e1, jsonb_build_array(jsonb_build_object('start', m1 + 1, 'end', m1 + 8))); out := out || 'FAIL start off the rota accepted' || E'\n';
  exception when others then out := out || 'PASS a start that is not the cycle start refused' || E'\n'; end;
  begin perform public.pv_draft_set(y, e1, jsonb_build_array(jsonb_build_object('start', m1, 'end', m1 + 15), jsonb_build_object('start', m1 + 8, 'end', m1 + 15))); out := out || 'FAIL overlap accepted' || E'\n';
  exception when others then out := out || 'PASS overlapping vacations refused' || E'\n'; end;
  begin perform public.pv_draft_set(y, e1, (select jsonb_agg(jsonb_build_object('start', m1 + 16 * k, 'end', m1 + 16 * k + 7)) from generate_series(0, 5) k)); out := out || 'FAIL six periods accepted' || E'\n';
  exception when others then out := out || 'PASS six periods refused (five at most)' || E'\n'; end;
  begin perform public.pv_draft_set(y, e2, jsonb_build_array(jsonb_build_object('start', m1, 'end', m1 + 7))); out := out || 'FAIL wrong rota accepted' || E'\n';
  exception when others then out := out || 'PASS a cycle of another shift refused' || E'\n'; end;
  begin n := public.pv_draft_set(y, e1, jsonb_build_array(jsonb_build_object('start', m1, 'end', m1 + 15), jsonb_build_object('start', m1 + 64, 'end', m1 + 71, 'source', 'system')));
    out := out || case when n = 2 then 'PASS' else 'FAIL' end || ' whole cycles saved (manual + system)' || E'\n';
    n := public.pv_draft_set(y, e1, jsonb_build_array(jsonb_build_object('start', m1, 'end', m1 + 15), jsonb_build_object('start', m1 + 64, 'end', m1 + 71, 'source', 'system')));
    select count(*) into n2 from public.pv_plan_blocks b join public.pv_plans p on p.id = b.plan_id where p.year = y;
    out := out || case when n = 2 and n2 = 2 then 'PASS' else 'FAIL' end || ' saving the same again adds nothing' || E'\n';
    perform public.pv_plan_submit(y, 'test');
    out := out || case when (select status from public.pv_plans where year = y) = 'submitted' then 'PASS' else 'FAIL' end || ' sent for approval' || E'\n';
  exception when others then out := out || 'FAIL draft / submit: ' || sqlerrm || E'\n'; end;
  begin perform public.pv_draft_set(y, e1, '[]'::jsonb); out := out || 'FAIL plan changed while waiting' || E'\n';
  exception when others then out := out || 'PASS no changes while it waits for approval' || E'\n'; end;
  execute 'reset role';
  insert into public.pv_server_checks (kind, year, fingerprint, ok, created_for) values ('plan', y, public.pv_plan_fingerprint(y), true, coord) returning id into chk;
  execute 'set local role authenticated';
  begin perform public.pv_plan_approve_checked(chk); out := out || 'FAIL coordinator approved the plan' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS coordinator cannot approve the plan' || E'\n'; end;
  begin perform public.pv_plan_publish(y); out := out || 'FAIL old publish callable' || E'\n';
  exception when others then out := out || 'PASS the old publish path is closed' || E'\n'; end;
  execute 'reset role';

  -- ── Section Head approves and publishes in one step; twice changes nothing ──
  insert into public.pv_server_checks (kind, year, fingerprint, ok, created_for) values ('plan', y, public.pv_plan_fingerprint(y), true, coord) returning id into chk;
  perform set_config('request.jwt.claims', json_build_object('sub', head, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.pv_plan_approve_checked(chk); out := out || 'FAIL someone else''s check used' || E'\n';
  exception when others then out := out || 'PASS a check made for someone else refused' || E'\n'; end;
  execute 'reset role';
  insert into public.pv_server_checks (kind, year, fingerprint, ok, created_for) values ('plan', y, public.pv_plan_fingerprint(y), true, head) returning id into chk;
  execute 'set local role authenticated';
  begin n := public.pv_plan_approve_checked(chk);
    out := out || case when n = 2 then 'PASS' else 'FAIL' end || ' approve publishes the vacations (' || n || ' leave records)' || E'\n';
    n2 := public.pv_plan_approve_checked(chk);
    out := out || case when n2 = 2 then 'PASS' else 'FAIL' end || ' approving again returns the same, adds nothing' || E'\n';
  exception when others then out := out || 'FAIL plan approval: ' || sqlerrm || E'\n'; end;
  begin perform public.pv_alloc_reopen(y, 'test'); out := out || 'FAIL reopened after publishing' || E'\n';
  exception when others then out := out || 'PASS no reopen after publishing (Calendar workflow)' || E'\n'; end;
  execute 'reset role';
  select count(*) into n from public.leave_records where plan_year = y and in_original_plan and in_current_plan and status = 'approved' and approved_at is not null;
  out := out || case when n = 2 then 'PASS' else 'FAIL' end || ' leave records approved, in the original and current plan' || E'\n';
  -- Oracle is followed in oracle_requests (leave_records.oracle_status only mirrors the Section Head's approval)
  select count(*) into n from public.oracle_requests o join public.leave_records l on l.id = o.leave_record_id or l.root_id = o.leave_root_id where l.plan_year = y;
  select n + count(*) into n from public.leave_records where plan_year = y and oracle_ref is not null;
  out := out || case when n = 0 then 'PASS' else 'FAIL' end || ' Oracle not marked (no Oracle application, no Oracle number)' || E'\n';
  select count(*) into n from public.leave_records where plan_year = y and source_ref like '%:system' and note like '%system assigned%';
  out := out || case when n = 1 then 'PASS' else 'FAIL' end || ' system-assigned period marked' || E'\n';
  out := out || case when (select status from public.pv_plans where year = y) = 'published' then 'PASS' else 'FAIL' end || ' plan status Published' || E'\n';

  -- ── anon and untouched years ──
  execute 'set local role anon';
  begin perform public.pv_draft_set(y, e1, '[]'::jsonb); out := out || 'FAIL anon reached pv_draft_set' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS anon cannot call the planning functions' || E'\n'; end;
  begin perform 1 from public.pv_alloc_rows limit 1; out := out || 'FAIL anon reads the allocation' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS anon cannot read the allocation' || E'\n'; end;
  execute 'reset role';
  out := out || case when pv26_before = (select md5(coalesce(string_agg(id::text || status || updated_at::text, ',' order by id), '')) from public.leave_records where plan_year = 2026) then 'PASS' else 'FAIL' end || ' 2026 leave records untouched' || E'\n';
  out := out || case when pl27_before is not distinct from (select status || ':' || version from public.pv_plans where year = 2027) then 'PASS' else 'FAIL' end || ' 2027 plan untouched (' || coalesce(pl27_before, 'none') || ')' || E'\n';
  raise exception E'RESULTS (rolled back)\n%', out;
end $$;
