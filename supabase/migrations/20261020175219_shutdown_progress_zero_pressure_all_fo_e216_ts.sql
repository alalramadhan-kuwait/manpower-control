-- "Confirm system at 0 pressure" is a general step for every FO: S105A (FO1, after S105) and S308A (FO3, after S308)
-- join S205A (FO2). E-216A/B tube side is soaked on its own (not part of S318): a separate neutralization before the
-- E-216A/B handover.
insert into public.trk_steps (tracker_id, step_id, fo, gate, gate_name, short_name, step_text, procedure, prereq, est_hours, note, equipment_covered, target_at, status)
select s.tracker_id, v.id, s.fo, s.gate, s.gate_name, 'Confirm system at 0 pressure', 'Confirm the system pressure is zero before the equipment is opened (general)', s.procedure, array[v.after], null, null, s.equipment_covered, s.target_at, 'not_started'
  from (values ('S105A', 'S105'), ('S308A', 'S308')) v(id, after) join public.trk_steps s on s.step_id = v.after
 where not exists (select 1 from public.trk_steps x where x.tracker_id = s.tracker_id and x.step_id = v.id);

insert into public.trk_points (tracker_id, kind, grp, ref, name, detail, fo, step_id, items, requires, method, before_ho, sort, status, soak_h)
select p.tracker_id, 'neut', null, 'E-216 T/S', 'E-216A/B tube side neutralization (soda ash soak)', 'E-216A/B tube side, soaked separately from S318', p.fo, null,
       array['E-12-216A', 'E-12-216B'], '{}', 'soak', true, p.sort + 1, 'open', p.soak_h
  from public.trk_points p where p.kind = 'neut' and p.ref = 'S321'
   and not exists (select 1 from public.trk_points x where x.tracker_id = p.tracker_id and x.ref = 'E-216 T/S');
