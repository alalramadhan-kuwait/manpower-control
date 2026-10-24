-- S318: adds the E-229 shell-side bypass from the P&ID line-up: E-216A/B tube out -> H-201 (P-12-2305), as a logged correction.
insert into public.trk_loop_fix (tracker_id, point_id, op, a, b, line, reason)
select p.tracker_id, p.id, 'add_link', 'E-216', 'H-201', 'P-12-2305', 'P&ID line-up: E-12-229 shell-side bypass, E-216A/B tube out to H-201 (sheet 1-4-12-0-313); added at the Section Head''s request'
  from public.trk_points p
 where p.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and p.ref = 'S318'
   and not exists (select 1 from public.trk_loop_fix f where f.point_id = p.id and f.status = 'active' and f.a = 'E-216' and f.b = 'H-201');
