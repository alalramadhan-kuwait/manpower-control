-- Tracker access rules and data integrity: run in the SQL editor (or the MCP) as the database owner.
-- Everything runs in one transaction that always rolls back: it ends by raising either
--   'ALL PASS (n checks)'  or  'FAIL: <first failed check>'. No data is changed.
-- Needs: the live tracker, an active engineer link for it (login Aad323), one Section Head and one Coordinator login.
do $$
declare
  live uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a';
  head uuid := (select auth_user_id from public.user_profiles where role_code = 'section_head' and is_active limit 1);
  coord uuid := (select auth_user_id from public.user_profiles where role_code = 'manpower_coordinator' and is_active limit 1);
  link text := json_build_object('x-trk-id', 'Aad323', 'x-trk-key', 'mEKo77z_L4P8C_uaXcMPh1Lcpe-hQSFk')::text;
  a uuid; n int; m int; ok int := 0;
begin
  -- ── data integrity (as owner) ──────────────────────────────────────────────────────────────────────────────
  select count(*) into n from public.trk_activities where actual_finish < actual_start;
  if n > 0 then raise exception 'FAIL: % steps finish before they start', n; end if; ok := ok + 1;
  select count(*) into n from public.trk_activities where actual_finish is not null and actual_start is null;
  if n > 0 then raise exception 'FAIL: % steps finished with no start', n; end if; ok := ok + 1;
  select count(*) into n from public.trk_activities where actual_start > now() + interval '15 minutes' or actual_finish > now() + interval '15 minutes';
  if n > 0 then raise exception 'FAIL: % steps with a time in the future', n; end if; ok := ok + 1;
  select count(*) into n from public.trk_time_request q join public.trk_activities x on x.id = q.activity_row where x.tracker_id <> q.tracker_id;
  if n > 0 then raise exception 'FAIL: % time requests on another tracker''s step', n; end if; ok := ok + 1;
  select count(*) into n from public.trk_access where expires_at is null;
  if n > 0 then raise exception 'FAIL: % engineer links without expiry', n; end if; ok := ok + 1;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and has_table_privilege('anon', c.oid, 'DELETE');
  if n > 0 then raise exception 'FAIL: anon may delete from % tables', n; end if; ok := ok + 1;
  -- trigger functions cannot be called through the API
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
     and p.prorettype <> 'trigger'::regtype
     and p.proname not in ('app_current_role','app_is_section_head','app_is_staff','app_is_manager','trk_access_id','trk_access_tracker','trk_access_me','trk_who','trk_can_read','trk_can_update','trk_set_order','trk_sd_team','app_visit','trk_time_request_withdraw');
  if n > 0 then raise exception 'FAIL: % functions callable without a login beyond the allowed list', n; end if; ok := ok + 1;

  select id into a from public.trk_activities where tracker_id = live and tracked and actual_start is null and not detail and grp <> 'Operations' limit 1;
  -- a drawing on the TEST tracker (rolled back with the rest)
  insert into public.trk_drawing (tracker_id, items, sheet, rev, source, path, mime)
  values ('2e9c8262-20e9-4274-bd52-87c156a3a487', array['H-12-201'], 'CHECK', '1', 'Approved P&ID', '2e9c8262-20e9-4274-bd52-87c156a3a487/check.png', 'image/png');

  -- ── engineer link ───────────────────────────────────────────────────────────────────────────────────────
  perform set_config('role', 'anon', true); perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.headers', link, true);
  select count(*) into n from public.trk_activities where tracker_id <> live;
  if n > 0 then raise exception 'FAIL: the link reads another tracker'; end if; ok := ok + 1;
  select count(*) into n from public.trk_activities where tracker_id = live;
  if n = 0 then raise exception 'FAIL: the link cannot read its own tracker'; end if; ok := ok + 1;
  update public.trk_activities set actual_note = actual_note where tracker_id <> live; get diagnostics n = row_count;
  if n > 0 then raise exception 'FAIL: the link updates another tracker'; end if; ok := ok + 1;
  select count(*) into n from public.trk_drawing where tracker_id <> live;
  if n > 0 then raise exception 'FAIL: the link reads another tracker''s drawings'; end if; ok := ok + 1;
  begin insert into public.trk_drawing (tracker_id, items, sheet, rev, source, path, mime) values (live, array['X'], 'S', '1', 'x', live::text || '/x.png', 'image/png');
    raise exception 'FAIL: the link may attach a drawing'; exception when insufficient_privilege then ok := ok + 1; end;
  begin perform public.trk_split_lines(live); raise exception 'FAIL: the link may split lines'; exception when insufficient_privilege then ok := ok + 1; end;
  begin perform public.leave_approve(array[]::uuid[], true); raise exception 'FAIL: the link may approve leave'; exception when insufficient_privilege then ok := ok + 1; end;
  update public.trk_activities set actual_start = now() - interval '2 hours' where id = a; get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: the link cannot record a start 2 h back'; end if; ok := ok + 1;
  begin update public.trk_activities set actual_finish = now() - interval '3 hours' where id = a; raise exception 'FAIL: finish before start accepted'; exception when check_violation then ok := ok + 1; end;
  begin update public.trk_activities set actual_finish = now() + interval '2 hours' where id = a; raise exception 'FAIL: future time accepted'; exception when check_violation then ok := ok + 1; end;
  begin update public.trk_activities set actual_start = now() - interval '60 hours', time_reason = null where id = a; raise exception 'FAIL: 60 h back accepted without a reason'; exception when check_violation then ok := ok + 1; end;
  update public.trk_activities set actual_start = now() - interval '60 hours', time_reason = 'check' where id = a; get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: the link cannot enter 60 h back with a reason'; end if; ok := ok + 1;
  if not exists (select 1 from public.trk_log where field = 'actual_start' and reason = 'check' and ref like '%' || (select activity_id from public.trk_activities where id = a)) then
    raise exception 'FAIL: the reason is not in the change log'; end if; ok := ok + 1;
  begin update public.trk_activities set actual_start = now() - interval '61 hours', time_reason = '' where id = a; raise exception 'FAIL: correction accepted without a reason'; exception when check_violation then ok := ok + 1; end;

  -- ── expired link ────────────────────────────────────────────────────────────────────────────────────────
  perform set_config('role', 'postgres', true);
  update public.trk_access set expires_at = now() - interval '1 minute' where lower(login_id) = 'aad323';
  perform set_config('role', 'anon', true);
  select count(*) into n from public.trk_activities;
  if n > 0 then raise exception 'FAIL: an expired link still reads'; end if; ok := ok + 1;

  -- ── no login, no link ───────────────────────────────────────────────────────────────────────────────────
  perform set_config('request.headers', '{}', true);
  select count(*) into n from public.trk_activities;
  if n > 0 then raise exception 'FAIL: anonymous reads the tracker'; end if; ok := ok + 1;

  -- ── Coordinator ─────────────────────────────────────────────────────────────────────────────────────────
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', coord, 'role', 'authenticated')::text, true);
  select count(*) into n from public.leave_records; if n = 0 then raise exception 'FAIL: the Coordinator cannot read leave'; end if; ok := ok + 1;
  begin delete from public.leave_records where false; raise exception 'FAIL: leave records can be deleted'; exception when insufficient_privilege then ok := ok + 1; end;

  -- ── levels: the Coordinator login as Engineer, Controller, Controller + Manpower ──────────────────────────
  perform set_config('role', 'postgres', true); update public.user_profiles set role_code = 'engineer' where auth_user_id = coord; perform set_config('role', 'authenticated', true);
  if not public.app_is_staff() or not public.app_is_manager() then raise exception 'FAIL: the Engineer is not staff and manager'; end if; ok := ok + 1;
  -- an Engineer attaches a new revision: the old one is superseded (kept), both logged; drawings cannot be deleted
  insert into public.trk_drawing (tracker_id, items, sheet, rev, source, path, mime)
  values ('2e9c8262-20e9-4274-bd52-87c156a3a487', array['H-12-201'], 'CHECK', '2', 'Approved P&ID', '2e9c8262-20e9-4274-bd52-87c156a3a487/check2.png', 'image/png');
  select count(*) filter (where status = 'superseded'), count(*) filter (where status = 'current') into n, m from public.trk_drawing where sheet = 'CHECK';
  if n <> 1 or m <> 1 then raise exception 'FAIL: a new revision should supersede the old one (superseded %, current %)', n, m; end if; ok := ok + 1;
  begin delete from public.trk_drawing where sheet = 'CHECK'; raise exception 'FAIL: drawings can be deleted'; exception when insufficient_privilege then ok := ok + 1; end;
  begin perform public.leave_approve(array[]::uuid[], true); raise exception 'FAIL: the Engineer may approve leave'; exception when insufficient_privilege then ok := ok + 1; end;
  perform set_config('role', 'postgres', true); update public.user_profiles set role_code = 'controller' where auth_user_id = coord; perform set_config('role', 'authenticated', true);
  select count(*) into n from public.leave_records; select count(*) into m from public.trk_activities where tracker_id = live;
  if n > 0 or m = 0 then raise exception 'FAIL: a Controller should see the tracker only (leave %, tracker %)', n, m; end if; ok := ok + 1;
  perform set_config('role', 'postgres', true); insert into public.user_assignments (auth_user_id, task) values (coord, 'manpower'); perform set_config('role', 'authenticated', true);
  select count(*) into n from public.leave_records; if n = 0 then raise exception 'FAIL: a Controller with Manpower cannot read leave'; end if; ok := ok + 1;
  update public.employees set display_name = display_name where id = (select id from public.employees limit 1); get diagnostics n = row_count;
  if n > 0 then raise exception 'FAIL: the Manpower assignment edits the staff master'; end if; ok := ok + 1;
  begin perform public.commit_import_batch(gen_random_uuid()); raise exception 'FAIL: the Manpower assignment runs imports'; exception when others then if sqlerrm not ilike '%not allowed%' then raise exception 'FAIL: import refused for another reason: %', sqlerrm; end if; ok := ok + 1; end;
  begin insert into public.trk_drawing (tracker_id, items, sheet, rev, source, path, mime) values (live, array['X'], 'S', '1', 'x', live::text || '/c.png', 'image/png');
    raise exception 'FAIL: a Controller may attach a drawing'; exception when insufficient_privilege then ok := ok + 1; end;
  begin update public.trk_activities set actual_start = now() - interval '80 hours', time_reason = 'x' where id = a; raise exception 'FAIL: a Controller enters 80 h back'; exception when insufficient_privilege then ok := ok + 1; end;
  begin insert into public.user_assignments (auth_user_id, task) values (head, 'manpower'); raise exception 'FAIL: a Controller may give assignments'; exception when insufficient_privilege or check_violation then ok := ok + 1; end;

  raise exception 'ALL PASS (% checks)', ok;
end $$;
