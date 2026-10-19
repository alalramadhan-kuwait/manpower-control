-- the neutralization loops take the items of their step (the list is comma separated)
update public.trk_points p
   set items = array(select distinct x from unnest(regexp_split_to_array(coalesce(s.equipment_covered, ''), '\s*[,;]\s*') || p.items) x
                      where exists (select 1 from public.trk_equipment e where e.tracker_id = p.tracker_id and e.tag = x))
  from public.trk_steps s
 where p.kind = 'neut' and s.tracker_id = p.tracker_id and s.step_id = p.step_id;
