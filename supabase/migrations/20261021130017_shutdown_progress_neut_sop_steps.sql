-- The main field steps of each neutralization from SOP MAB-OPR-SOP-12-2006 (RTJ flanges and NRV), sections 3.1 to 3.9:
-- control valves dropped, isolation, draining, blinds, hoses (before filling), the checks while filling, and the lab
-- pH or the second blinding after. Ticked from the loop sheet, stamped and logged. Fill, soak, drain stay on the loop.
create table public.trk_point_step (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  point_id uuid not null references public.trk_points(id),
  seq int not null,
  phase text not null check (phase in ('before', 'fill', 'after')),
  text text not null,
  source text,
  done_at timestamptz, done_by uuid, done_by_name text,
  unique (point_id, seq)
);
alter table public.trk_point_step enable row level security;
create policy trk_point_step_read on public.trk_point_step for select using (public.app_current_role() is not null);
create policy trk_point_step_update on public.trk_point_step for update using (public.trk_can_update()) with check (public.trk_can_update());
create policy trk_point_step_head on public.trk_point_step for insert with check (public.app_is_section_head());
create index trk_point_step_tracker on public.trk_point_step (tracker_id);

create or replace function public.trk_point_step_stamp() returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if new.done_at is not distinct from old.done_at then return new; end if;
  new.done_by := auth.uid(); new.done_by_name := public.trk_who();
  select p.ref into r from public.trk_points p where p.id = new.point_id;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  values (new.tracker_id, 'point', r || ' step ' || new.seq, case when new.done_at is null then 'step undone' else 'step done' end,
          old.done_at::text, coalesce(new.done_at::text, new.text), auth.uid(), public.trk_who());
  return new;
end $$;
create trigger trk_point_step_stamp before update on public.trk_point_step for each row execute function public.trk_point_step_stamp();

insert into public.trk_point_step (tracker_id, point_id, seq, phase, text, source)
select p.tracker_id, p.id, v.seq, v.phase, v.txt, 'SOP-12-2006 ' || v.sec
  from public.trk_points p
  join (values
  ('S111','§3.1',1,'before','N2 hoses on FT-1427 HP lead line, FV-1426 D/S drain and FT-1426 LP lead line'),
  ('S111','§3.1',2,'before','FV-1426 and FV-548 dropped under +ve N2, B/M on both U/S flanges'),
  ('S111','§3.1',3,'before','MOV-544 and TV-572 D/S common B/V-2309 closed, R-205 O/L to sample cooler B/V isolated'),
  ('S111','§3.1',4,'before','HC drained to DX from E-229 T/S inlet drain and FV-1426 D/S NRV drain'),
  ('S111','§3.1',5,'before','Elbows removed with B/M: R-205 O/L, R-201 I/L, R-202 I/L, R-201 O/L'),
  ('S111','§3.1',6,'before','Overflow hoses on R-201 I/L vent and R-205 O/L TE-2085 (thermocouple out), soda ash hoses on E-229 T/S inlet drain, FV-1426 D/S flange, TV-572 D/S drain'),
  ('S111','§3.1',7,'fill','FV-548 D/S NRV held open with a small pipe until clear soda ash, then closed'),
  ('S111','§3.1',8,'fill','Clear soda ash at R-201 and R-205 vents (inlet pipes flushed), vents closed'),
  ('S111','§3.1',9,'after','Soda ash sample to lab, pH above 10'),

  ('S115','§3.2',1,'before','H-201 coil oil purged out with N2 (H-201 prepare for decoking)'),
  ('S115','§3.2',2,'before','H-201 O/L elbow swung to decoking, B/M on both flanges'),
  ('S115','§3.2',3,'before','FV-1427 dropped under +ve N2 (fresh air mask), B/M on both flanges'),
  ('S115','§3.2',4,'before','H-201 O/L B/V open, Rx bypass 2nd B/V (near V-206) closed, R-205 drain to V-213 BV-2169C closed'),
  ('S115','§3.2',5,'before','HC drained to DX: R-205 drain to V-213, PDT-2323 drain, Rx bypass 2nd B/V U/S drain'),
  ('S115','§3.2',6,'before','Blinds under +ve N2: R-205 inlet 1st flange, PDT-2323 D/S 1st B/V-2305, R-205 to V-213 drain B/V-2306 D/S (wedge)'),
  ('S115','§3.2',7,'before','Soda ash hoses on Rx bypass 2nd B/V U/S drain and PDT-2323 drain, drain hose on H-201 vent'),
  ('S115','§3.2',8,'fill','Clear soda ash at R-205 to V-213 drain: wedge blind removed'),
  ('S115','§3.2',9,'fill','FV-1427 D/S NRV held open with a small pipe until clear soda ash, then closed'),
  ('S115','§3.2',10,'fill','Clear soda ash at H-201 O/L vent, vent closed'),
  ('S115','§3.2',11,'after','Soda ash sample to lab, pH above 10'),

  ('S118','§3.3',1,'before','Blinds in: E-202 S/S O/L and TV-667 U/S'),
  ('S118','§3.3',2,'before','N2 hoses on FT-1427 HP lead line and FT-1426 LP lead line'),
  ('S118','§3.3',3,'before','FV-1426 removed, B/M installed under +ve N2 (fresh air mask)'),
  ('S118','§3.3',4,'before','FV-548 and FV-1427 dropped under +ve N2 (fresh air mask), flanges washed with soda ash, B/M both sides'),
  ('S118','§3.3',5,'before','Drain hoses on H-202 O/L vent, H-202 O/L drain, FT-1427 lead line; soda ash hoses on TV-667 D/S drain and XV-542 U/S drain'),
  ('S118','§3.3',6,'fill','Clear soda ash at FT-1426 LP lead line, H-202 O/L drain, H-202 vent and FT-1427 lead line, each closed'),
  ('S118','§3.3',7,'after','N2 purge from FT-1426/1427 lead lines through H-202 O/L drain until the process water is out'),

  ('S112','§3.4',1,'before','R-205 segregation blinds completed (with ADD line removable spool)'),
  ('S112','§3.4',2,'before','KV-02B and KV-01B closed'),
  ('S112','§3.4',3,'before','Blinds: U/S of KV-11B and KV-02B D/S flange'),
  ('S112','§3.4',4,'before','PDT-2321 line B/Vs disconnected, B/M on ADD line U/S flange'),
  ('S112','§3.4',5,'before','Soda ash hoses on ADD spool at V-126 D/S flange and PDT-2321 B/Vs, drain hose on PG-2360/PT-018B vent, KV-02B and KV-01B opened'),
  ('S112','§3.4',6,'fill','Clear soda ash at the PG/PT vent, filling stopped'),
  ('S112','§3.4',7,'after','Soda ash sample to lab, pH above 10'),

  ('S117','§3.5',1,'before','R-205 catalyst dumped below the withdrawal line'),
  ('S117','§3.5',2,'before','Blinds in: KV-004B D/S, FV-003B D/S, KV-13B U/S'),
  ('S117','§3.5',3,'before','KV-07B/08B blind relocated to R-205 WDL line 3rd flange'),
  ('S117','§3.5',4,'before','CCR opened KV-03B, 12B, 09B, 04B, 07B, 08B, 10B (confirmed in the field)'),
  ('S117','§3.5',5,'before','Closed: KV-13B D/S line to B/D B/V, KV-03B D/S B/V, PDT-2323 B/V (disconnected)'),
  ('S117','§3.5',6,'before','Soda ash hose on FV-003B D/S drain, drain hoses on KV-12B D/S drain and PG-2360/PT-018B vent'),
  ('S117','§3.5',7,'fill','Clear soda ash at PG-2359/PT-019B vent, KV-12B D/S drain and removable spool U/S flange, each closed'),
  ('S117','§3.5',8,'after','Soda ash sample to lab, pH above 10'),

  ('S217','§3.6',1,'before','LV-511A D/S B/V-2169A and LV-511B D/S B/V-2169B closed'),
  ('S217','§3.6',2,'before','LV-531, LV-539, MOV-531 and MOV-537 open'),
  ('S217','§3.6',3,'before','HC drained: LV-531, LV-539, LV-511A/B U/S and D/S drains, V-207 H/C NRV D/S drain'),
  ('S217','§3.6',4,'before','Blinds on V-207 and V-206 H/C O/L body flanges, V-206/V-207 drain to P/O spools dropped'),
  ('S217','§3.6',5,'before','LV-531 and LV-539 U/S, D/S and bypass B/Vs (2128A/B, 2133A/B) open'),
  ('S217','§3.6',6,'before','Soda ash hoses on V-206 and V-207 drains, drain hoses on LV-511A/B U/S and D/S drains and V-207 NRV D/S drain'),
  ('S217','§3.6',7,'fill','Clear soda ash at LV-511A/B drains and V-207 NRV D/S drain, drains closed'),
  ('S217','§3.6',8,'after','Soda ash sample to lab, pH above 10'),

  ('S114','§3.7',1,'before','R-205 blinding completed, quench oil to R-205 segregation blind installed'),
  ('S114','§3.7',2,'before','FV-1412/1413 U/S common BV-2313 isolated, FV-1414/1415 U/S and D/S B/Vs isolated'),
  ('S114','§3.7',3,'before','Oil drained under FV-1414 and FV-1415 (½ drums to DX)'),
  ('S114','§3.7',4,'before','FV-1414 and FV-1415 cables disconnected, valves dropped, B/M on U/S flanges, hoses on D/S'),
  ('S114','§3.7',5,'before','Top and bottom quench common NRV D/S blind: U/S wedge open, ½ drums under'),
  ('S114','§3.7',6,'before','Soda ash hoses on FV-1412 and FV-1413 D/S drains and FV-1414 and FV-1415 D/S B/M'),
  ('S114','§3.7',7,'fill','FV-1414 B/M and FV-1412 drain filled until clear soda ash at the common NRV D/S flange'),
  ('S114','§3.7',8,'fill','FV-1415 B/M and FV-1413 drain filled until clear soda ash at the common NRV D/S flange'),
  ('S114','§3.7',9,'after','Soda ash sample to lab, pH above 10'),

  ('S218','§3.8',1,'before','E-205 T/S O/L and C-201 anti-surge line blinds installed (HP section critical blinding)'),
  ('S218','§3.8',2,'before','E-207 C/W supply and return B/Vs closed, spools removed, B/M installed'),
  ('S218','§3.8',3,'before','Closed: MOV-530 and 532, FV-546 U/S, D/S and bypass, HV-534/535/536, all 16 wash water B/Vs; PSV-607/608 and bypass isolated'),
  ('S218','§3.8',4,'before','HC drained to DX: E-207 T/S O/L, V-208 drain to P/O and DX (deblinded), FV-546 D/S drain'),
  ('S218','§3.8',5,'before','N2 hoses: TE-675 thermowell removed (fresh air mask), E-207 T/S O/L drain, V-208 LT-545 PG vent'),
  ('S218','§3.8',6,'before','1st blinds under +ve N2: V-208 H/C inlet body flange, FT-546 orifice and LP lead line'),
  ('S218','§3.8',7,'before','E-207 S/S water drained, vent and drain open'),
  ('S218','§3.8',8,'before','Soda ash hoses on E-205 T/S O/L at TE-675, E-207 T/S O/L drain, E-207 T/S inlet PG vent; drain hoses on all EA-201 tube bundle vents'),
  ('S218','§3.8',9,'fill','C-201 anti-surge NRV D/S flange and V-208 H/C inlet body flange wedged open until soda ash, then tightened'),
  ('S218','§3.8',10,'fill','Soda ash up to the EA-201 tube bundles: vents closed, filling stopped'),
  ('S218','§3.8',11,'after','Soda ash sample to lab, pH above 10'),
  ('S218','§3.8',12,'after','2nd blind on E-207 T/S inlet body flange; E-207, EA-201 and wash water RTJ flanges handed over for inspection'),

  ('FT-681','§3.9',1,'before','H-201 decoking completed and H-201 handed over'),
  ('FT-681','§3.9',2,'before','P-103B and P-203 discharge MOV-502/501 and B/Vs closed'),
  ('FT-681','§3.9',3,'before','H-201 outlet B/V closed'),
  ('FT-681','§3.9',4,'before','Injection water FV-691/692/693/694 D/S B/Vs closed'),
  ('FT-681','§3.9',5,'before','Decoking steam and air B/Vs closed in all passes'),
  ('FT-681','§3.9',6,'before','LB-12-201 stopped and all B/Vs towards the FT side isolated'),
  ('FT-681','§3.9',7,'fill','Neutralized as per the feed line procedure (P-203 and P-103B to H-201 inlet)')
  ) v(ref, sec, seq, phase, txt) on v.ref = p.ref
 where p.kind = 'neut'
on conflict (point_id, seq) do nothing;
