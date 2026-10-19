-- Operations steps from the handover procedures (isolation, draining, N2 purge, steam-out, gas test, handover …), one
-- work step per field action on each item, before the bar-chart (M & I) steps. Items already handed over get them done
-- at the handover time. A bar-chart import keeps the operations and procedure steps. Neutralization: every loop and
-- reactor soaks 4 h, the FT/FV-681…684 feed-line neutralization (after H-201 decoking) is added. Blinds: R-204 O/L is
-- HP critical, C-201 to V-126 segregation (HP critical blinding procedure), and the points holding several blinds say so.

create or replace function public.trk_import_barchart(p_tracker uuid, p_rows jsonb) returns integer language plpgsql security definer set search_path = public as $$
declare t public.trk_trackers; b int; n int;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head imports the bar chart.'; end if;
  select * into t from public.trk_trackers where id = p_tracker;
  if t.id is null or t.mode = 'template' then raise exception 'Import into a test or live tracker.'; end if;
  select coalesce(max(baseline), 0) + 1 into b from public.trk_activities where tracker_id = p_tracker;
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline, actual_start, actual_finish, actual_note)
  select p_tracker, r->>'activity_id', nullif(r->>'group', ''), r->>'equipment_key', r->>'activity', nullif(r->>'duration_h', '')::numeric,
         nullif(r->>'planned_start', '')::timestamptz, nullif(r->>'planned_finish', '')::timestamptz, nullif(r->>'stage', '')::int,
         coalesce(nullif(r->>'tracked', '')::int, 1) = 1, b, prev.actual_start, prev.actual_finish, prev.actual_note
    from jsonb_array_elements(p_rows) r
    left join lateral (select a.actual_start, a.actual_finish, a.actual_note from public.trk_activities a
       where a.tracker_id = p_tracker and a.baseline = b - 1 and a.activity_id = r->>'activity_id' and a.equipment_key = r->>'equipment_key' limit 1) prev on true
   where coalesce(r->>'activity_id', '') <> '' and coalesce(r->>'equipment_key', '') <> '';
  get diagnostics n = row_count;
  -- the operations and procedure steps are not in the bar chart: they move to the new baseline as they are
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, baseline, actual_start, actual_finish, actual_note)
  select p_tracker, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, b, actual_start, actual_finish, actual_note
    from public.trk_activities where tracker_id = p_tracker and baseline = b - 1 and grp in ('Operations', 'Procedure');
  if t.mode = 'test' and t.template_id is not null then
    insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline)
    select t.template_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked,
           (select coalesce(max(baseline), 0) + 1 from public.trk_activities where tracker_id = t.template_id)
      from public.trk_activities where tracker_id = p_tracker and baseline = b;
    perform public.trk_split_lines(t.template_id);
  end if;
  perform public.trk_split_lines(p_tracker);
  return n;
end $$;

with s(tag, n, txt, h) as (values
    ('R-12-201', 1, 'Isolate inlet, bypass & quench gas valves', null),
    ('R-12-201', 2, 'Drain HC to P/O via O/L hoses, repeat', null),
    ('R-12-201', 3, 'N2 sweep via I/L vent & O/L PGs to V-206', null),
    ('R-12-201', 6, 'Fit dummy plates + N2 on inlet & manway', null),
    ('R-12-201', 7, 'N2 purge from bottom O/L thermowell', null),
    ('R-12-201', 8, 'Neutralize reactor inter-piping (S113)', null),
    ('R-12-201', 12, 'Fit N2 slide valves, bed temp <150°F', null),
    ('R-12-201', 13, 'Gas test H2S≤10ppm LEL≤10% CO≤50 O2≤4%', null),
    ('R-12-201', 14, 'Hand over for inert entry / tray removal', null),
    ('R-12-202', 1, 'Isolate inlet, bypass & quench gas valves', null),
    ('R-12-202', 2, 'Drain HC to P/O via O/L hoses, repeat', null),
    ('R-12-202', 3, 'N2 sweep via I/L vent & O/L PGs to V-206', null),
    ('R-12-202', 6, 'Fit dummy plates + N2 on inlet & manway', null),
    ('R-12-202', 7, 'N2 purge from bottom O/L thermowell', null),
    ('R-12-202', 8, 'Neutralize reactor inter-piping (S113)', null),
    ('R-12-202', 12, 'Fit N2 slide valves, bed temp <150°F', null),
    ('R-12-202', 13, 'Gas test H2S≤10ppm LEL≤10% CO≤50 O2≤4%', null),
    ('R-12-202', 14, 'Hand over for inert entry / tray removal', null),
    ('R-12-203', 1, 'Isolate inlet, bypass & quench gas valves', null),
    ('R-12-203', 2, 'Drain HC to P/O via O/L hoses, repeat', null),
    ('R-12-203', 3, 'N2 sweep via I/L vent & O/L PGs to V-206', null),
    ('R-12-203', 6, 'Fit dummy plates + N2 on inlet & manway', null),
    ('R-12-203', 7, 'N2 purge from bottom O/L thermowell', null),
    ('R-12-203', 8, 'Neutralize reactor inter-piping (S113)', null),
    ('R-12-203', 12, 'Fit N2 slide valves, bed temp <150°F', null),
    ('R-12-203', 13, 'Gas test H2S≤10ppm LEL≤10% CO≤50 O2≤4%', null),
    ('R-12-203', 14, 'Hand over for inert entry / tray removal', null),
    ('R-12-204', 1, 'Isolate inlet, bypass & quench gas valves', null),
    ('R-12-204', 2, 'Drain HC to P/O via O/L hoses, repeat', null),
    ('R-12-204', 3, 'N2 sweep via I/L vent & O/L PGs to V-206', null),
    ('R-12-204', 6, 'Fit dummy plates + N2 on inlet & manway', null),
    ('R-12-204', 7, 'N2 purge from bottom O/L thermowell', null),
    ('R-12-204', 8, 'Neutralize reactor inter-piping (S113)', null),
    ('R-12-204', 12, 'Fit N2 slide valves, bed temp <150°F', null),
    ('R-12-204', 13, 'Gas test H2S≤10ppm LEL≤10% CO≤50 O2≤4%', null),
    ('R-12-204', 14, 'Hand over for inert entry / tray removal', null),
    ('R-12-205', 1, 'Isolate H-201/H-202 gas & quench oil/gas', null),
    ('R-12-205', 2, 'Close KV-01B..13B, open KV-06B & KV-11B', null),
    ('R-12-205', 4, 'Drain all oil to V-213, PDT-2323 to DX', null),
    ('R-12-205', 7, 'Connect N2 hoses at ADD line & quench', null),
    ('R-12-205', 9, 'Gas test & hand over for entry', null),
    ('R-12-205', 10, 'Keep reactor under +ve N2 from top', null),
    ('H-12-201', 1, 'Purge coils pass-by-pass via XV-542', null),
    ('H-12-201', 3, 'Close main fuel gas BV-2083, trip heater', null),
    ('H-12-201', 4, 'Isolate fuel oil supply/return BV-2091/92', null),
    ('H-12-201', 5, 'Isolate snuffing, atomizing & soot steam', null),
    ('H-12-201', 6, 'Isolate inj. water BV-2025, swing decoke elbow', null),
    ('H-12-201', 9, 'Open stack damper fully & peepholes', null),
    ('H-12-201', 12, 'Gas test, ensure result OK', null),
    ('H-12-201', 13, 'Hand over with H-202 (common stack)', null),
    ('H-12-202', 1, 'Close FV-548/FV-1427 R. gas outlet', null),
    ('H-12-202', 2, 'Close main fuel gas BV-2083, trip heater', null),
    ('H-12-202', 3, 'Isolate fuel oil supply/return BV-2091/92', null),
    ('H-12-202', 4, 'Isolate snuffing, atomizing & soot steam', null),
    ('H-12-202', 5, 'Isolate BFW TV-541, #60 steam BV-2412/2026', null),
    ('H-12-202', 9, 'Open stack damper fully & peepholes', null),
    ('H-12-202', 12, 'Gas test, ensure result OK', null),
    ('H-12-202', 13, 'Hand over with H-201 (common stack)', null),
    ('E-12-207', 1, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('E-12-207', 3, 'Close cooling water supply & return B/Vs', null),
    ('E-12-207', 5, 'Verify blinds, car seals, DNO tags, blind list', null),
    ('E-12-207', 6, 'Gas test, CSE permit for shell cover entry', null),
    ('E-12-211', 1, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('E-12-211', 3, 'Close S/S BVs 2205A, 2150 & bypass 2205B', null),
    ('E-12-211', 4, 'Close T/S inlet & outlet BVs 2206 / 2207', null),
    ('E-12-211', 5, 'Rig steam hose S/S I/L, drain hose to DX', null),
    ('E-12-211', 6, 'Open T/S I/L BV-2206 D/S flange (wedge)', null),
    ('E-12-211', 9, 'Verify blinds, car seals, DNO tags, blind list', null),
    ('E-12-211', 10, 'Carry out gas test', null),
    ('E-12-216A', 1, 'Throttle 12-FV-522 to 10% (1% per 15 min)', null),
    ('E-12-216A', 2, 'Close S/S inlet B/L BV in stages 500→405°F', null),
    ('E-12-216A', 3, 'Close S/S O/L B/L BV at charge pump stop', null),
    ('E-12-216A', 6, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('E-12-216A', 7, 'Drain diesel from S/S to DX & P/O', null),
    ('E-12-216A', 10, 'Flush S/S with process water 1 h, sample', 1),
    ('E-12-216B', 1, 'Throttle 12-FV-522 to 10% (1% per 15 min)', null),
    ('E-12-216B', 2, 'Close S/S inlet B/L BV in stages 500→405°F', null),
    ('E-12-216B', 3, 'Close S/S O/L B/L BV at charge pump stop', null),
    ('E-12-216B', 6, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('E-12-216B', 7, 'Drain diesel from S/S to DX & P/O', null),
    ('E-12-216B', 10, 'Flush S/S with process water 1 h, sample', 1),
    ('P-12-203-E-01A', 1, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('P-12-203-E-01A', 2, 'Cool bearings after pump stop, stop L/O pump', null),
    ('P-12-203-E-01A', 3, 'Close main & aux L/O pump discharge B/Vs', null),
    ('P-12-203-E-01A', 4, 'Close cooling water supply & return B/Vs', null),
    ('P-12-203-E-01A', 5, 'Drain cooler S/S & T/S to DX', null),
    ('P-12-203-E-01A', 6, 'Close cooler vent B/V to L/O tank', null),
    ('P-12-203-E-01A', 9, 'Verify blinds, car seals, DNO tags, blind list', null),
    ('P-12-203-E-01B', 1, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('P-12-203-E-01B', 2, 'Cool bearings after pump stop, stop L/O pump', null),
    ('P-12-203-E-01B', 3, 'Close main & aux L/O pump discharge B/Vs', null),
    ('P-12-203-E-01B', 4, 'Close cooling water supply & return B/Vs', null),
    ('P-12-203-E-01B', 5, 'Drain cooler S/S & T/S to DX', null),
    ('P-12-203-E-01B', 6, 'Close cooler vent B/V to L/O tank', null),
    ('P-12-203-E-01B', 9, 'Verify blinds, car seals, DNO tags, blind list', null),
    ('C-12-201-E-03', 1, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('C-12-201-E-03', 2, 'Confirm R.G. comp C-201 stopped & cooled', null),
    ('C-12-201-E-03', 3, 'Close CW supply & return B/Vs to E-03', null),
    ('C-12-201-E-03', 4, 'Close turbine seal steam B/V', null),
    ('C-12-201-E-03', 5, 'Drain all water from S/S & T/S to DX', null),
    ('C-12-201-E-03', 6, 'Blind CW supply D/S & return U/S flanges', null),
    ('C-12-201-E-03', 7, 'Blind seal steam B/V U/S body flange', null),
    ('C-12-201-E-03', 8, 'Verify blinds, car seals, DNO tags, blind list', null),
    ('C-12-201-EJ-01', 1, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('C-12-201-EJ-01', 2, 'Confirm R.G. comp C-201 stopped & cooled', null),
    ('C-12-201-EJ-01', 3, 'Close 60# steam B/V to EJ-01', null),
    ('C-12-201-EJ-01', 4, 'Drain condensate to DX', null),
    ('C-12-201-EJ-01', 5, 'Blind 60# steam B/V D/S flange', null),
    ('C-12-201-EJ-01', 6, 'Verify blinds, car seals, DNO tags, blind list', null),
    ('C-12-201-E-01A', 1, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('C-12-201-E-01A', 2, 'Isolate steam, cool bearings 120°F, stop L/O', null),
    ('C-12-201-E-01A', 3, 'Close main & aux L/O pump discharge B/Vs', null),
    ('C-12-201-E-01A', 4, 'Close cooling water supply & return B/Vs', null),
    ('C-12-201-E-01A', 5, 'Drain cooler S/S & T/S to DX', null),
    ('C-12-201-E-01A', 6, 'Close cooler vent B/V to L/O tank', null),
    ('C-12-201-E-01A', 7, 'Blind S/S 3-way valve inlet & outlet flanges', null),
    ('C-12-201-E-01A', 8, 'Blind E-01A T/S in/out & S/S vent flanges', null),
    ('C-12-201-E-01A', 9, 'If E-01B stays: blind balance line B/V', null),
    ('C-12-201-E-01A', 10, 'Verify blinds, car seals, DNO tags, blind list', null),
    ('C-12-201-E-01B', 1, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('C-12-201-E-01B', 2, 'Isolate steam, cool bearings 120°F, stop L/O', null),
    ('C-12-201-E-01B', 3, 'Close main & aux L/O pump discharge B/Vs', null),
    ('C-12-201-E-01B', 4, 'Close cooling water supply & return B/Vs', null),
    ('C-12-201-E-01B', 5, 'Drain cooler S/S & T/S to DX', null),
    ('C-12-201-E-01B', 6, 'Close cooler vent B/V to L/O tank', null),
    ('C-12-201-E-01B', 7, 'Blind S/S 3-way valve inlet & outlet flanges', null),
    ('C-12-201-E-01B', 8, 'Blind E-01B T/S in/out & S/S vent flanges', null),
    ('C-12-201-E-01B', 9, 'If E-01A stays: blind balance line B/V', null),
    ('C-12-201-E-01B', 10, 'Verify blinds, car seals, DNO tags, blind list', null),
    ('C-12-201-TK-01', 1, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('C-12-201-TK-01', 2, 'Confirm C-201 & turbine cool, stop L/O pumps', null),
    ('C-12-201-TK-01', 3, 'Close pump suction, return & purifier B/Vs', null),
    ('C-12-201-TK-01', 4, 'Close vents, N2, accumulator & instr. drains', null),
    ('C-12-201-TK-01', 5, 'De-energize tank heater, disconnect LSL-682', null),
    ('C-12-201-TK-01', 6, 'Drain lube oil into empty drums', null),
    ('C-12-201-TK-01', 7, 'De-blind drain, drain remaining oil to DX', null),
    ('C-12-201-TK-01', 8, 'Blind 14 tank nozzles per blind list', null),
    ('C-12-201-TK-01', 9, 'Verify blinds, car seals, DNO tags, blind list', null),
    ('C-12-201-TK-01', 10, 'Water wash tank by water gun', null),
    ('C-12-201-TK-01', 11, 'Gas test for tank entry', null),
    ('P-12-205-E-01', 1, 'Toolbox talk, confirm permit, CTRA, blind list', null),
    ('P-12-205-E-01', 2, 'Cool bearings after pump stop, stop L/O pump', null),
    ('P-12-205-E-01', 3, 'Close main & aux L/O pump discharge B/Vs', null),
    ('P-12-205-E-01', 4, 'Close cooling water supply & return B/Vs', null),
    ('P-12-205-E-01', 5, 'Drain cooler S/S & T/S to DX', null),
    ('P-12-205-E-01', 6, 'Close cooler vent B/V to L/O tank', null),
    ('P-12-205-E-01', 7, 'Blind S/S inlet U/S & outlet D/S flanges', null),
    ('P-12-205-E-01', 8, 'Blind T/S inlet D/S & outlet U/S flanges', null),
    ('P-12-205-E-01', 9, 'Verify blinds, car seals, DNO tags, blind list', null),
    ('V-12-202', 1, 'Confirm work permit & approved blind list', null),
    ('V-12-202', 2, 'Isolate PV-518A/B, LV-506, spill back, P-202 suc', null),
    ('V-12-202', 3, 'Steam out 60 psi via PSV bypass, B/D then ATM', null),
    ('V-12-202', 4, 'Open DX & LV-506 D/S drains for condensate', null),
    ('V-12-202', 5, 'Continue steam-out 24 h', 24),
    ('V-12-202', 9, 'Gas test & hand over vessel for entry', null),
    ('V-12-206', 1, 'Confirm work permit & approved blind list', null),
    ('V-12-206', 2, 'Confirm V-206 to V-207 loop neutralization done', null),
    ('V-12-206', 3, 'Close LV-531 U/S & bypass, stop LB-203', null),
    ('V-12-206', 4, 'Drain all HC to P/O & DX (remove drain blinds)', null),
    ('V-12-206', 8, 'Gas test & hand over equipment', null),
    ('V-12-209', 1, 'Confirm work permit & approved blind list', null),
    ('V-12-209', 2, 'Confirm V-213 to V-209 soda ash soak done', null),
    ('V-12-209', 3, 'Drain all liquid via 2" boot drain', null),
    ('V-12-209', 4, 'Isolate E-211 O/L, V-208, LV-572/568, PV-644', null),
    ('V-12-209', 6, 'Steam out 60# via PSV bypass, B/D then ATM', null),
    ('V-12-209', 7, 'Continue steam-out 24 h, condensate drains open', 24),
    ('V-12-209', 9, 'Water wash vessel via steam hose point', null),
    ('V-12-209', 12, 'Gas test & hand over for entry', null),
    ('V-12-210', 1, 'Confirm work permit & approved blind list', null),
    ('V-12-210', 2, 'Isolate PV-523, LV-508, spill back, P-207 suc', null),
    ('V-12-210', 3, 'Steam out 60 psi via PSV bypass, B/D then ATM', null),
    ('V-12-210', 4, 'Open DX & LV-508 D/S drains for condensate', null),
    ('V-12-210', 5, 'Continue steam-out 24 h', 24),
    ('V-12-210', 9, 'Gas test & hand over vessel for entry', null),
    ('V-12-212', 1, 'Confirm work permit & approved blind list', null),
    ('V-12-212', 2, 'Isolate MOV-535, LV-597, HV-580, FV-599, T-201', null),
    ('V-12-212', 3, 'Deblind 12" vent, wedge MOV-534 & HCV-507', null),
    ('V-12-212', 4, 'Steam out 60 psi via HV-580 bypass, then ATM', null),
    ('V-12-212', 5, 'Continue steam-out 24 h (pyrophoric)', 24),
    ('V-12-212', 6, 'Cool down, then water wash vessel', null),
    ('V-12-212', 9, 'Water wash vessel & demister via manway', null),
    ('V-12-212', 10, 'Gas test for entry & hand over', null),
    ('V-12-212', 11, 'Keep walls wet, drum pyrophoric scale out', null),
    ('V-12-213', 1, 'Confirm work permit & approved blind list', null),
    ('V-12-213', 2, 'Confirm V-213 to V-209 loop neutralization done', null),
    ('V-12-213', 6, 'Gas test & hand over equipment', null),
    ('V-12-236', 1, 'Confirm work permit & approved blind list', null),
    ('V-12-236', 2, 'Confirm system pressure zero', null),
    ('V-12-236', 3, 'Isolate LV-541/555/801/568/572, PV-644, SP', null),
    ('V-12-236', 4, 'Push liquid to sour water header with N2', null),
    ('V-12-236', 5, 'N2 purge 3 h via V-209 PSV bypass', 3),
    ('V-12-236', 6, 'Depressurise V-236 via V-209, close bypass', null),
    ('V-12-236', 8, 'Steam out 60# 18 h, drain condensate & LT bridle', 18),
    ('V-12-236', 10, 'Water wash vessel via steam hose point', null),
    ('V-12-236', 12, 'Gas test & hand over for entry', null)),
k as (select t.id tracker_id, e.tag, coalesce(e.barchart_key, e.tag) key, e.stage, e.blinds_in_at, t.mode,
         (select max(baseline) from public.trk_activities a where a.tracker_id = t.id) b
        from public.trk_trackers t join public.trk_equipment e on e.tracker_id = t.id where t.status = 'active')
insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, stage, tracked, baseline, actual_start, actual_finish, actual_note)
select k.tracker_id, 'OP-' || lpad(s.n::text, 2, '0'), 'Operations', k.key, s.txt, s.h, 1, true, coalesce(k.b, 1),
       case when k.stage >= 1 and k.mode <> 'template' then k.blinds_in_at end, case when k.stage >= 1 and k.mode <> 'template' then k.blinds_in_at end,
       case when k.stage >= 1 and k.mode <> 'template' then 'Done before the handover (not timed)' end
  from s join k on k.tag = s.tag
 where not exists (select 1 from public.trk_activities x where x.tracker_id = k.tracker_id and x.equipment_key = k.key and x.activity_id = 'OP-' || lpad(s.n::text, 2, '0'));

update public.trk_points set soak_h = 4 where kind = 'neut' and soak_h is null and (step_id is not null or ref like 'R-12-%');
insert into public.trk_points (tracker_id, kind, ref, name, detail, fo, items, before_ho, sort, soak_h)
select t.id, 'neut', 'FT-681', 'FT/FV-681…684 feed lines', 'FT-681/682/683/684 and inlet FV-681…684 neutralization by the feed-line method, after H-201 decoking and handover (4 h soak, pH above 10)', 'FO3', array['H-12-201'], false, 16, 4
  from public.trk_trackers t where t.status = 'active'
on conflict (tracker_id, kind, ref) do nothing;

update public.trk_points set grp = 'hp_critical' where kind = 'blind' and ref = 'SEG-05';
update public.trk_points set grp = 'segregation' where kind = 'blind' and ref = 'SEG-11';
update public.trk_points set name = 'P-12-205 HPRT O/L common B/V' where kind = 'blind' and ref = 'SEG-28';
update public.trk_points p set detail = v.d from (values
  ('SEG-03', '3 blinds: BV-2007A, BV-2008A, BV-2009A'), ('SEG-16', '2 spools out, blind flanges both sides: withdrawal line at V-126 top, addition line at the bottom'),
  ('SEG-21', '2 blinds: BL-23 at BV-2019, BL-24 at BV-2020'), ('SEG-22', '2 blinds: E-203 S/S inlet body flange and 12-HV-548 D/S flange'),
  ('SEG-23', '2 blinds: PDT-017 at BV-2015, PDT-011 at BV-2014'), ('SEG-28', 'At BV-2016A U/S flange')) v(r, d)
 where p.kind = 'blind' and p.ref = v.r;
