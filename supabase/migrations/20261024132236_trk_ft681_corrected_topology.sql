-- FT-681 (FT/FV-681…684 feed lines): topology corrected by the Section Head (Stage 1 review, 24 Oct 2026), with
-- line numbers from the P&ID line-up and states from SOP-12-2006 §3.9. Recorded as schematic corrections (logged,
-- withdrawable); the loop record is not changed.
--   Active: P-203 discharge (P-12-2014) -> E-203 S/S -> E-216A -> E-216B (T/S, 2 shells in series) -> E-229 S/S (P-12-2029)
--           -> H-201 inlet header (P-12-2303) -> passes; injection water joins at the passes.
--   Bypasses: E-203 (tie-in -> E-216A), E-216A/B (E-203 -> E-229), E-229 (E-216B -> H-201 header, P-12-2305).
--   Standby: P-103B -> discharge MOV (closed) -> B/V (closed) -> tie-in on P-12-2014 (isolated from the active loop).
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'; pt uuid; tie text := 'J:P-12-2014 tie-in'; hdr text := 'J:split';
  src text := 'Section Head, Stage 1 review 24 Oct 2026';
begin
  select id into pt from public.trk_points where tracker_id = t and ref = 'FT-681';
  if exists (select 1 from public.trk_loop_node where point_id = pt and status = 'active') then return; end if;   -- applied once
  insert into public.trk_loop_fix (tracker_id, point_id, op, target, a, b, line, role, reason) values
    (t, pt, 'remove', 'link:P-203>J:split', null, null, null, null, src || ': the pumps do not feed the passes directly; route via E-203, E-216A/B, E-229'),
    (t, pt, 'remove', 'link:P-103B>J:split', null, null, null, null, src || ': P-103B is a standby branch, isolated'),
    (t, pt, 'add_link', null, 'P-203', tie, 'P-12-2014', 'active', src || '; line-up P-203A/B discharge P-12-2014'),
    (t, pt, 'add_link', null, tie, 'E-203', 'P-12-2014', 'active', src || '; line-up P-12-2014 to E-203 shell in'),
    (t, pt, 'add_link', null, 'E-203', 'E-216A', 'P-12-2052', 'active', src || '; line-up E-203 shell out to E-216A/B tube in'),
    (t, pt, 'add_link', null, 'E-216A', 'E-216B', null, 'active', src || '; equipment list: E-216A/B two shells in series (connecting line no. not in the line-up)'),
    (t, pt, 'add_link', null, 'E-216B', 'E-229', 'P-12-2029', 'active', src || '; line-up E-216A/B tube out to E-229 shell in'),
    (t, pt, 'add_link', null, 'E-229', hdr, 'P-12-2303', 'active', src || '; line-up E-229 shell out to H-201'),
    (t, pt, 'add_link', null, tie, 'E-216A', null, 'bypass', src || '; line-up E-12-203 shell bypass to E-216A/B tube in'),
    (t, pt, 'add_link', null, 'E-203', 'E-229', null, 'bypass', src || '; line-up E-12-216A/B tube-side bypass'),
    (t, pt, 'add_link', null, 'E-216B', hdr, 'P-12-2305', 'bypass', src || '; line-up E-12-229 shell-side bypass'),
    (t, pt, 'add_link', null, 'P-103B', 'MOV-501/502', null, 'standby', src || '; SOP step 2: P-103B and P-203 discharge MOV-502/501'),
    (t, pt, 'add_link', null, 'MOV-501/502', 'B/V P-103B', null, 'standby', src || '; SOP step 2: discharge B/Vs closed'),
    (t, pt, 'add_link', null, 'B/V P-103B', tie, 'P-12-2014', 'standby', src || '; line-up P-103A/B discharge to P-203 discharge line P-12-2014 (Train-1 sheet 1-R-12-0-103)'),
    (t, pt, 'add_link', null, 'Injection water manifold', 'FV-691', null, 'injection', src || '; line-up injection water manifold (3") to H-201 Detail A spray nozzles, 1-1/2" per pass'),
    (t, pt, 'add_link', null, 'Injection water manifold', 'FV-692', null, 'injection', src || '; line-up injection water manifold'),
    (t, pt, 'add_link', null, 'Injection water manifold', 'FV-693', null, 'injection', src || '; line-up injection water manifold'),
    (t, pt, 'add_link', null, 'Injection water manifold', 'FV-694', null, 'injection', src || '; line-up injection water manifold'),
    (t, pt, 'add_link', null, 'FV-691', 'B/V FV-691 D/S', null, 'injection', src || '; SOP step 4'),
    (t, pt, 'add_link', null, 'FV-692', 'B/V FV-692 D/S', null, 'injection', src || '; SOP step 4'),
    (t, pt, 'add_link', null, 'FV-693', 'B/V FV-693 D/S', null, 'injection', src || '; SOP step 4'),
    (t, pt, 'add_link', null, 'FV-694', 'B/V FV-694 D/S', null, 'injection', src || '; SOP step 4'),
    (t, pt, 'add_link', null, 'B/V FV-691 D/S', 'H-201', null, 'injection', src || '; line-up Detail A spray nozzle (per pass)'),
    (t, pt, 'add_link', null, 'B/V FV-692 D/S', 'H-201', null, 'injection', src || '; line-up Detail A spray nozzle (per pass)'),
    (t, pt, 'add_link', null, 'B/V FV-693 D/S', 'H-201', null, 'injection', src || '; line-up Detail A spray nozzle (per pass)'),
    (t, pt, 'add_link', null, 'B/V FV-694 D/S', 'H-201', null, 'injection', src || '; line-up Detail A spray nozzle (per pass)');
  insert into public.trk_loop_fix (tracker_id, point_id, op, text, reason) values
    (t, pt, 'note', 'Section Head: the route goes to "three buses"; the records give four passes (FT/FV-681…684, H-201 4-pass coil). Drawn as four until confirmed.', src),
    (t, pt, 'note', 'SOP step 2 closes P-203''s discharge MOV / B/Vs as well; the active route is drawn from the P-203 discharge line. Where the soda ash enters it is not recorded.', src),
    (t, pt, 'note', 'Which of MOV-501 / MOV-502 is on P-103B, and the order of the MOV and B/V on the branch, are not recorded.', src),
    (t, pt, 'note', 'Which injection-water FV (691…694) feeds which pass is not recorded; the injection water manifold is fed from the H-201 convection water preheat coil (WP-12-2017), not drawn.', src);
  insert into public.trk_loop_node (tracker_id, point_id, tag, label, state, source) values
    (t, pt, 'P-103B', 'Train-1 charge pump', 'standby', 'SOP step 2'),
    (t, pt, 'MOV-501/502', 'discharge MOV', 'closed', 'SOP step 2'),
    (t, pt, 'B/V P-103B', 'discharge block valve', 'closed', 'SOP step 2'),
    (t, pt, tie, 'Tie-in on P-12-2014 (P-103B into P-203 discharge)', 'known', 'P&ID line-up, Train-1 sheet 1-R-12-0-103'),
    (t, pt, hdr, 'H-201 inlet header — pass split not recorded', 'unresolved', 'not in the records'),
    (t, pt, 'B/V FV-691 D/S', null, 'closed', 'SOP step 4'),
    (t, pt, 'B/V FV-692 D/S', null, 'closed', 'SOP step 4'),
    (t, pt, 'B/V FV-693 D/S', null, 'closed', 'SOP step 4'),
    (t, pt, 'B/V FV-694 D/S', null, 'closed', 'SOP step 4');
end $$;
