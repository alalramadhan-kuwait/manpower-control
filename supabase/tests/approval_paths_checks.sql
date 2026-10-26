-- Approval paths: legitimate approvals, rejection and undo still work; approvals cannot bypass the server check.
-- Runs as the Section Head, a Manpower Coordinator and anon inside ONE transaction that always rolls back (the block ends
-- with an exception carrying the results), so no record changes. Run with the Supabase SQL editor or execute_sql.
-- Expected after migration approval_paths_checked_only: every line PASS.
do $$
declare
  head uuid := (select auth_user_id from public.user_profiles where role_code = 'section_head' and is_active limit 1);
  coord uuid := (select auth_user_id from public.user_profiles where role_code = 'manpower_coordinator' and is_active limit 1);
  emp uuid := (select id from public.employee_directory_v where in_unit12_scope and is_active and position_code = 'field_operator' limit 1);
  pv uuid := (select id from public.leave_records where in_current_plan and status in ('approved','planned') and absence_type_code = 'annual_leave_planned'
              and approved_at is null and declined_at is null and start_date > current_date order by start_date limit 1);
  hid uuid; hid2 uuid; hid3 uuid; hid4 uuid; chk uuid; n int; out text := ''; d date := current_date + 40;
  -- each user runs as role authenticated with their id in the JWT claims (auth.uid()); reset before acting as postgres
begin
  -- a waiting request to decide (made as postgres inside this transaction only)
  insert into public.request_headers (type, employee_id, source, workflow, status, plan_year, start_date, end_date, summary, requested_by)
    values ('absence', emp, 'normal_request', 'approval', 'submitted', extract(year from d)::int, d, d, 'TEST short leave (rolled back)', coord) returning id into hid;
  insert into public.request_leave (header_id, absence_type_code, start_date, end_date, action) values (hid, 'short_leave', d, d, 'new');
  insert into public.request_headers (type, employee_id, source, workflow, status, plan_year, start_date, end_date, summary, requested_by)
    values ('absence', emp, 'normal_request', 'approval', 'submitted', extract(year from d)::int, d + 1, d + 1, 'TEST short leave 2 (rolled back)', coord) returning id into hid2;
  insert into public.request_leave (header_id, absence_type_code, start_date, end_date, action) values (hid2, 'short_leave', d + 1, d + 1, 'new');
  insert into public.request_headers (type, employee_id, source, workflow, status, plan_year, start_date, end_date, summary, requested_by)
    values ('absence', emp, 'normal_request', 'approval', 'submitted', extract(year from d)::int, d + 2, d + 2, 'TEST bypass 1 (rolled back)', coord) returning id into hid3;
  insert into public.request_leave (header_id, absence_type_code, start_date, end_date, action) values (hid3, 'short_leave', d + 2, d + 2, 'new');
  insert into public.request_headers (type, employee_id, source, workflow, status, plan_year, start_date, end_date, summary, requested_by)
    values ('absence', emp, 'normal_request', 'approval', 'submitted', extract(year from d)::int, d + 3, d + 3, 'TEST bypass 2 (rolled back)', coord) returning id into hid4;
  insert into public.request_leave (header_id, absence_type_code, start_date, end_date, action) values (hid4, 'short_leave', d + 3, d + 3, 'new');
  insert into public.server_checks (created_for, stamp, request_id, employee_id, type, start_date, end_date, allowed, factual, reason, check_body)
    values (head, (select v from public.manpower_version where id = 1), hid, emp, 'absence', d, d, true, false, null, '{"findings":[],"existing":[]}'::jsonb) returning id into chk;

  -- 1. Section Head: checked approval works
  perform set_config('request.jwt.claims', json_build_object('sub', head, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.request_header_decide_checked(chk, hid, true, 'test', '[]'::jsonb); out := out || 'PASS checked approval (Section Head)' || E'\n';
  exception when others then out := out || 'FAIL checked approval: ' || sqlerrm || E'\n'; end;
  -- 2. Section Head: checked "not approve" works (no check needed)
  begin perform public.request_header_decide_checked(null, hid2, false, 'test', '[]'::jsonb); out := out || 'PASS checked not-approve (Section Head)' || E'\n';
  exception when others then out := out || 'FAIL checked not-approve: ' || sqlerrm || E'\n'; end;
  -- 3. Section Head: approval without a server check is refused (all four direct paths)
  begin perform public.request_header_decide_checked(null, hid2, true, 'x', '[]'::jsonb); out := out || 'FAIL checked approve without check accepted' || E'\n';
  exception when others then out := out || 'PASS checked approve without a check refused' || E'\n'; end;
  begin perform public.approval_decide(hid3, true, 'bypass'); out := out || 'FAIL approval_decide callable (bypass)' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS approval_decide not callable' || E'\n'; when others then out := out || 'CHECK approval_decide: ' || sqlerrm || E'\n'; end;
  begin perform public.request_header_decide(hid4, true, 'bypass', null, '[]'::jsonb); out := out || 'FAIL request_header_decide callable (bypass)' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS request_header_decide not callable' || E'\n'; when others then out := out || 'CHECK request_header_decide: ' || sqlerrm || E'\n'; end;
  begin perform public.request_decide(gen_random_uuid(), true, 'bypass'); out := out || 'FAIL request_decide callable' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS request_decide not callable' || E'\n'; when others then out := out || 'CHECK request_decide reached the body: ' || sqlerrm || E'\n'; end;
  begin perform public.change_request_decide(gen_random_uuid(), true, 'bypass'); out := out || 'FAIL change_request_decide callable' || E'\n';
  exception when insufficient_privilege then out := out || 'PASS change_request_decide not callable' || E'\n'; when others then out := out || 'CHECK change_request_decide reached the body: ' || sqlerrm || E'\n'; end;
  -- 4. Section Head: leave approval, undo, rejection with a reason, undo (unchanged functions)
  if pv is not null then
    begin n := public.leave_approve(array[pv], true); out := out || case when n = 1 then 'PASS' else 'FAIL' end || ' leave_approve' || E'\n';
      n := public.leave_approve(array[pv], false); out := out || case when n = 1 then 'PASS' else 'FAIL' end || ' leave_approve undo' || E'\n';
      n := public.leave_decline(array[pv], true, 'test reason'); out := out || case when n = 1 then 'PASS' else 'FAIL' end || ' leave_decline with reason' || E'\n';
      n := public.leave_decline(array[pv], false, null); out := out || case when n = 1 then 'PASS' else 'FAIL' end || ' leave_decline undo' || E'\n';
    exception when others then out := out || 'FAIL leave approve / decline: ' || sqlerrm || E'\n'; end;
  end if;
  execute 'reset role';

  -- 5. Coordinator: cannot approve (checked path or leave_approve)
  perform set_config('request.jwt.claims', json_build_object('sub', coord, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.request_header_decide_checked(null, hid2, false, 'x', '[]'::jsonb); out := out || 'FAIL Coordinator decided a request' || E'\n';
  exception when others then out := out || 'PASS Coordinator cannot decide: ' || sqlerrm || E'\n'; end;
  if pv is not null then
    begin n := public.leave_approve(array[pv], true); out := out || 'FAIL Coordinator approved leave' || E'\n';
    exception when others then out := out || 'PASS Coordinator cannot approve leave' || E'\n'; end;
  end if;
  begin perform public.approval_decide(hid3, true, 'x'); out := out || 'FAIL Coordinator called approval_decide' || E'\n';
  exception when others then out := out || 'PASS Coordinator: approval_decide refused' || E'\n'; end;
  execute 'reset role';

  -- 6. anon: nothing
  perform set_config('request.jwt.claims', '{"role":"anon"}', true); execute 'set local role anon';
  begin perform public.approval_decide(hid3, true, 'x'); out := out || 'FAIL anon called approval_decide' || E'\n';
  exception when others then out := out || 'PASS anon refused' || E'\n'; end;
  execute 'reset role';

  raise exception E'RESULTS (rolled back)\n%', out;
end $$;
