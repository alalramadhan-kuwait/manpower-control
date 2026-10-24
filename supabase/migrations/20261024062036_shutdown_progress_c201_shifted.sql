-- Live tracker: C-201 compressor and turbine both shifted to the workshop (Section Head, 24 Oct).
-- Dismantling takes 3 days; overhaul / rotor replacement and turbine overhaul expected complete by 4 Nov.
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a';
  n text := 'Section Head 24 Oct: in workshop, dismantling 3 days, overhaul complete by 4 Nov';
begin
  update trk_activities set actual_finish = now(), actual_note = 'Shifted (Section Head, 24 Oct)', updated_at = now(), updated_by_name = 'system'
   where tracker_id = t and equipment_key = 'C-12-201-ST' and activity_id = 'A3760-4' and actual_finish is null;
  update trk_activities set actual_start = coalesce(actual_start, now()), actual_note = n, updated_at = now(), updated_by_name = 'system'
   where tracker_id = t and ((equipment_key = 'C-12-201-ST' and activity_id = 'A3760-5') or (equipment_key = 'C-12-201' and activity_id = 'A3750-5'))
     and actual_finish is null;
  update trk_equipment set remark = 'In workshop: dismantling (3 d), overhaul by 4 Nov'
   where tracker_id = t and tag in ('C-12-201','C-12-201-ST');
end $$;
