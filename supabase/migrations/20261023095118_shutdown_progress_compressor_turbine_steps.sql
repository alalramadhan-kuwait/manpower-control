-- C-12-201 compressor (A3750) and C-12-201-ST turbine (A3760): the bar chart's single 360 h overhaul line split into its
-- steps inside the same P6 window (20 Oct 07:00 to 4 Nov 07:00; the P6 line is kept, off, as with the other splits).
-- Section Head, 23 Oct: blinding, scaffolding and the housing removal (crane access) are pre-steps, then the move to the
-- workshop; the fixing-back steps close the window. Progress as reported: blinding done (blinds in and handover
-- 20 Oct 13:00), scaffolding and housing removal done, shifting to the workshop in progress (from the overhaul's start).
with t as (select '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'::uuid tid),
p as (select a.* from public.trk_activities a, t where a.tracker_id = t.tid and a.activity_id in ('A3750', 'A3760') and a.disabled_reason is null),
s(n, name, ps, pf, h, stage, done) as (values
  (1, 'Blinding', '2026-10-20T07:00:00+03:00', '2026-10-20T15:00:00+03:00', 8, 1, 'ho'),
  (2, 'Scaffolding', '2026-10-20T07:00:00+03:00', '2026-10-20T19:00:00+03:00', 12, null, 'start'),
  (3, 'Remove housing for crane access', '2026-10-20T19:00:00+03:00', '2026-10-21T07:00:00+03:00', 12, null, 'start'),
  (4, 'Shift to workshop', '2026-10-21T07:00:00+03:00', '2026-10-21T15:00:00+03:00', 8, null, 'run'),
  (5, '#overhaul', '2026-10-21T15:00:00+03:00', '2026-11-02T15:00:00+03:00', 288, null, null),
  (6, 'Shift back from workshop', '2026-11-02T15:00:00+03:00', '2026-11-02T23:00:00+03:00', 8, null, null),
  (7, 'Box-up, housing back', '2026-11-02T23:00:00+03:00', '2026-11-03T11:00:00+03:00', 12, null, null),
  (8, 'Remove scaffolding', '2026-11-03T11:00:00+03:00', '2026-11-03T23:00:00+03:00', 12, null, null),
  (9, 'Deblind', '2026-11-03T23:00:00+03:00', '2026-11-04T07:00:00+03:00', 8, null, null))
insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline, actual_start, actual_finish, actual_note, seq, detail)
select p.tracker_id, p.activity_id || '-' || s.n, p.grp, p.equipment_key,
  case when s.name = '#overhaul' then case p.activity_id when 'A3750' then 'Compressor overhaul and rotor replacement (workshop)' else 'Turbine overhaul (workshop)' end else s.name end,
  s.h, s.ps::timestamptz, s.pf::timestamptz, coalesce(s.stage, case when s.n = 5 then p.stage end), true, p.baseline,
  case s.done when 'ho' then '2026-10-20T13:00:00+03:00'::timestamptz when 'start' then p.actual_start when 'run' then p.actual_start end,
  case s.done when 'ho' then '2026-10-20T13:00:00+03:00'::timestamptz when 'start' then p.actual_start end,
  case when s.done is not null then 'Split of the 360 h overhaul line (23 Oct)' end, null, false
from p cross join s
where not exists (select 1 from public.trk_activities x where x.tracker_id = p.tracker_id and x.activity_id = p.activity_id || '-' || s.n);

update public.trk_activities set tracked = false, disabled_reason = 'split'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and activity_id in ('A3750', 'A3760') and disabled_reason is null;
