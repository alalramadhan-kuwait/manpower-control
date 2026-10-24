-- FT-681 heater section (Section Head review: H-201 representation).
--  · Each injection-water branch joins its feed pass upstream of the heater inlet (line-up: injection water manifold 3″
--    to the H-201 Detail A spray nozzles, 1-1/2″ per pass), at its own injection point; which branch joins which pass is
--    not recorded, so the pairing is drawn in tag order and marked unverified.
--  · Each pass runs through its own coil; the four heater outlets combine into a common outlet header (Section Head),
--    leaving on P-12-2030 to R-205 (line-up); the individual outlet lines are not recorded.
--  · The direct pass → heater and injection → heater links are withdrawn (logged), and the generated pass links removed.
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'; pt uuid; i int; ft text; fv text; mix text; outl text := 'J:H-201 outlet header';
  src text := 'Section Head review 24 Oct 2026 (H-201 representation)';
begin
  select id into pt from public.trk_points where tracker_id = t and ref = 'FT-681';
  if exists (select 1 from public.trk_loop_node where point_id = pt and tag = outl and status = 'active') then return; end if;
  update public.trk_loop_fix set status = 'withdrawn', withdrawn_at = now(), withdrawn_by_name = 'system', withdrawn_reason = src || ': injection joins each pass upstream of the heater inlet'
   where point_id = pt and status = 'active' and op = 'add_link' and b = 'H-201' and (a like 'FT/FV-68_' or a like 'B/V FV-69_ D/S');
  for i in 1..4 loop
    ft := 'FT/FV-68' || i; fv := 'FV-69' || i; mix := 'J:' || ft || ' injection point';
    insert into public.trk_loop_fix (tracker_id, point_id, op, target, a, b, line, role, kind, text, reason) values
      (t, pt, 'remove', 'link:' || ft || '>H-201', null, null, null, null, null, null, src || ': the pass runs through its injection point into the heater'),
      (t, pt, 'add_link', null, ft, mix, null, 'active', null, null, src || ': feed pass'),
      (t, pt, 'add_link', null, mix, 'H-201', null, 'active', null, null, src || ': pass inlet, its own coil'),
      (t, pt, 'add_link', null, 'B/V ' || fv || ' D/S', mix, null, 'injection', null, null, src || '; line-up: Detail A spray nozzle, 1-1/2″ per pass; pairing with the pass not recorded');
    insert into public.trk_loop_node (tracker_id, point_id, tag, label, state, source) values
      (t, pt, mix, 'Injection point (Detail A spray nozzle) — pass pairing not recorded', 'known', 'line-up: injection water 1-1/2″ per pass to H-201 Detail A');
  end loop;
  insert into public.trk_loop_fix (tracker_id, point_id, op, target, a, b, line, role, kind, text, reason) values
    (t, pt, 'add_link', null, 'H-201', outl, null, 'active', null, null, src || ': four heater outlets into a common outlet header');
  insert into public.trk_loop_fix (tracker_id, point_id, op, text, reason) values
    (t, pt, 'note', 'H-201: the injection branches FV-691…694 are drawn into the passes FT/FV-681…684 in tag order; which branch joins which pass, and the individual heater outlet lines, are not recorded.', src);
  insert into public.trk_loop_node (tracker_id, point_id, tag, label, state, source) values
    (t, pt, outl, 'Outlet header — P-12-2030 to R-205 (line-up); pass outlet lines not recorded', 'known', 'Section Head; line-up P-12-2030 (sheet 1-R-12-0-106)');
end $$;
insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_name, reason)
select f.tracker_id, 'schematic', 'FT-681', f.op, concat_ws(' → ', f.a, f.b), 'withdrawn', 'system', f.withdrawn_reason
  from public.trk_loop_fix f join public.trk_points p on p.id = f.point_id
 where p.ref = 'FT-681' and f.status = 'withdrawn' and f.withdrawn_by_name = 'system'
   and not exists (select 1 from public.trk_log g where g.kind = 'schematic' and g.ref = 'FT-681' and g.new_value = 'withdrawn' and g.old_value = concat_ws(' → ', f.a, f.b));
