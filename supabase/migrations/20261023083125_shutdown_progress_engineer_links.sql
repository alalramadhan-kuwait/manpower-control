-- Engineer links: a person updates the shutdown tracker from a personal link (a hidden key) and their ID, no app login.
-- The key is stored hashed; the Section Head creates and turns links off. A link reads and updates the tracker
-- (steps, remarks, holds, drums, blinds, neutralization, events, temperatures, IAT status) and nothing else in the app;
-- every change is stamped with the ID.
create table public.trk_access (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  login_id text not null,
  key_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by_name text,
  last_seen_at timestamptz
);
alter table public.trk_access enable row level security;
create policy trk_access_head on public.trk_access for all using (public.app_is_section_head()) with check (public.app_is_section_head());

-- the ID of the link in use (headers x-trk-key and x-trk-id), null when none or turned off
create or replace function public.trk_access_id() returns text language sql stable security definer set search_path = public, extensions as $$
  select a.login_id from public.trk_access a
   where a.active
     and a.key_hash = encode(extensions.digest(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-trk-key', ''), 'sha256'), 'hex')
     and lower(a.login_id) = lower(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-trk-id', ''))
   limit 1
$$;
create or replace function public.trk_can_read() returns boolean language sql stable as $$
  select public.app_current_role() is not null or public.trk_access_id() is not null
$$;
create or replace function public.trk_can_update() returns boolean language sql stable as $$
  select coalesce(public.app_current_role() in ('section_head', 'manpower_coordinator', 'controller'), false) or public.trk_access_id() is not null
$$;
create or replace function public.trk_who() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.user_profiles where auth_user_id = auth.uid() and is_active limit 1), public.trk_access_id(), 'system')
$$;
-- the link's own details, for its page (and when it was last used)
create or replace function public.trk_access_me() returns table (login_id text, tracker_id uuid, title text) language plpgsql security definer set search_path = public, extensions as $$
declare who text := public.trk_access_id();
begin
  if who is null then return; end if;
  update public.trk_access a set last_seen_at = now()
   where a.active and lower(a.login_id) = lower(who) and a.key_hash = encode(extensions.digest(current_setting('request.headers', true)::json ->> 'x-trk-key', 'sha256'), 'hex');
  return query select a.login_id, a.tracker_id, t.title from public.trk_access a join public.trk_trackers t on t.id = a.tracker_id
   where a.active and lower(a.login_id) = lower(who) and a.key_hash = encode(extensions.digest(current_setting('request.headers', true)::json ->> 'x-trk-key', 'sha256'), 'hex');
end $$;
grant execute on function public.trk_access_me() to anon, authenticated;

-- the setup stays the Section Head's: a link is never treated as the system
create or replace function public.trk_stamp() returns trigger language plpgsql set search_path to 'public' as $function$
declare head boolean := public.app_is_section_head() or (auth.uid() is null and public.trk_access_id() is null);
begin
  if tg_op = 'UPDATE' and not head then
    -- the setup is the Section Head's
    if tg_table_name = 'trk_steps' and (new.prereq is distinct from old.prereq or new.target_at is distinct from old.target_at
        or new.short_name is distinct from old.short_name or new.step_text is distinct from old.step_text or new.gate is distinct from old.gate) then
      raise exception 'Only the Section Head changes the steps (pre-requisites, target, name).'; end if;
    if tg_table_name = 'trk_equipment' and (new.tracked is distinct from old.tracked or new.critical is distinct from old.critical
        or new.planned_ho is distinct from old.planned_ho or new.planned_finish is distinct from old.planned_finish
        or new.ho_step is distinct from old.ho_step or new.ops_item is distinct from old.ops_item) then
      raise exception 'Only the Section Head changes the equipment setup.'; end if;
    if tg_table_name = 'trk_activities' and (new.tracked is distinct from old.tracked or new.stage is distinct from old.stage
        or new.planned_start is distinct from old.planned_start or new.planned_finish is distinct from old.planned_finish
        or new.activity is distinct from old.activity or new.equipment_key is distinct from old.equipment_key) then
      raise exception 'Only the Section Head changes the bar chart.'; end if;
  end if;
  new.updated_by := auth.uid(); new.updated_by_name := public.trk_who(); new.updated_at := now();
  return new;
end $function$;

-- reading the tracker: the app's roles or a link
alter policy trk_activities_read on public.trk_activities using ((select public.trk_can_read()));
alter policy trk_equipment_read on public.trk_equipment using ((select public.trk_can_read()));
alter policy trk_event_read on public.trk_event using ((select public.trk_can_read()));
alter policy trk_iat_read on public.trk_iat using ((select public.trk_can_read()));
alter policy trk_log_read on public.trk_log using ((select public.trk_can_read()));
alter policy trk_point_step_read on public.trk_point_step using ((select public.trk_can_read()));
alter policy trk_points_read on public.trk_points using ((select public.trk_can_read()));
alter policy trk_qty_entry_read on public.trk_qty_entry using ((select public.trk_can_read()));
alter policy trk_qty_estimate_read on public.trk_qty_estimate using ((select public.trk_can_read()));
alter policy trk_qty_scope_read on public.trk_qty_scope using ((select public.trk_can_read()));
alter policy trk_shift_log_read on public.trk_shift_log using ((select public.trk_can_read()));
alter policy trk_steps_read on public.trk_steps using ((select public.trk_can_read()));
alter policy trk_trackers_read on public.trk_trackers using ((select public.trk_can_read()));
alter policy trk_update_read on public.trk_update using ((select public.trk_can_read()));
alter policy trk_forecast_read on public.trk_forecast using ((select public.trk_can_read()));
alter policy trk_link_read on public.trk_link using ((select public.trk_can_read()));
alter policy trk_measure_read on public.trk_measure using ((select public.trk_can_read()));
alter policy lu_streams_read on public.lu_streams using ((select public.trk_can_read()));
alter policy lu_equipment_read on public.lu_equipment using ((select public.trk_can_read()));
-- a reactor confirmed empty: by those who update the tracker
create policy trk_qty_scope_complete on public.trk_qty_scope for update using (public.trk_can_update()) with check (public.trk_can_update());
