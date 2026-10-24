-- C-12-201-ST: handed over by Operations and blinded (confirmed by the Section Head, 24 Oct 2026). The handover was
-- never recorded on the item: its blind line (A3760-1) was loaded by a migration, so the stage sync did not run, and
-- its shared handover step S223 is still open. Recorded now from the evidence already in the tracker: stage HO and
-- blinds in at the blind line's recorded finish (20 Oct 13:00 Kuwait). Only if still not recorded; logged by trigger.
update public.trk_equipment e set stage = 1, blinds_in_at = a.actual_finish, updated_by_name = 'Section Head (confirmed 24 Oct)'
  from public.trk_activities a
 where e.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and e.tag = 'C-12-201-ST' and e.stage = 0 and e.blinds_in_at is null
   and a.tracker_id = e.tracker_id and a.equipment_key = 'C-12-201-ST' and a.activity_id = 'A3760-1' and a.actual_finish is not null;
