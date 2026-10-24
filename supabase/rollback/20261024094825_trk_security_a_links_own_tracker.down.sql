-- ROLLBACK of 20261024094825_trk_security_a_links_own_tracker (run only to undo stage 1; restores the policies,
-- functions and grants exactly as they were on 24 Oct 2026 before the change; link expiry dates stay as data).
do $$
declare t text;
begin
  foreach t in array array['trk_activities','trk_equipment','trk_event','trk_forecast','trk_iat','trk_link','trk_log','trk_measure','trk_point_step','trk_points','trk_qty_scope','trk_shift_log','trk_steps','trk_update','trk_trackers','trk_qty_entry','trk_qty_estimate'] loop
    execute format('alter policy %I on public.%I using ((select public.trk_can_read()))', t || '_read', t);
  end loop;
end $$;
do $$
declare r record;
begin
  for r in select * from (values
      ('trk_activities','trk_activities_update','update'), ('trk_equipment','trk_equipment_update','update'), ('trk_event','trk_event_update','update'),
      ('trk_iat','trk_iat_update','update'), ('trk_point_step','trk_point_step_update','update'), ('trk_points','trk_points_update','update'),
      ('trk_qty_scope','trk_qty_scope_complete','update'), ('trk_shift_log','trk_shift_log_update','update'), ('trk_steps','trk_steps_update','update'),
      ('trk_update','trk_update_verify','update'), ('trk_qty_entry','trk_qty_entry_verify','update'),
      ('trk_ask','trk_ask_insert','insert'), ('trk_event','trk_event_insert','insert'), ('trk_forecast','trk_forecast_write','insert'),
      ('trk_iat','trk_iat_write','insert'), ('trk_shift_log','trk_shift_log_write','insert'), ('trk_update','trk_update_write','insert'),
      ('trk_qty_entry','trk_qty_entry_write','insert')) v(tbl, pol, cmd) loop
    if r.cmd = 'update' then execute format('alter policy %I on public.%I using (public.trk_can_update()) with check (public.trk_can_update())', r.pol, r.tbl);
    else execute format('alter policy %I on public.%I with check (public.trk_can_update())', r.pol, r.tbl); end if;
  end loop;
end $$;
alter policy trk_activities_add_step on public.trk_activities with check (public.trk_can_update() and activity_id like 'ENG-%'
  and planned_start is null and planned_finish is null and not detail
  and exists (select 1 from public.trk_equipment e where e.tracker_id = trk_activities.tracker_id and coalesce(e.barchart_key, e.tag) = trk_activities.equipment_key));

-- functions as they were
create or replace function public.trk_access_id() returns text
language sql stable security definer set search_path to 'public', 'extensions' as $$
  select a.login_id from public.trk_access a
   where a.active
     and a.key_hash = encode(extensions.digest(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-trk-key', ''), 'sha256'), 'hex')
     and lower(a.login_id) = lower(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-trk-id', ''))
   limit 1
$$;
create or replace function public.trk_access_me() returns table(login_id text, tracker_id uuid, title text)
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare who text := public.trk_access_id();
begin
  if who is null then return; end if;
  update public.trk_access a set last_seen_at = now()
   where a.active and lower(a.login_id) = lower(who) and a.key_hash = encode(extensions.digest(current_setting('request.headers', true)::json ->> 'x-trk-key', 'sha256'), 'hex');
  return query select a.login_id, a.tracker_id, t.title from public.trk_access a join public.trk_trackers t on t.id = a.tracker_id
   where a.active and lower(a.login_id) = lower(who) and a.key_hash = encode(extensions.digest(current_setting('request.headers', true)::json ->> 'x-trk-key', 'sha256'), 'hex');
end $$;
create or replace function public.trk_set_order(p_tracker uuid, p_key text, p_ids uuid[]) returns void
language plpgsql security definer set search_path to 'public' as $$
declare old_list text; new_list text;
begin
  if not public.trk_can_update() then raise exception 'Not allowed to change the order.'; end if;
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
-- trk_split_lines: remove the Section Head guard line
do $$ declare src text; begin
  select pg_get_functiondef('public.trk_split_lines(uuid)'::regprocedure) into src;
  src := regexp_replace(src, E'\n  if not public.app_is_section_head\\(\\) then raise exception ''Only the Section Head can split[^\n]*', '');
  execute src;
end $$;
drop function if exists public.trk_can_read(uuid);
drop function if exists public.trk_can_update(uuid);
drop function if exists public.trk_access_tracker();
alter table public.trk_access alter column expires_at drop not null, alter column expires_at drop default;
