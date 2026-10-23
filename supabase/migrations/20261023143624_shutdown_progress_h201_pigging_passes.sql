-- H-12-201 pigging (A6300, 96 h, 25 Oct 19:00 to 29 Oct 19:00): done one pass at a time (Section Head, 23 Oct), so the
-- bar-chart line is split into four 24 h passes inside the same P6 window (the P6 line is kept, off, as with the other
-- splits). Progress as entered: pass 1 started 21 Oct and finished 23 Oct (from the P6 line, which had been renamed
-- "Pass 1 Pigging"), pass 2 started 23 Oct (from the step added in the field); the field-added pass 2-4 steps are
-- taken off, the passes keep their place in the item's order.
with p as (select a.* from public.trk_activities a where a.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and a.activity_id = 'A6300' and a.disabled_reason is null),
e2 as (select actual_start from public.trk_activities where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and activity_id = 'ENG-MVL2MFJL'),
s(n) as (values (1), (2), (3), (4))
insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline, actual_start, actual_finish, actual_note, seq, detail, p6_activity)
select p.tracker_id, 'A6300-' || s.n, p.grp, p.equipment_key, 'Pass ' || s.n || ' pigging', 24,
  p.planned_start + (s.n - 1) * interval '24 hours', p.planned_start + s.n * interval '24 hours',
  case when s.n = 4 then p.stage end, true, p.baseline,
  case s.n when 1 then p.actual_start when 2 then (select actual_start from e2) end,
  case s.n when 1 then p.actual_finish end,
  case when s.n <= 2 then 'Split of the 96 h pigging line into 4 passes (23 Oct)' end,
  p.seq + s.n - 1, false, coalesce(p.p6_activity, p.activity)
from p cross join s
where not exists (select 1 from public.trk_activities x where x.tracker_id = p.tracker_id and x.activity_id = 'A6300-' || s.n);

update public.trk_activities set tracked = false, disabled_reason = 'split'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and activity_id = 'A6300' and disabled_reason is null;
update public.trk_activities set tracked = false, disabled_reason = 'removed'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and activity_id in ('ENG-MVL2MFJL', 'ENG-MVL2MREI', 'ENG-MVL2MZGM') and disabled_reason is null;
