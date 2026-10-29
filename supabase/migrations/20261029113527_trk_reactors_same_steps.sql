-- R-201..R-204 (Train-2) have the same internals and scope: one step list for all four (owner, 29 Oct 2026).
-- Steps a person set 'not required' on one reactor stay so; missing steps are added; nothing recorded is removed.
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a';
begin
  -- R-201: the same names as the others
  update public.trk_activities set activity = 'Offer for Process' where tracker_id = t and equipment_key = 'R-12-201' and activity_id = 'A8400';
  update public.trk_activities set activity = 'Cleaning all internal by Hydrojet' where tracker_id = t and equipment_key = 'R-12-201' and activity_id = 'A8390';
  update public.trk_activities set activity = 'Manual cleaning as per inspection' where tracker_id = t and equipment_key = 'R-12-201' and activity_id = 'A8380-2';
  update public.trk_activities set activity = 'Re-install insulation if Required' where tracker_id = t and equipment_key = 'R-12-201' and activity_id = 'A8460';
  -- R-201: removing scaffolding is not required, as on R-202..R-204 (it was never started; loading preparation is done)
  update public.trk_activities set tracked = false, disabled_reason = 'not required' where tracker_id = t and equipment_key = 'R-12-201' and activity_id = 'A8435-1' and actual_start is null;
  -- R-202: the two steps the others have
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, stage, tracked, baseline, seq, detail, actual_start, actual_finish, actual_note, time_reason)
  select t, 'ENG-R202-MANCLN', 'Reactors', 'R-12-202', 'Manual cleaning as per inspection', null, 2, true, 1, 8, false,
         '2026-10-27 10:11:36.494+00', '2026-10-27 10:11:36.494+00', 'time not recorded', 'added to match R-201..R-204 (owner, 29 Oct 2026): done before hydrojetting'
  where not exists (select 1 from public.trk_activities where tracker_id = t and activity_id = 'ENG-R202-MANCLN');
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, stage, tracked, baseline, seq, detail)
  select t, 'ENG-R202-COLRING', 'Procedure', 'R-12-202', 'Collector ring', null, null, true, 1, 10, false
  where not exists (select 1 from public.trk_activities where tracker_id = t and activity_id = 'ENG-R202-COLRING');
  -- R-202: the same order as R-203
  update public.trk_activities a set seq = s.seq from (values
    ('A3881-1',1),('A3881-2',2),('A4750-1',3),('A4750-2',4),('A4750-3',5),('A3881-3',6),('A5180',7),('A6670',9),('A7070',11),('A6140',12),
    ('A7140',13),('A7150',14),('A7160',15),('A7170',16),('A7470-1',17),('A7470-2',18),('A7510-1',19),('A7510-2',20),('A7650-1',21),('A7710',22),('A7650-2',23)) s(id, seq)
  where a.tracker_id = t and a.equipment_key = 'R-12-202' and a.activity_id = s.id;
end $$;
