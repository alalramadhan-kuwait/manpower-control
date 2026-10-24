-- S318 (charge pump P-203 to the H-201 passes) in the approved FT-681 design standard: the same lines as FT-681's
-- Section Head-confirmed route, from the P&ID line-up.
--  · Active route P-203 → (tee to HV-548B) → E-203 S/S → HV-548A → E-216A → E-216B (shells in series) → HV-546A →
--    E-229 S/S → H-201 inlet header → H-201 passes (the passes and their instruments are drawn in FT-681).
--  · Bypasses from the line-up, each with its hand-control valve (Train-2 generated, tag / position unverified):
--    E-203 shell bypass (4″, no line no.) via HV-548B; E-216A/B tube-side bypass (6″, no line no.) via HV-546B;
--    E-229 shell-side bypass P-12-2305 via HV-863 into the H-201 inlet header.
--  · Drain DX-12-2201 (E-229 outlet), vent VT-12-2048 (E-216A/B), spectacle blinds on P-12-2014 / P-12-2029 (line-up).
--  · The earlier S318 links without roles are withdrawn (logged) and the generated links from the loop name removed.
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'; pt uuid; tee text := 'J:HV-548B tee'; hdr text := 'J:split';
  src text := 'S318 in the approved FT-681 standard (Section Head review 24 Oct 2026); P&ID line-up';
begin
  select id into pt from public.trk_points where tracker_id = t and ref = 'S318';
  if exists (select 1 from public.trk_loop_node where point_id = pt and tag = tee and status = 'active') then return; end if;
  update public.trk_loop_fix set status = 'withdrawn', withdrawn_at = now(), withdrawn_by_name = 'system', withdrawn_reason = src || ': replaced by the route with roles'
   where point_id = pt and status = 'active' and op = 'add_link' and role is null;
  insert into public.trk_loop_fix (tracker_id, point_id, op, target, a, b, line, role, kind, text, reason) values
    (t, pt, 'remove', 'node:E-216', null, null, null, null, null, null, src || ': E-216A and E-216B drawn as two shells in series; the E-203 shell bypass is drawn from its tee through HV-548B'),
    (t, pt, 'remove', 'link:E-203>E-229', null, null, null, null, null, null, src || ': the E-216A/B tube-side bypass is drawn through HV-546B'),
    (t, pt, 'remove', 'link:E-229>H-201', null, null, null, null, null, null, src || ': E-229 to the H-201 inlet header'),
    (t, pt, 'add_link', null, 'P-203', tee, 'P-12-2014', 'active', null, null, src || ': P-203A/B discharge (sheets 1-R-12-0-103, 1-R-12-0-112)'),
    (t, pt, 'add_link', null, tee, 'E-203', 'P-12-2014', 'active', null, null, src || ': to E-203 shell in'),
    (t, pt, 'add_link', null, 'E-203', 'HV-548A', 'P-12-2052', 'active', null, null, src || ': HV-548A on P-12-2052 (sheet 1-R-12-0-112)'),
    (t, pt, 'add_link', null, 'HV-548A', 'E-216A', 'P-12-2052', 'active', null, null, src || ': to E-216A/B tube in'),
    (t, pt, 'add_link', null, 'E-216A', 'E-216B', null, 'active', null, null, src || ': shells in series'),
    (t, pt, 'add_link', null, 'E-216B', 'HV-546A', 'P-12-2029', 'active', null, null, src || ': HV-546A on P-12-2029 (sheet 1-R-12-0-112)'),
    (t, pt, 'add_link', null, 'HV-546A', 'E-229', 'P-12-2029', 'active', null, null, src || ': to E-229 shell in'),
    (t, pt, 'add_link', null, 'E-229', hdr, 'P-12-2303', 'active', null, null, src || ': feed to H-201 (sheets 1-4-12-0-313, 1-R-12-0-106)'),
    (t, pt, 'add_link', null, hdr, 'H-201', null, 'active', null, null, src || ': to the H-201 passes (drawn in FT-681)'),
    (t, pt, 'add_link', null, tee, 'HV-548B', null, 'bypass', null, null, src || ': E-203 shell bypass, 4″ (sheet 1-R-12-0-112)'),
    (t, pt, 'add_link', null, 'HV-548B', 'E-216A', null, 'bypass', null, null, src || ': E-203 shell bypass rejoins upstream of E-216A/B'),
    (t, pt, 'add_link', null, 'E-203', 'HV-546B', null, 'bypass', null, null, src || ': E-216A/B tube-side bypass, 6″ (sheet 1-R-12-0-112)'),
    (t, pt, 'add_link', null, 'HV-546B', 'E-229', null, 'bypass', null, null, src || ': E-216A/B bypass rejoins upstream of E-229'),
    (t, pt, 'add_link', null, 'E-216B', 'HV-863', 'P-12-2305', 'bypass', null, null, src || ': E-229 shell-side bypass (sheet 1-4-12-0-313)'),
    (t, pt, 'add_link', null, 'HV-863', hdr, 'P-12-2305', 'bypass', null, null, src || ': E-229 bypass into the H-201 inlet header'),
    (t, pt, 'add_mark', 'at:start', 'E-229', hdr, null, null, 'drain', 'DX-12-2201 ¾″ drain (2 valves) at E-229 outlet nozzle', src || ': P-12-2303 (sheet 1-4-12-0-313)'),
    (t, pt, 'add_mark', 'at:node', 'E-216A', null, null, null, 'vent', 'VT-12-2048 vent, E-216A/B tube side (which shell not recorded)', src || ': E-216A/B data block'),
    (t, pt, 'add_mark', null, null, null, null, null, 'isolation', 'Spectacle blinds recorded on P-12-2014 (E-203 inlet) and P-12-2029 (E-229 inlet); position on the line not recorded', src || ': line-up');
  insert into public.trk_loop_fix (tracker_id, point_id, op, text, reason) values
    (t, pt, 'note', 'Order on P-12-2052 of the E-216A/B bypass take-off and HV-548A, and on P-12-2029 of the E-229 bypass take-off, HV-546A and the E-216 bypass rejoin, is not recorded. A line-up note says the E-216 bypass branches off "before the E-216B inlet": the tube-side order of shells A / B is to be confirmed.', src),
    (t, pt, 'note', 'The P-103B cross-tie (MOV-502) joins P-12-2014 between P-203 and E-203; it is drawn in FT-681 and not part of this loop''s record. Fill, vent and drain points for this loop''s procedure are not recorded.', src);
  insert into public.trk_loop_node (tracker_id, point_id, tag, label, state, source) values
    (t, pt, tee, 'Tee to HV-548B bypass on P-12-2014', 'known', 'line-up note, sheet 1-R-12-0-112'),
    (t, pt, hdr, 'H-201 inlet header — 4 passes, drawn in FT-681', 'unresolved', 'line-up; pass split not recorded'),
    (t, pt, 'HV-548B', 'FC · 4" · E-203 bypass', 'unresolved', 'line-up Train-2 (generated), position not recorded'),
    (t, pt, 'HV-546B', 'FC · 4" · E-216A/B bypass', 'unresolved', 'line-up Train-2 (generated), position not recorded'),
    (t, pt, 'HV-863', 'FC · 6" · E-229 bypass', 'unresolved', 'line-up Train-2 (generated), position not recorded'),
    (t, pt, 'HV-548A', 'E-203 outlet · with HV-548B (HC-548)', 'unresolved', 'line-up Train-2 (generated)'),
    (t, pt, 'HV-546A', 'E-216A/B outlet · with HV-546B (HC-546)', 'unresolved', 'line-up Train-2 (generated)');
end $$;
insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_name, reason)
select f.tracker_id, 'schematic', 'S318', f.op, concat_ws(' → ', f.a, f.b), 'withdrawn', 'system', f.withdrawn_reason
  from public.trk_loop_fix f join public.trk_points p on p.id = f.point_id
 where p.ref = 'S318' and f.status = 'withdrawn' and f.withdrawn_by_name = 'system'
   and not exists (select 1 from public.trk_log g where g.kind = 'schematic' and g.ref = 'S318' and g.new_value = 'withdrawn' and g.old_value = concat_ws(' → ', f.a, f.b));
