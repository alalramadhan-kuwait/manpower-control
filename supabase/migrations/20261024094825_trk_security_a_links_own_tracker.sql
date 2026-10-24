-- Tracker security, stage 1 part A: engineer links expire and reach only their own tracker; trk_split_lines is
-- Section Head only. Policies are altered in place (same names, same roles).
-- Rollback: supabase/rollback/20261024094825_trk_security_a_links_own_tracker.down.sql
alter table public.trk_access add column if not exists expires_at timestamptz;
update public.trk_access set expires_at = '2026-11-17T07:00:00+03:00' where expires_at is null;
alter table public.trk_access alter column expires_at set default (now() + interval '30 days');
alter table public.trk_access alter column expires_at set not null;

create or replace function public.trk_access_id() returns text
language sql stable security definer set search_path to 'public', 'extensions' as $$
  select a.login_id from public.trk_access a
   where a.active and a.expires_at > now()
     and a.key_hash = encode(extensions.digest(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-trk-key', ''), 'sha256'), 'hex')
     and lower(a.login_id) = lower(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-trk-id', ''))
   limit 1
$$;
create or replace function public.trk_access_tracker() returns uuid
language sql stable security definer set search_path to 'public', 'extensions' as $$
  select a.tracker_id from public.trk_access a
   where a.active and a.expires_at > now()
     and a.key_hash = encode(extensions.digest(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-trk-key', ''), 'sha256'), 'hex')
     and lower(a.login_id) = lower(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-trk-id', ''))
   limit 1
$$;
create or replace function public.trk_access_me() returns table(login_id text, tracker_id uuid, title text)
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare who text := public.trk_access_id(); h text;
begin
  if who is null then return; end if;
  h := encode(extensions.digest(current_setting('request.headers', true)::json ->> 'x-trk-key', 'sha256'), 'hex');
  update public.trk_access a set last_seen_at = now() where a.active and a.expires_at > now() and lower(a.login_id) = lower(who) and a.key_hash = h;
  return query select a.login_id, a.tracker_id, t.title from public.trk_access a join public.trk_trackers t on t.id = a.tracker_id
   where a.active and a.expires_at > now() and lower(a.login_id) = lower(who) and a.key_hash = h;
end $$;
create or replace function public.trk_can_read(p_tracker uuid) returns boolean
language sql stable as $$ select public.app_current_role() is not null or public.trk_access_tracker() = p_tracker $$;
create or replace function public.trk_can_update(p_tracker uuid) returns boolean
language sql stable as $$
  select coalesce(public.app_current_role() in ('section_head', 'manpower_coordinator', 'controller'), false) or public.trk_access_tracker() = p_tracker
$$;
grant execute on function public.trk_access_tracker(), public.trk_can_read(uuid), public.trk_can_update(uuid) to anon, authenticated;

do $$
declare t text; rd text := '((select public.app_current_role()) is not null or tracker_id = (select public.trk_access_tracker()))';
  wr text := '(coalesce((select public.app_current_role()) in (''section_head'', ''manpower_coordinator'', ''controller''), false) or tracker_id = (select public.trk_access_tracker()))';
  r record;
begin
  foreach t in array array['trk_activities','trk_equipment','trk_event','trk_forecast','trk_iat','trk_link','trk_log','trk_measure','trk_point_step','trk_points','trk_qty_scope','trk_shift_log','trk_steps','trk_update'] loop
    execute format('alter policy %I on public.%I using %s', t || '_read', t, rd);
  end loop;
  for r in select * from (values
      ('trk_activities','trk_activities_update','update'), ('trk_equipment','trk_equipment_update','update'), ('trk_event','trk_event_update','update'),
      ('trk_iat','trk_iat_update','update'), ('trk_point_step','trk_point_step_update','update'), ('trk_points','trk_points_update','update'),
      ('trk_qty_scope','trk_qty_scope_complete','update'), ('trk_shift_log','trk_shift_log_update','update'), ('trk_steps','trk_steps_update','update'),
      ('trk_update','trk_update_verify','update'),
      ('trk_ask','trk_ask_insert','insert'), ('trk_event','trk_event_insert','insert'), ('trk_forecast','trk_forecast_write','insert'),
      ('trk_iat','trk_iat_write','insert'), ('trk_shift_log','trk_shift_log_write','insert'), ('trk_update','trk_update_write','insert')) v(tbl, pol, cmd) loop
    if r.cmd = 'update' then execute format('alter policy %I on public.%I using %s with check %s', r.pol, r.tbl, wr, wr);
    else execute format('alter policy %I on public.%I with check %s', r.pol, r.tbl, wr); end if;
  end loop;
end $$;
alter policy trk_trackers_read on public.trk_trackers using ((select public.app_current_role()) is not null or id = (select public.trk_access_tracker()));
alter policy trk_qty_entry_read on public.trk_qty_entry using ((select public.app_current_role()) is not null
  or exists (select 1 from public.trk_qty_scope s where s.id = scope_id and s.tracker_id = (select public.trk_access_tracker())));
alter policy trk_qty_estimate_read on public.trk_qty_estimate using ((select public.app_current_role()) is not null
  or exists (select 1 from public.trk_qty_scope s where s.id = scope_id and s.tracker_id = (select public.trk_access_tracker())));
alter policy trk_qty_entry_write on public.trk_qty_entry with check (coalesce((select public.app_current_role()) in ('section_head', 'manpower_coordinator', 'controller'), false)
  or exists (select 1 from public.trk_qty_scope s where s.id = scope_id and s.tracker_id = (select public.trk_access_tracker())));
alter policy trk_qty_entry_verify on public.trk_qty_entry using (coalesce((select public.app_current_role()) in ('section_head', 'manpower_coordinator', 'controller'), false)
  or exists (select 1 from public.trk_qty_scope s where s.id = scope_id and s.tracker_id = (select public.trk_access_tracker())))
  with check (coalesce((select public.app_current_role()) in ('section_head', 'manpower_coordinator', 'controller'), false)
  or exists (select 1 from public.trk_qty_scope s where s.id = scope_id and s.tracker_id = (select public.trk_access_tracker())));
alter policy trk_activities_add_step on public.trk_activities with check (
  (coalesce((select public.app_current_role()) in ('section_head', 'manpower_coordinator', 'controller'), false) or tracker_id = (select public.trk_access_tracker()))
  and activity_id like 'ENG-%' and planned_start is null and planned_finish is null and not detail
  and exists (select 1 from public.trk_equipment e where e.tracker_id = trk_activities.tracker_id and coalesce(e.barchart_key, e.tag) = trk_activities.equipment_key));

create or replace function public.trk_set_order(p_tracker uuid, p_key text, p_ids uuid[]) returns void
language plpgsql security definer set search_path to 'public' as $$
declare old_list text; new_list text;
begin
  if not public.trk_can_update(p_tracker) then raise exception 'Not allowed to change the order.'; end if;
  select string_agg(activity, ' > ' order by seq nulls last, activity_id) into old_list from public.trk_activities
   where tracker_id = p_tracker and equipment_key = p_key and id = any(p_ids);
  if p_ids is null or cardinality(p_ids) = 0 then
    update public.trk_activities set seq = null where tracker_id = p_tracker and equipment_key = p_key;
  else
    update public.trk_activities a set seq = o.n from unnest(p_ids) with ordinality o(id, n) where a.id = o.id and a.tracker_id = p_tracker and a.equipment_key = p_key;
  end if;
  select string_agg(a.activity, ' > ' order by o.n) into new_list from unnest(p_ids) with ordinality o(id, n) join public.trk_activities a on a.id = o.id;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  values (p_tracker, 'activity', p_key, 'order', old_list, coalesce(new_list, 'plan order'), auth.uid(), public.trk_who());
end $$;

do $$
declare src text;
begin
  select pg_get_functiondef('public.trk_split_lines(uuid)'::regprocedure) into src;
  if src !~ 'Only the Section Head can split' then
    src := replace(src, E'begin\n  select max(baseline) into b', E'begin\n  if not public.app_is_section_head() then raise exception ''Only the Section Head can split the bar-chart lines.'' using errcode = ''insufficient_privilege''; end if;\n  select max(baseline) into b');
    if src !~ 'Only the Section Head can split' then raise exception 'trk_split_lines: guard not inserted'; end if;
    execute src;
  end if;
end $$;
