-- One record per event: blinded = handed over (stage 1, blinds-in time), deblinded = returned (stage 6, blinds-out
-- time). The handover step done, the stage tap and the bar-chart blind line finished are the same event and are kept
-- in step here, so the app never shows two answers.

-- the stage stamps the blinds times
create or replace function public.trk_eq_blinds() returns trigger language plpgsql set search_path = public as $$
begin
  if new.stage >= 1 and new.blinds_in_at is null then new.blinds_in_at := now(); end if;
  if new.stage < 1 then new.blinds_in_at := null; end if;
  if new.stage >= 6 and new.blinds_out_at is null then new.blinds_out_at := now(); end if;
  if new.stage < 6 then new.blinds_out_at := null; end if;
  return new;
end $$;
create trigger trk_equipment_blinds before insert or update on public.trk_equipment for each row execute function public.trk_eq_blinds();

-- the stage finishes (or reopens) its linked bar-chart lines: the blind line of stage 1 and the deblind line of stage 6
create or replace function public.trk_eq_sync_lines() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('trk.sync', true), '') = 'eq' or new.stage is not distinct from old.stage then return null; end if;
  perform set_config('trk.sync', 'eq', true);
  update public.trk_activities a set actual_start = coalesce(a.actual_start, x.at), actual_finish = x.at
    from (select 1 st, new.blinds_in_at at union all select 6, new.blinds_out_at) x
   where a.tracker_id = new.tracker_id and a.equipment_key = coalesce(new.barchart_key, new.tag) and a.activity ~* 'blind'
     and a.stage = x.st and new.stage >= x.st and a.actual_finish is null and x.at is not null;
  update public.trk_activities a set actual_finish = null, actual_start = case when a.actual_start = a.actual_finish then null else a.actual_start end
   where a.tracker_id = new.tracker_id and a.equipment_key = coalesce(new.barchart_key, new.tag) and a.activity ~* 'blind'
     and a.stage in (1, 6) and new.stage < a.stage and a.actual_finish is not null;
  perform set_config('trk.sync', '', true);
  return null;
end $$;
create trigger trk_equipment_sync_lines after update on public.trk_equipment for each row execute function public.trk_eq_sync_lines();

-- a blind line finished moves the item to its stage (a combined line such as Blind, remove elbow and top trays is
-- stage 2, opened, with the handover implied), and reopening it takes the item back one stage
create or replace function public.trk_act_sync_stage() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('trk.sync', true), '') <> '' or new.stage is null or new.activity !~* 'blind'
     or new.actual_finish is not distinct from old.actual_finish then return null; end if;
  perform set_config('trk.sync', 'act', true);
  if new.actual_finish is not null then
    update public.trk_equipment e set stage = new.stage,
        blinds_in_at = case when e.blinds_in_at is null and new.stage >= 1 and new.stage < 6 then new.actual_finish else e.blinds_in_at end,
        blinds_out_at = case when new.stage = 6 then new.actual_finish else e.blinds_out_at end
     where e.tracker_id = new.tracker_id and coalesce(e.barchart_key, e.tag) = new.equipment_key and e.stage < new.stage;
  else
    update public.trk_equipment e set stage = new.stage - 1
     where e.tracker_id = new.tracker_id and coalesce(e.barchart_key, e.tag) = new.equipment_key and e.stage = new.stage;
  end if;
  perform set_config('trk.sync', '', true);
  return null;
end $$;
create trigger trk_activities_sync_stage after update on public.trk_activities for each row execute function public.trk_act_sync_stage();

-- the handover step done hands over its items (at the done time), reopened it takes back the ones still at stage 1
create or replace function public.trk_step_sync_items() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    update public.trk_equipment e set stage = 1, blinds_in_at = coalesce(e.blinds_in_at, new.done_at, now())
     where e.tracker_id = new.tracker_id and e.ho_step = new.step_id and e.stage = 0;
  elsif old.status = 'done' and new.status <> 'done' then
    update public.trk_equipment e set stage = 0
     where e.tracker_id = new.tracker_id and e.ho_step = new.step_id and e.stage = 1;
  end if;
  return null;
end $$;
create trigger trk_steps_sync_items after update on public.trk_steps for each row execute function public.trk_step_sync_items();

-- the data as it stands: one answer per item
update public.trk_activities set stage = 6 where activity ~* '^remove blinds$' and stage = 2;
update public.trk_equipment e set stage = 1, blinds_in_at = coalesce(e.blinds_in_at, s.done_at, s.updated_at)
  from public.trk_steps s where s.tracker_id = e.tracker_id and s.step_id = e.ho_step and s.status = 'done' and e.stage = 0;
update public.trk_equipment set stage = 1 where blinds_in_at is not null and stage = 0;
update public.trk_equipment e set blinds_in_at = coalesce(s.done_at, s.updated_at, e.updated_at)
  from public.trk_steps s where s.tracker_id = e.tracker_id and s.step_id = e.ho_step and e.stage >= 1 and e.blinds_in_at is null;
update public.trk_equipment set blinds_in_at = coalesce(updated_at, now()) where stage >= 1 and blinds_in_at is null;
update public.trk_equipment set blinds_out_at = coalesce(updated_at, now()) where stage = 6 and blinds_out_at is null;
update public.trk_equipment set blinds_out_at = null where stage < 6 and blinds_out_at is not null;
update public.trk_activities a set actual_start = coalesce(a.actual_start, e.blinds_in_at), actual_finish = e.blinds_in_at
  from public.trk_equipment e where e.tracker_id = a.tracker_id and coalesce(e.barchart_key, e.tag) = a.equipment_key
   and a.activity ~* 'blind' and a.stage = 1 and e.stage >= 1 and a.actual_finish is null;
