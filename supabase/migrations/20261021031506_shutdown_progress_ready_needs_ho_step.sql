-- An item that has its own operations "hand over" step (gas test & hand over …) is handed over when that step is done,
-- not by its neutralization and blinds alone: a vessel is still steamed and gas tested after the loop is drained.
-- Items without such a step keep the rule (neutralization done and blinds in = handed over). Items handed over by the
-- loops this way while their hand-over step is still open go back to not handed over.
create or replace function public.trk_item_ready(p_tracker uuid, p_tag text) returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.trk_points p where p.tracker_id = p_tracker and p_tag = any(p.items) and p.kind = 'neut' and p.before_ho)
     and not exists (select 1 from public.trk_points p where p.tracker_id = p_tracker and p_tag = any(p.items)
                       and ((p.kind = 'neut' and p.before_ho) or p.kind = 'blind') and not public.trk_point_complete(p))
     and not exists (select 1 from public.trk_equipment e join public.trk_activities a on a.tracker_id = e.tracker_id and a.equipment_key = coalesce(e.barchart_key, e.tag)
                      where e.tracker_id = p_tracker and e.tag = p_tag and a.grp = 'Operations' and a.tracked and coalesce(a.disabled_reason, '') = ''
                        and a.activity ~* 'hand ?over' and a.actual_finish is null
                        and a.baseline = (select max(x.baseline) from public.trk_activities x where x.tracker_id = p_tracker))
$$;

update public.trk_equipment e set stage = 0
 where e.stage = 1 and e.ops_item
   and exists (select 1 from public.trk_activities a where a.tracker_id = e.tracker_id and a.equipment_key = coalesce(e.barchart_key, e.tag) and a.grp = 'Operations'
                 and a.tracked and coalesce(a.disabled_reason, '') = '' and a.activity ~* 'hand ?over' and a.actual_finish is null
                 and a.baseline = (select max(x.baseline) from public.trk_activities x where x.tracker_id = e.tracker_id))
   and not exists (select 1 from public.trk_activities a where a.tracker_id = e.tracker_id and a.equipment_key = coalesce(e.barchart_key, e.tag)
                 and a.grp is distinct from 'Operations' and a.actual_finish is not null and a.stage >= 1
                 and a.baseline = (select max(x.baseline) from public.trk_activities x where x.tracker_id = e.tracker_id))
   and not exists (select 1 from public.trk_steps s where s.tracker_id = e.tracker_id and s.step_id = e.ho_step and s.status = 'done');
