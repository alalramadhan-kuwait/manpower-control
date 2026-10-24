-- 1. Earlier start / finish times without approval (Section Head instruction 24 Oct 2026): the Section Head, Engineers
--    and engineer links (own tracker) enter or correct a time however old. Kept: no time in the future, no finish
--    before the start, and a reason for a correction (a recorded time changed) or a time more than 48 h back; the
--    reason goes into trk_log with who and when. Controllers / the Coordinator: up to 48 h back.
--    trk_time_request stays (no rows used) for its history; the app no longer offers it.
alter table public.trk_activities add column if not exists time_reason text;
alter table public.trk_log add column if not exists reason text;

create or replace function public.trk_activity_time_guard() returns trigger
language plpgsql set search_path to 'public' as $$
declare person boolean := auth.uid() is not null or public.trk_access_id() is not null;
  free boolean := public.app_is_section_head() or public.app_current_role() = 'engineer' or public.trk_access_id() is not null;
  s_old boolean := new.actual_start is distinct from old.actual_start and new.actual_start < now() - interval '48 hours';
  f_old boolean := new.actual_finish is distinct from old.actual_finish and new.actual_finish < now() - interval '48 hours';
  fixed boolean := (old.actual_start is not null and new.actual_start is not null and abs(extract(epoch from new.actual_start - old.actual_start)) > 60)
                or (old.actual_finish is not null and new.actual_finish is not null and abs(extract(epoch from new.actual_finish - old.actual_finish)) > 60);
begin
  if new.actual_start is not distinct from old.actual_start and new.actual_finish is not distinct from old.actual_finish then return new; end if;
  if new.actual_start > now() + interval '15 minutes' or new.actual_finish > now() + interval '15 minutes' then
    raise exception 'A start or finish time cannot be in the future.' using errcode = 'check_violation';
  end if;
  if new.actual_start is not null and new.actual_finish is not null and new.actual_finish < new.actual_start then
    raise exception 'The finish cannot be before the start.' using errcode = 'check_violation';
  end if;
  if person and (s_old or f_old) and not free then
    raise exception 'Times more than 48 h back are entered by an Engineer or the Section Head.' using errcode = 'insufficient_privilege';
  end if;
  if person and (s_old or f_old or fixed) and length(trim(coalesce(new.time_reason, ''))) = 0 then
    raise exception 'Give a reason for correcting a time or entering one more than 48 h back.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.trk_log_activity() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare who text := public.trk_who(); r text := new.equipment_key || ' · ' || new.activity_id;
  why text := case when tg_op = 'UPDATE' then nullif(trim(coalesce(new.time_reason, '')), '') end;
begin
  if tg_op = 'INSERT' then
    -- a step added from the field (a bar-chart import is not logged line by line)
    if new.activity_id like 'ENG-%' then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', r, 'step added', null, new.activity, auth.uid(), who); end if;
    return new;
  end if;
  if new.actual_start is distinct from old.actual_start then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason) values (new.tracker_id, 'activity', r, 'actual_start', old.actual_start::text, new.actual_start::text, auth.uid(), who, why); end if;
  if new.actual_finish is distinct from old.actual_finish then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason) values (new.tracker_id, 'activity', r, 'actual_finish', old.actual_finish::text, new.actual_finish::text, auth.uid(), who, why); end if;
  if new.activity is distinct from old.activity then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', r, 'renamed', old.activity, new.activity, auth.uid(), who); end if;
  if new.tracked is distinct from old.tracked then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', r, case when new.tracked then 'step on' else 'step off' end, null, new.activity, auth.uid(), who); end if;
  return new;
end $$;

-- 2. The Manpower assignment opens manpower and leave work only. Administrative data (staff master, roles and
--    qualifications, performance and sick totals, imports, holidays, unit events, operating periods) is changed by
--    the Section Head, an Engineer or the Manpower Coordinator; an assigned Controller still reads it.
create or replace function public.app_is_admin_staff() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.app_current_role() in ('section_head', 'manpower_coordinator', 'engineer'), false)
$$;
revoke execute on function public.app_is_admin_staff() from public, anon;
grant execute on function public.app_is_admin_staff() to authenticated;
do $$
declare t text;
begin
  foreach t in array array['employees:staff_all_employees', 'employee_role_assignments:staff_all_roles', 'employee_qualifications:staff_all_quals',
                           'employee_performance:staff_all_perf', 'sick_leave_totals:staff_all_sick', 'import_batches:staff_all_batches', 'import_rows:staff_all_import_rows'] loop
    execute format('alter policy %I on public.%I using (public.app_is_admin_staff()) with check (public.app_is_admin_staff())', split_part(t, ':', 2), split_part(t, ':', 1));
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = split_part(t, ':', 1) and policyname = split_part(t, ':', 1) || '_staff_read') then
      execute format('create policy %I on public.%I for select using (public.app_is_staff())', split_part(t, ':', 1) || '_staff_read', split_part(t, ':', 1));
    end if;
  end loop;
end $$;
alter policy ph_staff_insert on public.public_holidays with check (public.app_is_admin_staff());
alter policy ph_staff_update on public.public_holidays using (public.app_is_admin_staff()) with check (public.app_is_admin_staff());
alter policy ph_staff_delete on public.public_holidays using (public.app_is_admin_staff());
alter policy ue_staff_insert on public.unit_events with check (public.app_is_admin_staff());
alter policy ue_staff_update on public.unit_events using (public.app_is_admin_staff()) with check (public.app_is_admin_staff());
alter policy op_staff_insert on public.operation_periods with check (public.app_is_admin_staff());
alter policy op_staff_update on public.operation_periods using (public.app_is_admin_staff()) with check (public.app_is_admin_staff());
-- imports, Oracle statistics and the data-quality sync: administrative
do $$
declare f text; src text;
begin
  foreach f in array array['commit_import_batch', 'oracle_stats_import', 'issues_sync'] loop
    for src in select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f loop
      execute replace(src, 'app_is_staff()', 'app_is_admin_staff()');
    end loop;
  end loop;
end $$;

-- 3. No call without a login for the two functions added earlier today
revoke execute on function public.app_has_task(text) from public, anon;
revoke execute on function public.trk_activity_time_guard() from public, anon;
