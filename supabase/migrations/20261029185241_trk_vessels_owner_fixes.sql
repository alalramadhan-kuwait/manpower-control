-- Vessels (Train-2), owner's answers, 29 Oct 2026. Nothing recorded is removed.
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a';
begin
  -- V-209, V-236: small vessels, no internal scaffold, so removing it is not required (never started)
  update public.trk_activities set tracked = false, disabled_reason = 'not required: small vessel, no internal scaffold'
  where tracker_id = t and ((equipment_key = 'V-12-209' and activity_id = 'A9680') or (equipment_key = 'V-12-236' and activity_id = 'A6380')) and actual_start is null;
  -- V-212: the internal cleaning is the same work as "Comp Suc Drum Inspection And Demister Cleaning" (done 27 Oct): same time
  update public.trk_activities a set actual_start = c.actual_start, actual_finish = c.actual_finish,
    time_reason = 'same work as "Comp Suc Drum Inspection And Demister Cleaning" (owner, 29 Oct 2026)'
  from public.trk_activities c
  where a.tracker_id = t and a.equipment_key = 'V-12-212' and a.activity_id = 'A9740' and a.actual_finish is null
    and c.tracker_id = t and c.equipment_key = 'V-12-212' and c.activity_id = 'A7430' and c.actual_finish is not null;
  -- V-201 (inspection item): repair if required after the inspection, no plan time
  update public.trk_activities set seq = seq + 1 where tracker_id = t and equipment_key = 'V-12-201' and seq >= 7
    and not exists (select 1 from public.trk_activities where tracker_id = t and activity_id = 'ENG-V201-REPAIR');
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, stage, tracked, baseline, seq, detail)
  select t, 'ENG-V201-REPAIR', 'Procedure', 'V-12-201', 'Repair if required', null, null, true, 1, 7, false
  where not exists (select 1 from public.trk_activities where tracker_id = t and activity_id = 'ENG-V201-REPAIR');
end $$;
