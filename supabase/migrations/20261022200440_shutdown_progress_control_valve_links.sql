-- One record per control valve dropped in a neutralization procedure (FV-1426, FV-548, FV-1427, FV-1414, FV-1415).
-- Every procedure step that drops the valve is linked to it: one tap updates all of them (S111, S114, S115, S118).
-- The record keeps the time already recorded on the step that did the work.
with t as (select id tid from public.trk_trackers where id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'),
st as (
  select p.ref, s.seq, s.start_at, s.done_at, s.done_by_name from public.trk_point_step s join public.trk_points p on p.id = s.point_id, t
  where s.tracker_id = t.tid and (p.ref, s.seq) in (('S111', 2), ('S115', 3), ('S114', 4))
),
v(tag, ref, seq) as (values ('FV-1426', 'S111', 2), ('FV-548', 'S111', 2), ('FV-1427', 'S115', 3), ('FV-1414', 'S114', 4), ('FV-1415', 'S114', 4))
insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline, actual_start, actual_finish, actual_note, updated_by_name, detail)
select t.tid, 'CV-' || v.tag, 'Operations', v.tag, 'Drop control valve ' || v.tag || ' under +ve N2, B/M installed', null, null, null, null, true,
  (select max(baseline) from public.trk_activities a where a.tracker_id = t.tid), st.start_at, st.done_at, 'Control valve drop (neutralization procedures)', st.done_by_name, false
from v join st on st.ref = v.ref and st.seq = v.seq, t
where not exists (select 1 from public.trk_activities a where a.tracker_id = t.tid and a.activity_id = 'CV-' || v.tag);

with t as (select id tid from public.trk_trackers where id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'),
l(ref, seq, tags) as (values ('S111', 2, array['FV-1426', 'FV-548']), ('S118', 3, array['FV-1426']), ('S118', 4, array['FV-548', 'FV-1427']),
  ('S115', 3, array['FV-1427']), ('S114', 4, array['FV-1414', 'FV-1415']))
update public.trk_point_step s set link_acts = (select array_agg(a.id) from public.trk_activities a, t where a.tracker_id = t.tid and a.activity_id = any (select 'CV-' || x from unnest(l.tags) x))
from l, public.trk_points p, t
where p.id = s.point_id and p.ref = l.ref and s.seq = l.seq and s.tracker_id = t.tid;
