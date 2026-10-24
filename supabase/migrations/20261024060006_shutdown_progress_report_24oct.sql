-- Live tracker: progress from the 24 Oct status report, taking the more advanced of the report and the tracker for
-- each item. Steps only move forward; drums only go up.
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a';
begin
  -- done
  update trk_activities a set actual_start = coalesce(a.actual_start, now()), actual_finish = now()
  from (values ('R-12-203','A5190'),('E-12-216A','A5310-3')) v(k, id)
  where a.tracker_id = t and a.equipment_key = v.k and a.activity_id = v.id and a.actual_finish is null;
  -- started: trays cleaning (internal hydrojet) on R-201 / R-204, bundle cleaning on E-204 / E-205
  update trk_activities a set actual_start = now()
  from (values ('R-12-201','A8390'),('R-12-204','A6970'),('E-12-204','A5330'),('E-12-205','ROW-125')) v(k, id)
  where a.tracker_id = t and a.equipment_key = v.k and a.activity_id = v.id and a.actual_start is null;
  -- status lines
  update trk_equipment e set remark = v.r
  from (values ('R-12-201','Trays cleaning I/P'),('R-12-204','Trays cleaning I/P'),('R-12-202','Dumping I/P (68 drums)'),
    ('R-12-203','Dumping completed (1256 drums)'),('R-12-205','Vacuum dumping I/P (1104 drums)'),('E-12-204','Cleaning I/P'),('E-12-205','Cleaning I/P'),
    ('E-12-216A','Shell pulled out'),('V-12-209','Gas test OK, under ventilation'),('V-12-212','Gas test OK, under ventilation')) v(k, r)
  where e.tracker_id = t and e.tag = v.k and e.remark is distinct from v.r;
  -- drums: R-202 68 (first entry), R-205 to 1104 (+116); R-203 emptied
  insert into trk_qty_entry (scope_id, shift_date, shift, kind, method, qty, remark, source, entered_by_name, verify_state)
  select s.id, '2026-10-24', 'D', 'removal', v.m, v.q, v.r, 'plant_report', 'Section Head', 'verified'
  from trk_qty_scope s join (values ('R-12-202','free_fall',68,'24 Oct status report: total 68'),('R-12-205','vacuum',116,'24 Oct status report: total 1104')) v(k, m, q, r)
    on s.equipment_key = v.k where s.tracker_id = t and s.scope = 'removal';
  update trk_qty_scope set complete_at = now() where tracker_id = t and scope = 'removal' and equipment_key = 'R-12-203' and complete_at is null;
end $$;
