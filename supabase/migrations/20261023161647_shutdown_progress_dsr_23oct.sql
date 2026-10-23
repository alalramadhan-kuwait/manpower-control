-- Live tracker: progress from the 23 Oct day status report (WhatsApp text + DSR sheet), taking the more advanced of
-- the two and the tracker for each item. Steps only move forward; drums only go up.
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a';
begin
  -- steps done (a step not started gets start = finish = now)
  update trk_activities a set actual_start = coalesce(a.actual_start, now()), actual_finish = now()
  from (values ('R-12-201','A8380-2'),('H-12-201','A6300-2'),('H-12-202','A4380-2'),
    ('E-12-216A','A5310-1'),('E-12-216A','A5310-2'),('E-12-216B','A7920-1'),('E-12-216B','A7920-2'),('E-12-216B','A7920-3'),
    ('E-12-211','A1910'),('E-12-211','A1920'),('E-12-229','A9270'),
    ('V-12-210','ROW-230'),('V-12-210','ROW-231-1'),('V-12-210','ROW-231-2'),('V-12-206','ROW-225-1'),('V-12-206','ROW-225-2'),
    ('V-12-209','A9620-1'),('V-12-212','A9710-1'),('V-12-212','A9710-2'),('V-12-213','A9800-1'),('V-12-213','A9800-2'),
    ('F-12-202','A4870'),('C-12-201','A3750-4'),('C-12-201-F-01B','ROW-243'),('12-PSV-0537','A8130'),('12-PSV-0601','A4130'),
    ('RTJ / Inspection','A2600')) v(k, id)
  where a.tracker_id = t and a.equipment_key = v.k and a.activity_id = v.id and a.actual_finish is null;
  -- steps started
  update trk_activities a set actual_start = now()
  from (values ('E-12-216A','A5310-3'),('E-12-211','A1930'),('V-12-201','A9472'),('C-12-201','A3750-5'),('RTJ / Inspection','A5990')) v(k, id)
  where a.tracker_id = t and a.equipment_key = v.k and a.activity_id = v.id and a.actual_start is null;
  -- status lines
  update trk_equipment e set remark = v.r
  from (values ('R-12-201','Dumping completed, collector ring removed'),('R-12-202','Trays removed, dumping I/P'),
    ('R-12-203','Dumping I/P (1256 drums)'),('R-12-204','Dumping completed, hanging tray removal I/P, collector ring to be removed'),
    ('R-12-205','Vacuum dumping I/P (988 drums)'),('H-12-201','Pass-2 pigging done, pass-3 to start'),('H-12-202','Manways opened, under ventilation'),
    ('E-12-204','Bundle pulled out, hydroblasting to start'),('E-12-205','Bundle pulled out, hydroblasting to start'),
    ('E-12-216A','Shell pull-out I/P'),('E-12-216B','Shell pulled out, hydroblasting to start'),
    ('E-12-207','Shell hydroblasting done, bundle external cleaning I/P'),('E-12-211','Hydroblasting done, buffing I/P, under inspection'),
    ('E-12-229','Blinding done, spool removal to start'),('V-12-201','Under inspection'),('V-12-202','Cleaning done, painting I/P'),
    ('V-12-210','Cleaning done, painting I/P'),('V-12-206','Manway opened, under ventilation'),('V-12-209','Gas test not OK for entry, under ventilation'),
    ('V-12-212','Manway opened, under ventilation'),('V-12-213','Manway opened, under ventilation, scaffolding to start'),
    ('V-12-236','Hydroblasting done, grit blasting to start'),('F-12-202','Cleaning completed'),('C-12-201','Shifted to shop, under overhauling'),
    ('C-12-201-ST','Casing bolt removal I/P'),('C-12-201-F-01B','Filter removed'),('12-PSV-0537','Dropped'),('12-PSV-0601','Dropped'),
    ('RTJ / Inspection','RTJ flanges inspection I/P'),('MAB-2931','Welding I/P'),('MAB-3596','Material arrives 25 Oct, ETC 2 Nov')) v(k, r)
  where e.tracker_id = t and e.tag = v.k and e.remark is distinct from v.r;
  -- PSVs dropped and PMRs handed over
  update trk_equipment set stage = 2 where tracker_id = t and tag in ('12-PSV-0537','12-PSV-0601') and stage < 2;
  update trk_equipment set stage = 1 where tracker_id = t and grp = 'PMRs' and stage < 1;
  -- drums: R-203 to 1256 (+1206, a correction on today's day entry), R-205 to 988 (+132)
  insert into trk_qty_entry (scope_id, shift_date, shift, kind, method, qty, corrects, remark, source, entered_by_name, verify_state)
  select s.id, '2026-10-23', 'D', 'correction', 'free_fall', 1206, e.id, '23 Oct status report: total 1256', 'plant_report', 'Section Head', 'verified'
  from trk_qty_scope s join trk_qty_entry e on e.scope_id = s.id and e.shift_date = '2026-10-23' and e.shift = 'D' and e.kind = 'removal' and e.method = 'free_fall'
  where s.tracker_id = t and s.scope = 'removal' and s.equipment_key = 'R-12-203';
  insert into trk_qty_entry (scope_id, shift_date, shift, kind, method, qty, remark, source, entered_by_name, verify_state)
  select s.id, '2026-10-23', 'D', 'removal', 'vacuum', 132, '23 Oct status report: total 988', 'plant_report', 'Section Head', 'verified'
  from trk_qty_scope s where s.tracker_id = t and s.scope = 'removal' and s.equipment_key = 'R-12-205';
end $$;
