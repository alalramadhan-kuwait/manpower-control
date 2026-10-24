-- S318 (charge pump to H-201 passes): the loop record names E-216 before E-203; the P&ID line-up gives the feed route
-- P-203 -> E-203 S/S (P-12-2014) -> E-216A/B T/S (P-12-2052) -> E-229 S/S (P-12-2029) -> H-201 (P-12-2303).
-- Recorded as schematic corrections (logged, withdrawable); the loop record itself is not changed.
insert into public.trk_loop_fix (tracker_id, point_id, op, target, a, b, line, reason)
select p.tracker_id, p.id, v.op, v.target, v.a, v.b, v.line, v.reason
  from public.trk_points p
  cross join (values
    ('remove', 'link:E-216>E-203', null, null, null, 'Direction from the P&ID line-up: E-203 shell out to E-216A/B tube in (P-12-2052, sheet 1-R-12-0-112)'),
    ('add_link', null, 'E-203', 'E-216', 'P-12-2052', 'P&ID line-up: E-203 shell out to E-216A/B tube in (sheet 1-R-12-0-112)'),
    ('add_link', null, 'P-203', 'E-203', 'P-12-2014', 'P&ID line-up: P-203A/B discharge to E-203 shell in (sheets 1-R-12-0-103, 1-R-12-0-112)')) v(op, target, a, b, line, reason)
 where p.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and p.ref = 'S318'
   and not exists (select 1 from public.trk_loop_fix f where f.point_id = p.id and f.status = 'active' and coalesce(f.target, '') = coalesce(v.target, '') and coalesce(f.a, '') = coalesce(v.a, '') and coalesce(f.b, '') = coalesce(v.b, ''));
