-- Critical field steps that need a crane: dropping FV-1426 and FV-548 (Section Head, 21 Oct)
alter table public.trk_point_step add column if not exists crane boolean not null default false;
update public.trk_point_step s set crane = true
  from public.trk_points p
 where p.id = s.point_id and ((p.ref = 'S111' and s.seq = 2) or (p.ref = 'S118' and s.seq in (3, 4)));
