-- A finished maintenance step no longer raises an item that is not handed over (stage 0): completed work does not
-- mean a formal handover. Handed-over items still follow their steps as before; blind lines (blinded = handed over)
-- and the Operations handover step keep their rule. Items left behind show in the tracker's stage review for a
-- person to decide. Existing stages are not changed by this migration.
create or replace function public.trk_act_sync_stage() returns trigger
language plpgsql security definer set search_path to 'public' as $$
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
      -- maintenance steps move only an item already handed over; the Operations handover step itself hands it over
      update public.trk_equipment e set stage = st, blinds_in_at = coalesce(e.blinds_in_at, new.actual_finish)
       where e.tracker_id = new.tracker_id and coalesce(e.barchart_key, e.tag) = new.equipment_key and e.stage < st and e.stage < 6
         and (e.stage >= 1 or new.grp = 'Operations');
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
