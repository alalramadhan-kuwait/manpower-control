-- Live tracker, C-12-201 / C-12-201-ST: status lines and step notes in the tracker's wording (hours, "I/P"), not days.
update public.trk_equipment set remark = 'Shifted to workshop, dismantling I/P'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and tag in ('C-12-201', 'C-12-201-ST');
update public.trk_activities set actual_note = case
    when activity_id like '%-10' then 'Section Head 24 Oct: dismantling 72 h'
    else 'Section Head 24 Oct: after dismantling, complete by 4 Nov 07:00' end
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and activity_id in ('A3750-10', 'A3760-10', 'A3750-5', 'A3760-5');
