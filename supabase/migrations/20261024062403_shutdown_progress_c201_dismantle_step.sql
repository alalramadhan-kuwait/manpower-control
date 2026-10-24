-- Live tracker, C-12-201 compressor (A3750) and C-12-201-ST turbine (A3760). Section Head, 24 Oct: in the workshop the
-- dismantling takes 3 days, then the overhaul (rotor replacement on the compressor), complete by 4 Nov.
-- The 288 h overhaul window (21 Oct 15:00 to 2 Nov 15:00) is split into a 72 h Dismantle step and the overhaul; the P6
-- line and the window stay as they are. What was running (since each shift to the workshop) is the dismantling; the
-- overhaul's hours are set so it ends 4 Nov 07:00 after the 3 days.
with t as (select '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'::uuid tid),
o as (select a.* from public.trk_activities a, t where a.tracker_id = t.tid and a.activity_id in ('A3750-5', 'A3760-5'))
insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline, actual_start, actual_note, detail, updated_at, updated_by_name)
select o.tracker_id, replace(o.activity_id, '-5', '-10'), o.grp, o.equipment_key, 'Dismantle (workshop)', 72,
  '2026-10-21T15:00:00+03:00', '2026-10-24T15:00:00+03:00', o.stage, true, o.baseline, o.actual_start,
  'Section Head 24 Oct: dismantling takes 3 days', false, now(), 'system'
from o
where not exists (select 1 from public.trk_activities x where x.tracker_id = o.tracker_id and x.activity_id = replace(o.activity_id, '-5', '-10'));

update public.trk_activities a set planned_start = '2026-10-24T15:00:00+03:00',
  duration_h = round(extract(epoch from ('2026-11-04T07:00:00+03:00'::timestamptz - (d.actual_start + interval '72 hours'))) / 3600),
  actual_start = null, actual_note = 'Section Head 24 Oct: after the 3-day dismantling, complete by 4 Nov', updated_at = now(), updated_by_name = 'system'
from public.trk_activities d
where a.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and a.activity_id in ('A3750-5', 'A3760-5') and a.actual_finish is null
  and d.tracker_id = a.tracker_id and d.activity_id = replace(a.activity_id, '-5', '-10') and d.actual_start is not null;

update public.trk_equipment set remark = 'In workshop: dismantling (3 d), overhaul complete by 4 Nov'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and tag in ('C-12-201', 'C-12-201-ST');
