-- Mechanical activity timing: the actual start and finish of each bar-chart activity, stamped with who and when, kept
-- for future shutdowns (plan vs actual durations). Controllers record them, the setup of the bar chart (on / off, stage,
-- planned dates) stays the Section Head's. A new bar-chart baseline keeps the actuals of the same activities.
alter table public.trk_activities add column actual_start timestamptz, add column actual_finish timestamptz, add column actual_note text,
  add column updated_by uuid, add column updated_by_name text, add column updated_at timestamptz;

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
    if tg_table_name = 'trk_activities' and (new.tracked is distinct from old.tracked or new.stage is distinct from old.stage
        or new.planned_start is distinct from old.planned_start or new.planned_finish is distinct from old.planned_finish
        or new.activity is distinct from old.activity or new.equipment_key is distinct from old.equipment_key) then
      raise exception 'Only the Section Head changes the bar chart.'; end if;
  end if;
  new.updated_by := auth.uid(); new.updated_by_name := public.trk_who(); new.updated_at := now();
  return new;
end $$;
create trigger trk_activities_stamp before update on public.trk_activities for each row execute function public.trk_stamp();

create or replace function public.trk_log_activity() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := public.trk_who();
begin
  if new.actual_start is distinct from old.actual_start then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', new.equipment_key || ' · ' || new.activity_id, 'actual_start', old.actual_start::text, new.actual_start::text, auth.uid(), who); end if;
  if new.actual_finish is distinct from old.actual_finish then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', new.equipment_key || ' · ' || new.activity_id, 'actual_finish', old.actual_finish::text, new.actual_finish::text, auth.uid(), who); end if;
  return new;
end $$;
create trigger trk_activities_log after update on public.trk_activities for each row execute function public.trk_log_activity();

-- controllers record the actuals (the setup is guarded by the stamp trigger above)
create policy trk_activities_update on public.trk_activities for update using (public.trk_can_update()) with check (public.trk_can_update());

-- a new baseline keeps the actuals of the same activities (same id and equipment)
create or replace function public.trk_import_barchart(p_tracker uuid, p_rows jsonb) returns int language plpgsql security definer set search_path = public as $$
declare t public.trk_trackers; b int; n int;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head imports the bar chart.'; end if;
  select * into t from public.trk_trackers where id = p_tracker;
  if t.id is null or t.mode = 'template' then raise exception 'Import into a test or live tracker.'; end if;
  select coalesce(max(baseline), 0) + 1 into b from public.trk_activities where tracker_id = p_tracker;
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline, actual_start, actual_finish, actual_note)
  select p_tracker, r->>'activity_id', nullif(r->>'group', ''), r->>'equipment_key', r->>'activity', nullif(r->>'duration_h', '')::numeric,
         nullif(r->>'planned_start', '')::timestamptz, nullif(r->>'planned_finish', '')::timestamptz, nullif(r->>'stage', '')::int,
         coalesce(nullif(r->>'tracked', '')::int, 1) = 1, b, prev.actual_start, prev.actual_finish, prev.actual_note
    from jsonb_array_elements(p_rows) r
    left join lateral (select a.actual_start, a.actual_finish, a.actual_note from public.trk_activities a
       where a.tracker_id = p_tracker and a.baseline = b - 1 and a.activity_id = r->>'activity_id' and a.equipment_key = r->>'equipment_key' limit 1) prev on true
   where coalesce(r->>'activity_id', '') <> '' and coalesce(r->>'equipment_key', '') <> '';
  get diagnostics n = row_count;
  -- a test import also becomes the seed of the next test reset
  if t.mode = 'test' and t.template_id is not null then
    insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline)
    select t.template_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked,
           (select coalesce(max(baseline), 0) + 1 from public.trk_activities where tracker_id = t.template_id)
      from public.trk_activities where tracker_id = p_tracker and baseline = b;
  end if;
  return n;
end $$;
