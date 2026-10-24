-- FT-681: the hand-control valve on each exchanger bypass, from the P&ID line-up (Train-2 entries generated from
-- Train 1, not checked on the Train-2 sheet; position along the bypass not recorded):
--   E-203 shell bypass HV-548B (FC, 4"), E-216A/B tube-side bypass HV-546B (FC, 4"), E-229 shell-side bypass HV-863 (FC, 6", P-12-2305).
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'; pt uuid; tie text := 'J:P-12-2014 tie-in'; hdr text := 'J:split';
  src text := 'Section Head, Stage 1 revision 24 Oct 2026; valve from the P&ID line-up';
begin
  select id into pt from public.trk_points where tracker_id = t and ref = 'FT-681';
  if exists (select 1 from public.trk_loop_node where point_id = pt and tag = 'HV-548B' and status = 'active') then return; end if;
  insert into public.trk_loop_fix (tracker_id, point_id, op, target, a, b, line, role, reason) values
    (t, pt, 'remove', 'link:' || tie || '>E-216A', null, null, null, null, src || ': the bypass is drawn through its valve'),
    (t, pt, 'remove', 'link:E-203>E-229', null, null, null, null, src || ': the bypass is drawn through its valve'),
    (t, pt, 'remove', 'link:E-216B>' || hdr, null, null, null, null, src || ': the bypass is drawn through its valve'),
    (t, pt, 'add_link', null, tie, 'HV-548B', null, 'bypass', src || ': E-12-203 shell bypass (sheet 1-R-12-0-112)'),
    (t, pt, 'add_link', null, 'HV-548B', 'E-216A', null, 'bypass', src || ': E-12-203 shell bypass to E-216A/B tube in'),
    (t, pt, 'add_link', null, 'E-203', 'HV-546B', null, 'bypass', src || ': E-12-216A/B tube-side bypass (sheet 1-R-12-0-112)'),
    (t, pt, 'add_link', null, 'HV-546B', 'E-229', null, 'bypass', src || ': E-12-216A/B tube-side bypass to E-229 shell in'),
    (t, pt, 'add_link', null, 'E-216B', 'HV-863', 'P-12-2305', 'bypass', src || ': E-12-229 shell-side bypass (sheet 1-4-12-0-313)'),
    (t, pt, 'add_link', null, 'HV-863', hdr, 'P-12-2305', 'bypass', src || ': E-12-229 shell-side bypass to H-201');
  insert into public.trk_loop_node (tracker_id, point_id, tag, label, state, source) values
    (t, pt, 'HV-548B', 'FC · 4" · E-203 bypass', 'unresolved', 'line-up Train-2 (generated), position not recorded'),
    (t, pt, 'HV-546B', 'FC · 4" · E-216A/B bypass', 'unresolved', 'line-up Train-2 (generated), position not recorded'),
    (t, pt, 'HV-863', 'FC · 6" · E-229 bypass', 'unresolved', 'line-up Train-2 (generated), position not recorded');
end $$;
