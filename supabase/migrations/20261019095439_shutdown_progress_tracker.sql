-- Shutdown progress tracker (U-12 TR-2 shutdown tracker, v1): the guideline steps with their pre-requisites, the
-- equipment and its stages (handover → returned), IATs, the bar chart (plan vs actual), the shift log, and every change
-- logged with who and when. One tracker per calendar shutdown and mode: 'template' (the seed), 'test', 'live'.
-- Read: every app user. Progress: Section Head, Manpower Coordinator, Controllers. Setup (pre-requisites, targets,
-- tracked on/off, critical, planned dates) and TEST / LIVE: the Section Head.

create table public.trk_trackers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.unit_events(id),
  title text not null,
  mode text not null check (mode in ('template','test','live')),
  template_id uuid references public.trk_trackers(id),
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','closed')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index trk_one_live on public.trk_trackers (event_id) where mode = 'live' and status = 'active';

create table public.trk_steps (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  step_id text not null, fo text not null, gate int not null, gate_name text, short_name text not null, step_text text,
  procedure text, prereq text[] not null default '{}', est_hours numeric, note text, equipment_covered text,
  target_at timestamptz,
  status text not null default 'not_started' check (status in ('not_started','in_progress','done','pending','na')),
  pending_reason text, remark text,
  updated_by uuid, updated_by_name text, updated_at timestamptz,
  unique (tracker_id, step_id)
);

create table public.trk_equipment (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  tag text not null, grp text not null, description text, fo text, ho_step text, procedure text, barchart_key text,
  ops_item boolean not null default false, critical boolean not null default false,
  tracked boolean not null default true, disabled_reason text,
  planned_ho timestamptz, planned_finish timestamptz, sort int not null default 0,
  stage int not null default 0 check (stage between 0 and 6),
  pending_reason text, remark text, blinds_in_at timestamptz, blinds_out_at timestamptz,
  updated_by uuid, updated_by_name text, updated_at timestamptz,
  unique (tracker_id, tag)
);

create table public.trk_iat (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  tag text not null, iat_no text not null, job_text text, discipline text,
  issued_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','closed')), closed_at timestamptz,
  updated_by uuid, updated_by_name text, updated_at timestamptz
);

create table public.trk_activities (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  activity_id text not null, grp text, equipment_key text not null, activity text not null, duration_h numeric,
  planned_start timestamptz, planned_finish timestamptz, stage int check (stage between 0 and 6),
  tracked boolean not null default true, disabled_reason text
);
create index trk_activities_key on public.trk_activities (tracker_id, equipment_key);

create table public.trk_shift_log (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  shift_date date not null, shift text not null check (shift in ('D','N')),
  notes text, temps jsonb not null default '{}'::jsonb,
  updated_by uuid, updated_by_name text, updated_at timestamptz,
  unique (tracker_id, shift_date, shift)
);

-- every change of progress, for the shift report and the history (who, when, what)
create table public.trk_log (
  id bigint generated always as identity primary key,
  tracker_id uuid not null references public.trk_trackers(id),
  kind text not null, ref text not null, field text not null, old_value text, new_value text,
  by_user uuid, by_name text, at timestamptz not null default now()
);
create index trk_log_at on public.trk_log (tracker_id, at);

-- who is changing it (the stamp on every row and log line)
create or replace function public.trk_who() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.user_profiles where auth_user_id = auth.uid() and is_active limit 1), 'system')
$$;
create or replace function public.trk_can_update() returns boolean language sql stable as $$
  select coalesce(public.app_current_role() in ('section_head','manpower_coordinator','controller'), false)
$$;

create or replace function public.trk_stamp() returns trigger language plpgsql set search_path = public as $$
declare head boolean := public.app_is_section_head() or auth.uid() is null;
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
  end if;
  new.updated_by := auth.uid(); new.updated_by_name := public.trk_who(); new.updated_at := now();
  return new;
end $$;

create or replace function public.trk_log_change() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := public.trk_who();
begin
  if tg_table_name = 'trk_steps' then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'step', new.step_id, 'status', old.status, new.status, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.pending_reason is distinct from old.pending_reason then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'step', new.step_id, 'pending', old.pending_reason, new.pending_reason, auth.uid(), who); end if;
  elsif tg_table_name = 'trk_equipment' then
    if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'stage', old.stage::text, new.stage::text, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.pending_reason is distinct from old.pending_reason then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'pending', old.pending_reason, new.pending_reason, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.blinds_in_at is distinct from old.blinds_in_at then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'blinds_in', old.blinds_in_at::text, new.blinds_in_at::text, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.blinds_out_at is distinct from old.blinds_out_at then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'blinds_out', old.blinds_out_at::text, new.blinds_out_at::text, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.tracked is distinct from old.tracked then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'tracked', old.tracked::text, new.tracked::text, auth.uid(), who); end if;
  elsif tg_table_name = 'trk_iat' then
    if tg_op = 'INSERT' then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'iat', new.tag, 'iat', null, 'open ' || new.iat_no, auth.uid(), who);
    elsif new.status is distinct from old.status then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'iat', new.tag, 'iat', old.status || ' ' || old.iat_no, new.status || ' ' || new.iat_no, auth.uid(), who); end if;
  end if;
  return new;
end $$;

create trigger trk_steps_stamp before update on public.trk_steps for each row execute function public.trk_stamp();
create trigger trk_equipment_stamp before update on public.trk_equipment for each row execute function public.trk_stamp();
create trigger trk_iat_stamp before insert or update on public.trk_iat for each row execute function public.trk_stamp();
create trigger trk_shift_log_stamp before insert or update on public.trk_shift_log for each row execute function public.trk_stamp();
create trigger trk_steps_log after update on public.trk_steps for each row execute function public.trk_log_change();
create trigger trk_equipment_log after update on public.trk_equipment for each row execute function public.trk_log_change();
create trigger trk_iat_log after insert or update on public.trk_iat for each row execute function public.trk_log_change();

alter table public.trk_trackers enable row level security;
alter table public.trk_steps enable row level security;
alter table public.trk_equipment enable row level security;
alter table public.trk_iat enable row level security;
alter table public.trk_activities enable row level security;
alter table public.trk_shift_log enable row level security;
alter table public.trk_log enable row level security;
create policy trk_trackers_read on public.trk_trackers for select using (public.app_current_role() is not null);
create policy trk_trackers_head on public.trk_trackers for all using (public.app_is_section_head()) with check (public.app_is_section_head());
create policy trk_steps_read on public.trk_steps for select using (public.app_current_role() is not null);
create policy trk_steps_update on public.trk_steps for update using (public.trk_can_update()) with check (public.trk_can_update());
create policy trk_equipment_read on public.trk_equipment for select using (public.app_current_role() is not null);
create policy trk_equipment_update on public.trk_equipment for update using (public.trk_can_update()) with check (public.trk_can_update());
create policy trk_equipment_head on public.trk_equipment for insert with check (public.app_is_section_head());
create policy trk_iat_read on public.trk_iat for select using (public.app_current_role() is not null);
create policy trk_iat_write on public.trk_iat for insert with check (public.trk_can_update());
create policy trk_iat_update on public.trk_iat for update using (public.trk_can_update()) with check (public.trk_can_update());
create policy trk_activities_read on public.trk_activities for select using (public.app_current_role() is not null);
create policy trk_activities_head on public.trk_activities for update using (public.app_is_section_head()) with check (public.app_is_section_head());
create policy trk_shift_log_read on public.trk_shift_log for select using (public.app_current_role() is not null);
create policy trk_shift_log_write on public.trk_shift_log for insert with check (public.trk_can_update());
create policy trk_shift_log_update on public.trk_shift_log for update using (public.trk_can_update()) with check (public.trk_can_update());
create policy trk_log_read on public.trk_log for select using (public.app_current_role() is not null);

-- a copy of a tracker's setup (and its progress when asked) into another one of the same event
create or replace function public.trk_copy(p_src uuid, p_dst uuid, p_progress boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.trk_steps (tracker_id, step_id, fo, gate, gate_name, short_name, step_text, procedure, prereq, est_hours, note, equipment_covered, target_at, status, pending_reason, remark)
  select p_dst, step_id, fo, gate, gate_name, short_name, step_text, procedure, prereq, est_hours, note, equipment_covered, target_at,
         case when p_progress then status else 'not_started' end, case when p_progress then pending_reason end, case when p_progress then remark end
    from public.trk_steps where tracker_id = p_src;
  insert into public.trk_equipment (tracker_id, tag, grp, description, fo, ho_step, procedure, barchart_key, ops_item, critical, tracked, disabled_reason, planned_ho, planned_finish, sort, stage, pending_reason, remark)
  select p_dst, tag, grp, description, fo, ho_step, procedure, barchart_key, ops_item, critical, tracked, disabled_reason, planned_ho, planned_finish, sort,
         case when p_progress then stage else 0 end, case when p_progress then pending_reason end, case when p_progress then remark end
    from public.trk_equipment where tracker_id = p_src;
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason)
  select p_dst, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason
    from public.trk_activities where tracker_id = p_src;
end $$;
revoke all on function public.trk_copy(uuid, uuid, boolean) from public, anon, authenticated;

-- TEST: a fresh test tracker from the seed (the 19-Oct logbook statuses), the old one closed and kept
create or replace function public.trk_reset(p_tracker uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare t public.trk_trackers; v uuid;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head resets the test.'; end if;
  select * into t from public.trk_trackers where id = p_tracker;
  if t.mode <> 'test' or t.template_id is null then raise exception 'Only a test tracker is reset.'; end if;
  update public.trk_trackers set status = 'closed' where id = p_tracker;
  insert into public.trk_trackers (event_id, title, mode, template_id, settings) values (t.event_id, t.title, 'test', t.template_id, t.settings) returning id into v;
  perform public.trk_copy(t.template_id, v, true);
  return v;
end $$;

-- Publish: the TEST setup (steps, pre-requisites, equipment, bar chart, on/off) as the LIVE tracker, progress clean
create or replace function public.trk_publish(p_tracker uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare t public.trk_trackers; v uuid;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head publishes.'; end if;
  select * into t from public.trk_trackers where id = p_tracker;
  if t.mode <> 'test' then raise exception 'Publish from the test tracker.'; end if;
  if exists (select 1 from public.trk_trackers where event_id = t.event_id and mode = 'live' and status = 'active') then raise exception 'This shutdown is already live.'; end if;
  insert into public.trk_trackers (event_id, title, mode, template_id, settings) values (t.event_id, t.title, 'live', t.template_id, t.settings) returning id into v;
  perform public.trk_copy(p_tracker, v, false);
  return v;
end $$;
revoke all on function public.trk_reset(uuid) from public, anon;
revoke all on function public.trk_publish(uuid) from public, anon;
grant execute on function public.trk_reset(uuid) to authenticated;
grant execute on function public.trk_publish(uuid) to authenticated;
