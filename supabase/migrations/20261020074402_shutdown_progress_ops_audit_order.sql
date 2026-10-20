-- Operations steps audit. The Section Head follows the milestones: the field detail (closing valves, CW, vents, L/O
-- discharges, dampers ...) is flagged detail and hidden for now, kept for the field operator later. The permit steps
-- (toolbox talk, confirm permit and blind list) are removed (kept in the table, disabled 'removed'). The general
-- "confirm system pressure zero" moves from V-12-236 to the unit Sequence (S205A). Each item's work steps can be put in
-- order by hand (seq), saved through trk_set_order and logged, and kept across bar-chart imports.

alter table public.trk_activities add column if not exists seq int;
alter table public.trk_activities add column if not exists detail boolean not null default false;

update public.trk_activities set disabled_reason = 'removed', tracked = false
 where grp = 'Operations' and activity in ('Toolbox talk & permit', 'Confirm permit & blind list');
update public.trk_activities set disabled_reason = 'unit', tracked = false
 where grp = 'Operations' and activity = 'Confirm system pressure zero';
update public.trk_activities set activity = 'Gas test for shell entry'
 where grp = 'Operations' and activity = 'Gas test & CSE permit';

update public.trk_activities a set detail = true
  from (values
    ('R-12-201', 'N2 sweep to V-206'),
    ('R-12-202', 'N2 sweep to V-206'),
    ('R-12-203', 'N2 sweep to V-206'),
    ('R-12-204', 'N2 sweep to V-206'),
    ('R-12-201', 'Dummy plates + N2 on manway'),
    ('R-12-202', 'Dummy plates + N2 on manway'),
    ('R-12-203', 'Dummy plates + N2 on manway'),
    ('R-12-204', 'Dummy plates + N2 on manway'),
    ('R-12-201', 'N2 slide valves, bed <150°F'),
    ('R-12-202', 'N2 slide valves, bed <150°F'),
    ('R-12-203', 'N2 slide valves, bed <150°F'),
    ('R-12-204', 'N2 slide valves, bed <150°F'),
    ('R-12-205', 'Close KV-01B..13B'),
    ('R-12-205', 'Connect N2 hoses'),
    ('R-12-205', 'Keep reactor under N2'),
    ('H-12-201', 'Isolate fuel oil BVs'),
    ('H-12-201', 'Isolate snuffing + soot steam'),
    ('H-12-201', 'Inj. water off, swing elbow'),
    ('H-12-201', 'Open damper & peepholes'),
    ('H-12-202', 'Close FV-548/1427 outlet'),
    ('H-12-202', 'Isolate fuel oil BVs'),
    ('H-12-202', 'Isolate snuffing + soot steam'),
    ('H-12-202', 'Isolate BFW & 60# steam'),
    ('H-12-202', 'Open damper & peepholes'),
    ('V-12-202', 'Open DX & LV-5__ drains'),
    ('V-12-210', 'Open DX & LV-5__ drains'),
    ('V-12-206', 'Close LV-531, stop LB-203'),
    ('V-12-212', 'Deblind 12" vent, wedge MOV'),
    ('V-12-212', 'Cool down, water wash'),
    ('V-12-212', 'Wet walls, drum scale out'),
    ('V-12-236', 'N2 push to sour water'),
    ('V-12-236', 'Depressurise V-236'),
    ('E-12-207', 'Verify blinds & car seals'),
    ('E-12-211', 'Rig steam & drain hoses'),
    ('E-12-211', 'Wedge open BV-2206 flange'),
    ('E-12-211', 'Verify blinds & car seals'),
    ('E-12-216A', 'Throttle FV-522 to 10%'),
    ('E-12-216B', 'Throttle FV-522 to 10%'),
    ('E-12-216A', 'Close S/S O/L BV'),
    ('E-12-216B', 'Close S/S O/L BV'),
    ('C-12-201-E-01A', 'Close L/O pump discharges'),
    ('C-12-201-E-01B', 'Close L/O pump discharges'),
    ('C-12-201-E-01A', 'Close CW supply & return'),
    ('C-12-201-E-01B', 'Close CW supply & return'),
    ('C-12-201-E-01A', 'Close cooler vent BV'),
    ('C-12-201-E-01B', 'Close cooler vent BV'),
    ('C-12-201-E-01A', 'Blind S/S 3-way valve'),
    ('C-12-201-E-01B', 'Blind S/S 3-way valve'),
    ('C-12-201-E-01A', 'E-01_ stays: blind balance'),
    ('C-12-201-E-01B', 'E-01_ stays: blind balance'),
    ('C-12-201-E-01A', 'Verify blinds & car seals'),
    ('C-12-201-E-01B', 'Verify blinds & car seals'),
    ('C-12-201-E-03', 'C-201 stopped & cooled'),
    ('C-12-201-E-03', 'Close CW to E-03'),
    ('C-12-201-E-03', 'Close turbine seal steam B/V'),
    ('C-12-201-E-03', 'Blind seal steam BV'),
    ('C-12-201-E-03', 'Verify blinds & car seals'),
    ('C-12-201-EJ-01', 'C-201 stopped & cooled'),
    ('C-12-201-EJ-01', 'Close 60# steam B/V to EJ-01'),
    ('C-12-201-EJ-01', 'Verify blinds & car seals'),
    ('C-12-201-TK-01', 'C-201 cool, stop L/O pumps'),
    ('C-12-201-TK-01', 'Close suction & return BVs'),
    ('C-12-201-TK-01', 'Close vents, N2 & drains'),
    ('C-12-201-TK-01', 'De-energize tank heater'),
    ('C-12-201-TK-01', 'Deblind drain, oil to DX'),
    ('C-12-201-TK-01', 'Verify blinds & car seals'),
    ('P-12-203-E-01A', 'Close L/O pump discharges'),
    ('P-12-203-E-01B', 'Close L/O pump discharges'),
    ('P-12-203-E-01A', 'Close CW supply & return'),
    ('P-12-203-E-01B', 'Close CW supply & return'),
    ('P-12-203-E-01A', 'Close cooler vent BV'),
    ('P-12-203-E-01B', 'Close cooler vent BV'),
    ('P-12-203-E-01A', 'Verify blinds & car seals'),
    ('P-12-203-E-01B', 'Verify blinds & car seals'),
    ('P-12-205-E-01', 'Close L/O pump discharges'),
    ('P-12-205-E-01', 'Close CW supply & return'),
    ('P-12-205-E-01', 'Close cooler vent BV'),
    ('P-12-205-E-01', 'Verify blinds & car seals')
  ) v(key, pat)
 where a.grp = 'Operations' and a.equipment_key = v.key and a.activity like v.pat;

-- the general step, on the unit: FO2 with the V-206/207/208/236 emptying
insert into public.trk_steps (tracker_id, step_id, fo, gate, gate_name, short_name, step_text, procedure, prereq, est_hours, note, equipment_covered, target_at, status)
select s.tracker_id, 'S205A', s.fo, s.gate, s.gate_name, 'Confirm system at 0 pressure', 'Confirm the system pressure is zero before the vessels are opened (general)', s.procedure, array['S205'], null, null, s.equipment_covered, s.target_at, 'not_started'
  from public.trk_steps s where s.step_id = 'S205'
   and not exists (select 1 from public.trk_steps x where x.tracker_id = s.tracker_id and x.step_id = 'S205A');

-- put an item's work steps in order: p_ids in the new order (the others keep theirs), logged old and new order
create or replace function public.trk_set_order(p_tracker uuid, p_key text, p_ids uuid[]) returns void language plpgsql security definer set search_path = public as $$
declare old_list text; new_list text;
begin
  if not public.trk_can_update() then raise exception 'Not allowed to change the order.'; end if;
  select string_agg(activity, ' > ' order by seq nulls last, activity_id) into old_list from public.trk_activities
   where tracker_id = p_tracker and equipment_key = p_key and id = any(p_ids);
  if p_ids is null or cardinality(p_ids) = 0 then
    update public.trk_activities set seq = null where tracker_id = p_tracker and equipment_key = p_key;
  else
    update public.trk_activities a set seq = o.n from unnest(p_ids) with ordinality o(id, n) where a.id = o.id and a.tracker_id = p_tracker and a.equipment_key = p_key;
  end if;
  select string_agg(a.activity, ' > ' order by o.n) into new_list from unnest(p_ids) with ordinality o(id, n) join public.trk_activities a on a.id = o.id;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  values (p_tracker, 'activity', p_key, 'order', old_list, coalesce(new_list, 'plan order'), auth.uid(), public.trk_who());
end $$;
grant execute on function public.trk_set_order(uuid, text, uuid[]) to authenticated;

-- the bar-chart import keeps the order set by hand and the detail flag
create or replace function public.trk_import_barchart(p_tracker uuid, p_rows jsonb) returns integer language plpgsql security definer set search_path = public as $$
declare t public.trk_trackers; b int; n int;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head imports the bar chart.'; end if;
  select * into t from public.trk_trackers where id = p_tracker;
  if t.id is null or t.mode = 'template' then raise exception 'Import into a test or live tracker.'; end if;
  select coalesce(max(baseline), 0) + 1 into b from public.trk_activities where tracker_id = p_tracker;
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline, actual_start, actual_finish, actual_note, seq)
  select p_tracker, r->>'activity_id', nullif(r->>'group', ''), r->>'equipment_key', r->>'activity', nullif(r->>'duration_h', '')::numeric,
         nullif(r->>'planned_start', '')::timestamptz, nullif(r->>'planned_finish', '')::timestamptz, nullif(r->>'stage', '')::int,
         coalesce(nullif(r->>'tracked', '')::int, 1) = 1, b, prev.actual_start, prev.actual_finish, prev.actual_note, prev.seq
    from jsonb_array_elements(p_rows) r
    left join lateral (select a.actual_start, a.actual_finish, a.actual_note, a.seq from public.trk_activities a
       where a.tracker_id = p_tracker and a.baseline = b - 1 and a.activity_id = r->>'activity_id' and a.equipment_key = r->>'equipment_key' limit 1) prev on true
   where coalesce(r->>'activity_id', '') <> '' and coalesce(r->>'equipment_key', '') <> '';
  get diagnostics n = row_count;
  -- the operations and procedure steps are not in the bar chart: they move to the new baseline as they are
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, baseline, actual_start, actual_finish, actual_note, seq, detail)
  select p_tracker, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, b, actual_start, actual_finish, actual_note, seq, detail
    from public.trk_activities where tracker_id = p_tracker and baseline = b - 1 and grp in ('Operations', 'Procedure');
  if t.mode = 'test' and t.template_id is not null then
    insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline, disabled_reason, detail)
    select t.template_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked,
           (select coalesce(max(baseline), 0) + 1 from public.trk_activities where tracker_id = t.template_id), disabled_reason, detail
      from public.trk_activities where tracker_id = p_tracker and baseline = b;
    perform public.trk_split_lines(t.template_id);
  end if;
  perform public.trk_split_lines(p_tracker);
  return n;
end $$;

-- copies (test from template, new shutdown) carry the detail flag and the order
create or replace function public.trk_copy(p_src uuid, p_dst uuid, p_progress boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.trk_steps (tracker_id, step_id, fo, gate, gate_name, short_name, step_text, procedure, prereq, est_hours, note, equipment_covered, target_at, status, pending_reason, remark)
  select p_dst, step_id, fo, gate, gate_name, short_name, step_text, procedure, prereq, est_hours, note, equipment_covered, target_at,
         case when p_progress then status else 'not_started' end, case when p_progress then pending_reason end, case when p_progress then remark end
    from public.trk_steps where tracker_id = p_src;
  insert into public.trk_equipment (tracker_id, tag, grp, description, fo, ho_step, procedure, barchart_key, ops_item, critical, tracked, disabled_reason, planned_ho, planned_finish, sort, stage, pending_reason, remark)
  select p_dst, tag, grp, description, fo, ho_step, procedure, barchart_key, ops_item, critical, tracked, disabled_reason, planned_ho, planned_finish, sort,
         case when p_progress then stage else 0 end, case when p_progress then pending_reason end, case when p_progress then remark end
    from public.trk_equipment where tracker_id = p_src;
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, baseline, detail, seq)
  select p_dst, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, 1, detail, seq
    from public.trk_activities a where tracker_id = p_src and baseline = (select max(baseline) from public.trk_activities where tracker_id = p_src);
  insert into public.trk_points (tracker_id, kind, grp, ref, name, detail, fo, step_id, items, requires, before_ho, sort, status, in_at, out_at, fill_at, soak_at, drain_at, done_at, soak_h, remark)
  select p_dst, kind, grp, ref, name, detail, fo, step_id, items, requires, before_ho, sort, case when p_progress then status else 'open' end,
         case when p_progress then in_at end, case when p_progress then out_at end, case when p_progress then fill_at end, case when p_progress then soak_at end,
         case when p_progress then drain_at end, case when p_progress then done_at end, soak_h, case when p_progress then remark end
    from public.trk_points where tracker_id = p_src;
end $$;
