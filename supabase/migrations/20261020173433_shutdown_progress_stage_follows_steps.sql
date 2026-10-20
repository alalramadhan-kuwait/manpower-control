-- The item's stage follows its work steps. A bar-chart line finished moves the item to that line's stage (2 opened /
-- cleaning … 5 box-up, 6 deblinded) when it is further on, an operations "hand over" step finished hands the item over
-- (stage 1), and taking a step back takes the item back to the furthest step still finished. Field-detail steps do not
-- count. The blind lines keep their own rule (blinded = handed over). Existing data is brought in line once.
-- C-12-201 is not neutralized: it is handed over after the lube oil is stopped, the turbine isolated and the blinds in
-- (SEG-11, SEG-14), so it leaves S215 and gets those operations steps.

create or replace function public.trk_item_stage_from_steps(p_tracker uuid, p_key text, p_baseline int) returns int language sql stable set search_path = public as $$
  select greatest(
    coalesce((select max(a.stage) from public.trk_activities a where a.tracker_id = p_tracker and a.equipment_key = p_key and a.baseline = p_baseline
               and a.tracked and not a.detail and coalesce(a.disabled_reason, '') = '' and a.grp is distinct from 'Operations'
               and a.stage between 2 and 6 and a.actual_finish is not null), 0),
    (select case when exists (select 1 from public.trk_activities a where a.tracker_id = p_tracker and a.equipment_key = p_key and a.baseline = p_baseline
               and a.tracked and coalesce(a.disabled_reason, '') = '' and a.grp = 'Operations' and a.activity ~* 'hand ?over' and a.actual_finish is not null) then 1 else 0 end))
$$;

create or replace function public.trk_act_sync_stage() returns trigger language plpgsql security definer set search_path = public as $$
declare st int;
begin
  if coalesce(current_setting('trk.sync', true), '') <> '' or new.actual_finish is not distinct from old.actual_finish then return null; end if;
  perform set_config('trk.sync', 'act', true);
  if new.activity ~* 'blind' and new.stage is not null and new.grp is distinct from 'Operations' then
    -- a blind line finished: blinded = handed over (or deblinded = returned), reopened takes the item back one stage
    if new.actual_finish is not null then
      update public.trk_equipment e set stage = new.stage,
          blinds_in_at = case when e.blinds_in_at is null and new.stage >= 1 and new.stage < 6 then new.actual_finish else e.blinds_in_at end,
          blinds_out_at = case when new.stage = 6 then new.actual_finish else e.blinds_out_at end
       where e.tracker_id = new.tracker_id and coalesce(e.barchart_key, e.tag) = new.equipment_key and e.stage < new.stage;
    else
      update public.trk_equipment e set stage = new.stage - 1
       where e.tracker_id = new.tracker_id and coalesce(e.barchart_key, e.tag) = new.equipment_key and e.stage = new.stage;
    end if;
  elsif not new.detail and (new.grp = 'Operations' and new.activity ~* 'hand ?over' or new.grp is distinct from 'Operations' and new.stage between 2 and 6) then
    st := public.trk_item_stage_from_steps(new.tracker_id, new.equipment_key, new.baseline);
    if new.actual_finish is not null then
      update public.trk_equipment e set stage = st, blinds_in_at = coalesce(e.blinds_in_at, new.actual_finish)
       where e.tracker_id = new.tracker_id and coalesce(e.barchart_key, e.tag) = new.equipment_key and e.stage < st and e.stage < 6;
    else
      -- back to the furthest step still finished (never below handed over when the item was handed over by other means)
      update public.trk_equipment e set stage = greatest(st, case when new.grp = 'Operations' then 0 else least(e.stage, 1) end)
       where e.tracker_id = new.tracker_id and coalesce(e.barchart_key, e.tag) = new.equipment_key
         and e.stage = coalesce(case when new.grp = 'Operations' then 1 else new.stage end, -1) and e.stage > st;
    end if;
  end if;
  perform set_config('trk.sync', '', true);
  return null;
end $$;

-- bring the stages in line with the steps already finished
update public.trk_equipment e set stage = s.st, blinds_in_at = coalesce(e.blinds_in_at, now())
  from (select t.id tracker_id, k.key, public.trk_item_stage_from_steps(t.id, k.key, (select max(baseline) from public.trk_activities x where x.tracker_id = t.id)) st
          from public.trk_trackers t cross join lateral (select distinct equipment_key key from public.trk_activities a where a.tracker_id = t.id) k) s
 where e.tracker_id = s.tracker_id and coalesce(e.barchart_key, e.tag) = s.key and s.st > e.stage and e.stage < 6;

-- C-12-201: off S215, its own operations steps
update public.trk_points set items = array_remove(items, 'C-12-201') where kind = 'neut' and ref = 'S215';
insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, stage, tracked, baseline)
select t.id, v.id, 'Operations', 'C-12-201', v.txt, 1, true, (select max(baseline) from public.trk_activities x where x.tracker_id = t.id)
  from public.trk_trackers t cross join (values ('OP-01', 'Stop lube oil system'), ('OP-02', 'Isolate turbine (steam in / exhaust)'), ('OP-03', 'Blinds in & hand over')) v(id, txt)
 where exists (select 1 from public.trk_equipment e where e.tracker_id = t.id and e.tag = 'C-12-201')
   and not exists (select 1 from public.trk_activities a where a.tracker_id = t.id and a.equipment_key = 'C-12-201' and a.activity_id = v.id);
