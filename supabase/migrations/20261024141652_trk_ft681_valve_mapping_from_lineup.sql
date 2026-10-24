-- FT-681 engineering corrections from the P&ID line-up (Section Head review: valve mapping, bypass ends, fill/vent/drain).
--  · HV-548A (E-203 outlet, P-12-2052) and HV-546A (E-216A/B outlet, P-12-2029) are on the MAIN route, paired by the same
--    controllers with the bypass valves HV-548B / HV-546B (HC-548, HC-546); both were missing.
--  · MOV-502 is on the P-103A/B cross-tie to the P-203 discharge line (Train-1 sheet 1-R-12-0-103, verified), after check
--    valves VCB / VCNR2 (NC); MOV-501 is on the P-203 discharge (Train-2 line-up, generated). SOP step 2 closes both.
--  · The E-203 bypass starts at its own tee on P-12-2014 upstream of E-203 ("tee to HV-548B bypass"), not at the P-103B tie-in;
--    it rejoins P-12-2052 downstream of HV-548A.
--  · Recorded drain / vent points are attached to their line or equipment.
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'; pt uuid; tie text := 'J:P-12-2014 tie-in'; tee text := 'J:HV-548B tee';
  src text := 'Section Head review 24 Oct 2026 (valve mapping); P&ID line-up';
begin
  select id into pt from public.trk_points where tracker_id = t and ref = 'FT-681';
  if exists (select 1 from public.trk_loop_node where point_id = pt and tag = 'HV-548A' and status = 'active') then return; end if;
  update public.trk_loop_node set status = 'withdrawn', withdrawn_at = now(), withdrawn_by_name = 'system', withdrawn_reason = src || ': MOV-501/502 are not P-103B''s valves; P-103B''s is MOV-502 (line-up, Train-1 sheet 1-R-12-0-103)'
   where point_id = pt and status = 'active' and tag = 'MOV-501/502';
  update public.trk_loop_fix set status = 'withdrawn', withdrawn_at = now(), withdrawn_by_name = 'system', withdrawn_reason = src || ': replaced from the line-up'
   where point_id = pt and status = 'active' and op = 'add_link' and ((a = 'P-103B' and b = 'MOV-501/502') or (a = 'MOV-501/502' and b = 'B/V P-103B')
      or (a = 'P-203' and b = tie) or (a = tie and b = 'E-203') or (a = tie and b = 'HV-548B') or (a = 'E-203' and b = 'E-216A') or (a = 'E-216B' and b = 'E-229'));
  insert into public.trk_loop_fix (tracker_id, point_id, op, target, a, b, line, role, kind, text, reason) values
    (t, pt, 'add_link', null, 'P-103B', 'MOV-502', 'P-12-2014', 'standby', null, null, src || ': P-103A/B discharge to P-203 discharge line, Train-1 sheet 1-R-12-0-103'),
    (t, pt, 'add_link', null, 'MOV-502', 'B/V P-103B', null, 'standby', null, null, src || ': SOP step 2 discharge B/Vs'),
    (t, pt, 'add_link', null, 'P-203', 'MOV-501', 'P-12-2014', 'active', null, null, src || ': P-203A/B discharge MOV (line-up Train-2, generated)'),
    (t, pt, 'add_link', null, 'MOV-501', tie, 'P-12-2014', 'active', null, null, src),
    (t, pt, 'add_link', null, tie, tee, 'P-12-2014', 'active', null, null, src || ': order of the tie-in and the bypass tee on P-12-2014 not recorded'),
    (t, pt, 'add_link', null, tee, 'E-203', 'P-12-2014', 'active', null, null, src || ': P-12-2014 to E-203 shell in'),
    (t, pt, 'add_link', null, tee, 'HV-548B', null, 'bypass', null, null, src || ': tee to HV-548B bypass upstream of E-203 (sheet 1-R-12-0-112)'),
    (t, pt, 'add_link', null, 'E-203', 'HV-548A', 'P-12-2052', 'active', null, null, src || ': HV-548A on P-12-2052 (sheet 1-R-12-0-112)'),
    (t, pt, 'add_link', null, 'HV-548A', 'E-216A', 'P-12-2052', 'active', null, null, src || ': HV-548B bypass rejoins downstream of HV-548A'),
    (t, pt, 'add_link', null, 'E-216B', 'HV-546A', 'P-12-2029', 'active', null, null, src || ': HV-546A on P-12-2029 (sheet 1-R-12-0-112)'),
    (t, pt, 'add_link', null, 'HV-546A', 'E-229', 'P-12-2029', 'active', null, null, src),
    (t, pt, 'add_mark', 'at:start', 'E-229', 'J:split', null, null, 'drain', 'DX-12-2201 ¾″ drain (2 valves) at E-229 outlet nozzle', src || ': P-12-2303 (sheet 1-4-12-0-313)'),
    (t, pt, 'add_mark', 'at:node', 'E-216A', null, null, null, 'vent', 'VT-12-2048 vent, E-216A/B tube side (which shell not recorded)', src || ': E-216A/B data block'),
    (t, pt, 'add_mark', 'at:node', 'Injection water manifold', null, null, null, 'drain', 'Manifold drain 1″ VGL + 1″ VDV', src || ': sheet 1-R-12-0-106'),
    (t, pt, 'add_mark', 'at:mid', 'P-103B', 'MOV-502', null, null, 'drain', 'PO-12-1015 2″ drains (P-103 discharge)', src || ': Train-1 sheet 1-R-12-0-103'),
    (t, pt, 'add_mark', null, null, null, null, null, 'isolation', 'Spectacle blinds recorded on P-12-2014 (E-203 inlet) and P-12-2029 (E-229 inlet); position on the line not recorded', src || ': line-up');
  insert into public.trk_loop_fix (tracker_id, point_id, op, text, reason) values
    (t, pt, 'note', 'SOP step 2 closes MOV-501 (P-203 discharge) and MOV-502 (P-103B cross-tie): the soda ash enters downstream of MOV-501; the fill point is not recorded.', src),
    (t, pt, 'note', 'Order on P-12-2052 of the E-216A/B bypass take-off and HV-548A, and on P-12-2029 of the E-229 bypass take-off, HV-546A and the E-216 bypass rejoin, is not recorded. A line-up note says the E-216 bypass branches off "before the E-216B inlet": the tube-side order of shells A / B is to be confirmed.', src);
  insert into public.trk_loop_node (tracker_id, point_id, tag, label, state, source) values
    (t, pt, 'MOV-502', '8″ · after check valves VCB, VCNR2 (NC)', 'closed', 'SOP step 2'),
    (t, pt, 'MOV-501', 'P-203A/B discharge', 'closed', 'SOP step 2'),
    (t, pt, 'HV-548A', 'E-203 outlet · with HV-548B (HC-548)', 'unresolved', 'line-up Train-2 (generated)'),
    (t, pt, 'HV-546A', 'E-216A/B outlet · with HV-546B (HC-546)', 'unresolved', 'line-up Train-2 (generated)'),
    (t, pt, tee, 'Tee to HV-548B bypass on P-12-2014', 'known', 'line-up note, sheet 1-R-12-0-112');
end $$;
-- change-log entries for the withdrawals above (applied with the data)
insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_name, reason)
select f.tracker_id, 'schematic', 'FT-681', f.op, concat_ws(' → ', f.a, f.b), 'withdrawn', 'system', f.withdrawn_reason
  from public.trk_loop_fix f join public.trk_points p on p.id = f.point_id
 where p.ref = 'FT-681' and f.status = 'withdrawn' and f.withdrawn_by_name = 'system'
   and not exists (select 1 from public.trk_log g where g.kind = 'schematic' and g.ref = 'FT-681' and g.new_value = 'withdrawn' and g.old_value = concat_ws(' → ', f.a, f.b))
union all
select n.tracker_id, 'schematic', 'FT-681', 'item', n.tag, 'withdrawn', 'system', n.withdrawn_reason
  from public.trk_loop_node n join public.trk_points p on p.id = n.point_id
 where p.ref = 'FT-681' and n.status = 'withdrawn'
   and not exists (select 1 from public.trk_log g where g.kind = 'schematic' and g.ref = 'FT-681' and g.new_value = 'withdrawn' and g.old_value = n.tag);
