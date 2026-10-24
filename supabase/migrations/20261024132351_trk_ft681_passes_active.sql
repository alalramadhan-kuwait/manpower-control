-- FT-681: the four passes (header -> FT/FV-68x -> H-201) are part of the active route (Section Head, Stage 1 review).
insert into public.trk_loop_fix (tracker_id, point_id, op, a, b, role, reason)
select p.tracker_id, p.id, 'add_link', v.a, v.b, 'active', 'Section Head, Stage 1 review 24 Oct 2026: active route through the heater passes'
  from public.trk_points p
  cross join (values ('J:split', 'FT/FV-681'), ('J:split', 'FT/FV-682'), ('J:split', 'FT/FV-683'), ('J:split', 'FT/FV-684'),
                     ('FT/FV-681', 'H-201'), ('FT/FV-682', 'H-201'), ('FT/FV-683', 'H-201'), ('FT/FV-684', 'H-201')) v(a, b)
 where p.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and p.ref = 'FT-681'
   and not exists (select 1 from public.trk_loop_fix f where f.point_id = p.id and f.status = 'active' and f.a = v.a and f.b = v.b);
