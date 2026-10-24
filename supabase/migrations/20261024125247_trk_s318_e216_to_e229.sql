-- S318: completes the line-up route after the direction fix: E-216A/B tube out -> E-229 shell in (P-12-2029).
insert into public.trk_loop_fix (tracker_id, point_id, op, a, b, line, reason)
select p.tracker_id, p.id, 'add_link', 'E-216', 'E-229', 'P-12-2029', 'P&ID line-up: E-216A/B tube out to E-229 shell in (sheets 1-R-12-0-112, 1-R-12-0-106, 1-4-12-0-313)'
  from public.trk_points p
 where p.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and p.ref = 'S318'
   and not exists (select 1 from public.trk_loop_fix f where f.point_id = p.id and f.status = 'active' and f.a = 'E-216' and f.b = 'E-229');
