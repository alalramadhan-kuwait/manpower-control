-- the bar chart is imported in the app (Admin): each import is a new baseline, the plan reads the latest, older ones
-- are kept (re-baseline keeps the actual progress, which lives on the equipment)
alter table public.trk_activities add column baseline int not null default 1;
create or replace function public.trk_import_barchart(p_tracker uuid, p_rows jsonb) returns int language plpgsql security definer set search_path = public as $$
declare t public.trk_trackers; b int; n int;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head imports the bar chart.'; end if;
  select * into t from public.trk_trackers where id = p_tracker;
  if t.id is null or t.mode = 'template' then raise exception 'Import into a test or live tracker.'; end if;
  select coalesce(max(baseline), 0) + 1 into b from public.trk_activities where tracker_id = p_tracker;
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline)
  select p_tracker, r->>'activity_id', nullif(r->>'group', ''), r->>'equipment_key', r->>'activity', nullif(r->>'duration_h', '')::numeric,
         nullif(r->>'planned_start', '')::timestamptz, nullif(r->>'planned_finish', '')::timestamptz, nullif(r->>'stage', '')::int,
         coalesce(nullif(r->>'tracked', '')::int, 1) = 1, b
    from jsonb_array_elements(p_rows) r where coalesce(r->>'activity_id', '') <> '' and coalesce(r->>'equipment_key', '') <> '';
  get diagnostics n = row_count;
  -- a test import also becomes the seed of the next test reset
  if t.mode = 'test' and t.template_id is not null then
    insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline)
    select t.template_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked,
           (select coalesce(max(baseline), 0) + 1 from public.trk_activities where tracker_id = t.template_id)
      from public.trk_activities where tracker_id = p_tracker and baseline = b;
  end if;
  return n;
end $$;
revoke all on function public.trk_import_barchart(uuid, jsonb) from public, anon;
grant execute on function public.trk_import_barchart(uuid, jsonb) to authenticated;
-- the copy takes the latest baseline only
create or replace function public.trk_copy(p_src uuid, p_dst uuid, p_progress boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.trk_steps (tracker_id, step_id, fo, gate, gate_name, short_name, step_text, procedure, prereq, est_hours, note, equipment_covered, target_at, status, pending_reason, remark)
  select p_dst, step_id, fo, gate, gate_name, short_name, step_text, procedure, prereq, est_hours, note, equipment_covered, target_at,
         case when p_progress then status else 'not_started' end, case when p_progress then pending_reason end, case when p_progress then remark end
    from public.trk_steps where tracker_id = p_src;
  insert into public.trk_equipment (tracker_id, tag, grp, description, fo, ho_step, procedure, barchart_key, ops_item, critical, tracked, disabled_reason, planned_ho, planned_finish, sort, stage, pending_reason, remark)
  select p_dst, tag, grp, description, fo, ho_step, procedure, barchart_key, ops_item, critical, tracked, disabled_reason, planned_ho, planned_finish, sort,
         case when p_progress then stage else 0 end, case when p_progress then pending_reason end, case when p_progress then remark end
    from public.trk_equipment where tracker_id = p_src;
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, baseline)
  select p_dst, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, 1
    from public.trk_activities a where tracker_id = p_src and baseline = (select max(baseline) from public.trk_activities where tracker_id = p_src);
end $$;
revoke all on function public.trk_copy(uuid, uuid, boolean) from public, anon, authenticated;

-- Seed: the U-12 TR-2 tracker v4 (69 steps, 96 equipment items, 19-Oct logbook statuses) as the template of the Train-2
-- shutdown, and its TEST tracker (a copy with the same progress). The bar chart is imported in the app (Admin).
do $$
declare v_tpl uuid; v_test uuid; v_event uuid := '2e94a02b-e34b-4e8f-9ae1-5a80294719df';
begin
  insert into public.trk_trackers (event_id, title, mode, settings) values (v_event, 'U-12 TR-2 SD', 'template', '{"hoTarget":"2026-10-20T07:00:00+03:00","end":"2026-11-07","workOrder":"19029097"}'::jsonb) returning id into v_tpl;
  insert into public.trk_steps (tracker_id, step_id, fo, gate, gate_name, short_name, step_text, procedure, prereq, est_hours, note, equipment_covered, status, remark) values
    (v_tpl,'S101','FO1',1,'HPWS < 480°F','N2 header line-up','Nitrogen header line-up and arrangement','SOP-12-2001','{}',null,null,null,'done','Implied by later steps done – confirm'),
    (v_tpl,'S102','FO1',2,'Charge pump stopped','Stop charge pump / flush H-201','Stop charge pump, close D/S MOV & warm-up B/V, flush H-201 passes with recycle gas via XV-542','SOP-12-2001','{S101}',null,null,null,'done','Implied by later steps done – confirm'),
    (v_tpl,'S103','FO1',3,'System 600 psi','Drain V-126→V-132 / OCR→V-213','Drain V-126 to V-132 until gas break-through, drain OCR to V-213','SOP-12-2001','{S102}',null,null,null,'done','Implied by later steps done – confirm'),
    (v_tpl,'S104','FO1',4,'500 psi · C-201 stopped','Stop C-201','Stop C-201, isolate 900/450 psi warm-up steam as per Rotating advice','SOP-12-2001','{S103}',null,null,null,'done','C-201 stopped 09:30 19-Oct (logbook)'),
    (v_tpl,'S105','FO1',5,'150 psi → 0','Drain reactors','Fixed bed & OCR: drain reactors','SOP-12-2008 / 2009','{S104}',null,null,null,'in_progress','R-205 draining done (logbook) – FB reactors?'),
    (v_tpl,'S106','FO1',5,'150 psi → 0','Connect N2 hoses','Fixed bed & OCR: connect N2 hoses','SOP-12-2008 / 2009','{S105}',null,null,null,'not_started',null),
    (v_tpl,'S107','FO1',6,'0 psi · Segregation','R-204 outlet blind','R-204 outlet blind','SOP-12-2004 §3.1','{S106}',null,null,null,'done','From logbook 19-Oct D – confirm'),
    (v_tpl,'S108','FO1',6,'0 psi · Segregation','OCR segregation','OCR segregation – addition, withdrawal, PDT-011/017, V-207 & C-201 to V-126','SOP-12-2003 §3.10 / SOP-12-2004','{S106}',null,null,null,'not_started',null),
    (v_tpl,'S109','FO1',6,'0 psi · Segregation','R-201/202/203 blind & HO','R-201/202/203 outlet blinding & handover (outlet blinds BEFORE top elbow removal)','SOP-12-2009','{S107}',4,'Soda ash soak 4 h','R-12-201, R-12-202, R-12-203, R-12-204','in_progress','R-202 & R-203 outlet blinding done (logbook)'),
    (v_tpl,'S110','FO1',6,'0 psi · Segregation','R-205 segregation & HO','R-205 segregation & handover, disconnect radioactive LT source & power','SOP-12-2008','{S108}',4,'Soda ash soak 4 h','R-12-205','not_started',null),
    (v_tpl,'S111','FO1',7,'Neutralization','R-205→R-201 neutralization','R-205 O/L → R-201 I/L neutralization (E-229 T/S, FV-548 & FV-1426 D/S NRV)','SOP-12-2006 §3.1','{S110,S109}',4,null,'12-VC-0106, 12-VC-0108, E-229 sample point, R-205 to E-229, FV-1426 d/s','not_started',null),
    (v_tpl,'S112','FO1',7,'Neutralization','Addition line neutralization','R-205 addition line RTJ neutralization','SOP-12-2006 §3.4','{S108}',4,null,null,'not_started',null),
    (v_tpl,'S113','FO1',7,'Neutralization','Rx inter-piping neutralization','Reactor inter-piping neutralization (R-202/203/204)','SOP-12-2005 §3.4','{S109}',4,null,'R-201 to R-202, R-202 to R-203, R-203 to R-204, R-204 to V-206','not_started',null),
    (v_tpl,'S114','FO1',7,'Neutralization','Quench line neutralization','R-205 quench gas/oil line RTJ neutralization','SOP-12-2006 §3.7','{S110}',4,null,null,'not_started',null),
    (v_tpl,'S115','FO1',7,'Neutralization','H-201→R-205 neutralization','H-201 O/L → R-205 I/L line neutralization (FV-1427 D/S NRV)','SOP-12-2006 §3.2','{S110}',4,null,'12-VC-0107, H-201 O/L to R-205 I/L','not_started',null),
    (v_tpl,'S118','FO1',7,'Neutralization','H-202 in/out neutralization','H-202 inlet & outlet neutralization (to hand over FI-1427 & FV-1427)','SOP-12-2006 §3.3','{S110}',4,'In SOP but not in guideline','H-202 O/L, FV-1427','not_started',null),
    (v_tpl,'S116','FO1',8,'Equipment handover','E-229 handover','E-229 handover','No SOP received','{S111}',null,null,'E-12-229','not_started',null),
    (v_tpl,'S117','FO1',8,'Equipment handover','Withdrawal line neutralization','R-205 withdrawal & HP line RTJ neutralization (after R-205 catalyst dumping)','SOP-12-2006 §3.5','{S110}',4,'Also needs R-205 catalyst dumped (bar chart A5410, plan 28-Oct)','R-205 withdrawal line d/s KV-7B/8B','not_started',null),
    (v_tpl,'S201','FO2',1,'HPWS < 480°F','Hoses line-up','Hoses line-up',null,'{}',null,null,null,'not_started',null),
    (v_tpl,'S202','FO2',2,'Charge pump stopped','Close HV-548B/546B, stop LBs','Close HV-548B/HV-546B & HV-863, stop LB-201/202/203/204, isolate quench oil to R-205 (all B/Vs) & LB-108',null,'{S201}',null,null,null,'not_started',null),
    (v_tpl,'S203','FO2',4,'500 psi · C-201 stopped','Stop wash water pumps','Stop P-207A/B, P-204, P-206A/B, isolate FV-546 & PV-891, reduce vessel levels, isolate wash-water balancing line & close MOV',null,'{S202}',null,null,'P-12-207A/B','not_started',null),
    (v_tpl,'S204','FO2',4,'500 psi · C-201 stopped','V-210 handover','V-210 handover (steam-out 24 h)','SOP-12-2028','{S203}',24,null,'V-12-210','done','V-210 under ventilation (logbook)'),
    (v_tpl,'S205','FO2',5,'150 psi → 0','Empty V-206/207/208/236','Hose connection & empty V-206, V-207, V-208, V-236 to LP (V-213 / V-209)',null,'{S203,S104}',null,null,null,'in_progress','V-206/207/208/212/213/236 PO/DX deblinded (logbook)'),
    (v_tpl,'S206','FO2',5,'150 psi → 0','H2 make-up segregation','H2 make-up segregation','SOP-12-2003 §3.1','{S104}',null,null,null,'done','From logbook 19-Oct D – confirm'),
    (v_tpl,'S207','FO2',5,'150 psi → 0','Drain lean/rich amine lines','Drain lean & rich amine lines (for line inspection)',null,'{S306}',null,null,null,'not_started',null),
    (v_tpl,'S208','FO2',6,'0 psi · Segregation','V-212→V-114 segregation','V-212 drain to V-114 segregation','SOP-12-2003 §3.3','{S104}',null,null,null,'done','From logbook 19-Oct D – confirm'),
    (v_tpl,'S209','FO2',6,'0 psi · Segregation','HP purge segregation','HP purge gas segregation','SOP-12-2003 §3.2','{S104}',null,null,null,'done','From logbook 19-Oct D – confirm'),
    (v_tpl,'S210','FO2',6,'0 psi · Segregation','V-236 segregation','V-236 sour water segregation','SOP-12-2003 §3.9','{S205}',null,null,null,'done','From logbook 19-Oct D – confirm'),
    (v_tpl,'S211','FO2',6,'0 psi · Segregation','V-236 handover','V-236 handover (N2 purge 3 h, steam-out 18 h)','SOP-12-2031','{S210}',24,null,'V-12-236','not_started',null),
    (v_tpl,'S212','FO2',6,'0 psi · Segregation','HPRT outlet blinding','P-205 HPRT common B/V outlet blinding','SOP-12-2003 §3.15','{S306}',null,null,null,'not_started',null),
    (v_tpl,'S213','FO2',6,'0 psi · Segregation','HP critical blinds','HP critical blinds – C-201 anti-surge, V-207 & C-201 to V-126, E-205 T/S O/L, E-205 S/S I/L, E-202 S/S O/L, TV-667','SOP-12-2004','{S205,S106}',null,null,null,'not_started',null),
    (v_tpl,'S214','FO2',7,'Neutralization','V-206→E-205 T/S loop neutralization','Recycle gas loop neutralization: V-206 vapour → E-205 T/S O/L (V-206 → V-207)','SOP-12-2005 §3.2','{S213}',4,null,null,'not_started',null),
    (v_tpl,'S215','FO2',7,'Neutralization','C-201 disch.→E-202 neutralization','C-201 discharge loop neutralization: E-205 S/S I/L → E-202 S/S O/L','SOP-12-2005 §3.1','{S213}',4,null,'E-202 to E-203','not_started',null),
    (v_tpl,'S216','FO2',7,'Neutralization','E-205 T/S→V-208 neutralization','E-205 T/S O/L → V-208 H/C inlet neutralization','No SOP found','{S213}',4,'Required by E-207 SOP, missing from guideline',null,'not_started',null),
    (v_tpl,'S217','FO2',7,'Neutralization','V-206/207→LV-511 neutralization','V-206/207 O/L → LV-511A/B hydrocarbon line RTJ neutralization','SOP-12-2006 §3.6','{S214}',4,null,'V-207 to V-213, V-206 to V-213','not_started',null),
    (v_tpl,'S218','FO2',7,'Neutralization','EA-201/E-207/WW RTJ neutralization','EA-201, E-207 & wash-water injection point RTJ neutralization','SOP-12-2006 §3.8','{S216}',4,null,'E-205 to EA-201, Wash water to EA-201','not_started',null),
    (v_tpl,'S219','FO2',8,'Equipment handover','V-206 handover','V-206 handover','SOP-12-2024','{S214}',null,null,'V-12-206, V-206 LT bridle','not_started',null),
    (v_tpl,'S220','FO2',8,'Equipment handover','F-202 handover','F-202 recycle gas filter handover','No SOP received','{S213}',null,null,'F-12-202','not_started',null),
    (v_tpl,'S221','FO2',8,'Equipment handover','E-207 handover','E-207 handover','SOP-12-2015','{S216}',null,null,'E-12-207','not_started',null),
    (v_tpl,'S222','FO2',8,'Equipment handover','V-212 handover','V-212 handover (steam-out 24 h, pyrophoric)','SOP-12-2029','{S208,S209}',24,null,'V-12-212','not_started',null),
    (v_tpl,'S223','FO2',8,'Equipment handover','C-201 + LO / gland cond. HO','C-201 with LO tank TK-01, LO coolers E-01A/B, gland condenser E-03 & EJ-01 handover','SOP-12-2039 / 2040 / 2041','{S104,S213}',null,'C-201 main body: no SOP','C-12-201-F-01B, C-12-201-F-03A/B, C-12-201, C-12-201-ST, C-12-201 LO system, C-12-201-E-01A, C-12-201-E-01B, C-12-201-E-03, C-12-201-EJ-01, C-12-201-TK-01, C-12-201-TK-03','not_started',null),
    (v_tpl,'S224','FO2',8,'Equipment handover','V-207 & V-208 handover','V-207 & V-208 handover','No SOP received','{S214,S216}',null,'Not in guideline','V-12-207, V-12-208','not_started',null),
    (v_tpl,'S301','FO3',1,'HPWS < 480°F','H-201 inj. water / decoking','Close H-201 injection water pass B/Vs, line up process water → H-201 convection coil → decoking drum (if P-202/P-207B & P-107C stopped), isolate spill-back PV-880',null,'{}',null,null,null,'done','Injection water blinded (logbook)'),
    (v_tpl,'S302','FO3',2,'Charge pump stopped','V-202 handover','V-202 handover (steam-out 24 h)','SOP-12-2022','{S301}',24,null,'V-12-202','done','V-202 under ventilation (logbook)'),
    (v_tpl,'S303','FO3',2,'Charge pump stopped','P-203 LO coolers & tank HO','P-203 LO coolers & LO tank handover','SOP-12-2037 (tank: no SOP)','{S102}',null,null,'P-12-203-E-01A, P-12-203-E-01B, P-12-203-TK-01, P-12-203','not_started',null),
    (v_tpl,'S304','FO3',2,'Charge pump stopped','Stop LB-111 / flush V-201','Stop LB-111, flush V-201 with diesel to LT/LSHH/LSLL then isolate',null,'{S102}',null,null,null,'done','Implied by later steps done – confirm'),
    (v_tpl,'S305','FO3',2,'Charge pump stopped','V-201 handover','V-201 handover','No SOP received','{S304}',null,null,'V-12-201','done','V-201 manway open, under ventilation (logbook)'),
    (v_tpl,'S306','FO3',4,'500 psi · C-201 stopped','Stop amine pump / drain amine','Stop amine pump, close FV-558 U/S, D/S & bypass, disconnect P-205 & P-105B discharge to TR-2, drain amine T-201 → V-114',null,'{S104}',null,null,null,'not_started',null),
    (v_tpl,'S307','FO3',4,'500 psi · C-201 stopped','P-205 LO coolers & tank HO','P-205 LO coolers & LO tank handover','SOP-12-2042 (tank: no SOP)','{S306}',null,null,'P-12-205-E-01, P-12-205-TK-01, P-12-205','not_started',null),
    (v_tpl,'S308','FO3',5,'150 psi → 0','H-201 drain / isolate HP-LP','H-201 inlet passes draining arrangement, isolate HP system from LP system',null,'{S102,S104}',null,null,null,'done','Implied by later steps done – confirm'),
    (v_tpl,'S309','FO3',6,'0 psi · Segregation','H-103 passes segregation','H-103 TR-2 passes segregation','SOP-12-2003 §3.5','{S308}',null,null,null,'done','From logbook 19-Oct D – confirm'),
    (v_tpl,'S310','FO3',6,'0 psi · Segregation','LV-572 segregation','LV-572 segregation','SOP-12-2003 §3.6','{S308}',null,null,null,'done','From logbook 19-Oct D – confirm'),
    (v_tpl,'S311','FO3',6,'0 psi · Segregation','PV-644 segregation','PV-644 segregation','SOP-12-2003 §3.7','{S308}',null,null,null,'done','From logbook 19-Oct D – confirm'),
    (v_tpl,'S312','FO3',6,'0 psi · Segregation','E-210 S/S O/L segregation','E-210 S/S outlet segregation','SOP-12-2003 §3.8','{S308}',null,null,null,'done','From logbook 19-Oct D – confirm'),
    (v_tpl,'S313','FO3',6,'0 psi · Segregation','E-216A/B flush & segregation','E-216A/B S/S isolation, diesel flushing & segregation blinding','SOP-12-2002 + SOP-12-2003 §3.4','{S102}',null,null,null,'done','From logbook 19-Oct D – confirm'),
    (v_tpl,'S314','FO3',6,'0 psi · Segregation','Charge pump→H-201 segregation','Charge pump discharge → H-201 line segregation','SOP-12-2003 §3.14','{S308}',null,null,null,'not_started',null),
    (v_tpl,'S315','FO3',6,'0 psi · Segregation','Fuel gas segregation','Fuel gas segregation','SOP-12-2003 §3.11','{S102}',null,null,null,'not_started',null),
    (v_tpl,'S316','FO3',6,'0 psi · Segregation','LP flare segregation','LP flare header segregation','SOP-12-2003 §3.13','{S308}',null,null,null,'not_started',null),
    (v_tpl,'S317','FO3',6,'0 psi · Segregation','HP flare segregation','HP flare header segregation','SOP-12-2003 §3.12','{S106,S205}',null,null,null,'not_started',null),
    (v_tpl,'S318','FO3',7,'Neutralization','Charge pump→H-201 neutralization','Charge pump discharge → H-201 inlet neutralization','SOP-12-2005 §3.3','{S314}',4,null,null,'not_started',null),
    (v_tpl,'S319','FO3',7,'Neutralization','H-201 pigging prep','H-201 preparation for pigging','No SOP received','{S318}',null,null,null,'not_started',null),
    (v_tpl,'S320','FO3',7,'Neutralization','V-213→V-209 neutralization','V-213 → V-209 loop neutralization (soda ash soak 4 h)','SOP-12-2005 §3.5','{S310,S311,S312}',4,'Needed by V-213, V-209, E-211 SOPs',null,'not_started',null),
    (v_tpl,'S321','FO3',7,'Neutralization','E-216A/B S/S neutralization','E-216A/B S/S neutralization (soda ash soak 4 h)','SOP-12-2018','{S313}',4,null,null,'not_started',null),
    (v_tpl,'S322','FO3',8,'Equipment handover','E-216A/B handover','E-216A/B handover','SOP-12-2018','{S321}',null,null,'E-12-216A, E-12-216B','not_started',null),
    (v_tpl,'S323','FO3',8,'Equipment handover','E-204 & E-205 handover','E-204 & E-205 handover','No SOP received','{S215,S214}',null,null,'E-12-204, E-12-205','not_started',null),
    (v_tpl,'S324','FO3',8,'Equipment handover','V-213, E-210, E-211 HO','V-213, E-210A/B & E-211 handover (E-211 steam-out 12 h)','SOP-12-2030 / 2017 (E-210: no SOP)','{S320}',12,null,'E-12-210A/B, E-12-211, V-12-213','not_started',null),
    (v_tpl,'S325','FO3',8,'Equipment handover','V-209 handover','V-209 handover (steam-out 24 h)','SOP-12-2027','{S320,S211,S315}',24,'Needs V-236 1st blinding & F/G blind','V-12-209','not_started',null),
    (v_tpl,'S326','FO3',8,'Equipment handover','H-202 handover','H-202 handover','SOP-12-2010','{S315,S118}',null,null,'H-12-202','not_started',null),
    (v_tpl,'S327','FO3',8,'Equipment handover','H-201 handover','H-201 handover (with H-202 – common stack)','SOP-12-2010','{S326,S319}',null,'H-201/202 cannot be entered individually','H-12-201','not_started',null);
  insert into public.trk_equipment (tracker_id, tag, grp, description, fo, ho_step, procedure, barchart_key, ops_item, critical, planned_ho, planned_finish, sort, stage, remark) values
    (v_tpl,'R-12-201','Reactors','Fixed bed reactor 1 (outlet grid)','FO1','S109','SOP-12-2009','R-12-201',true,false,'2026-10-20 07:00:00+03','2026-11-02 03:00:00+03',0,0,'Decoke line still choked'),
    (v_tpl,'R-12-202','Reactors','Fixed bed reactor 2','FO1','S109','SOP-12-2009','R-12-202',true,false,'2026-10-20 07:00:00+03','2026-11-02 03:00:00+03',1,0,'Outlet blinding done'),
    (v_tpl,'R-12-203','Reactors','Fixed bed reactor 3','FO1','S109','SOP-12-2009','R-12-203',true,false,'2026-10-20 07:00:00+03','2026-11-03 03:00:00+03',2,0,'Outlet blinding done'),
    (v_tpl,'R-12-204','Reactors','Fixed bed reactor 4','FO1','S109','SOP-12-2009','R-12-204',true,false,'2026-10-20 07:00:00+03','2026-11-02 15:00:00+03',3,0,null),
    (v_tpl,'R-12-205','Reactors','OCR reactor','FO1','S110','SOP-12-2008','R-12-205',true,true,'2026-10-20 07:00:00+03','2026-11-07 07:00:00+03',4,0,'Draining done'),
    (v_tpl,'H-12-201','Heaters','Charge heater','FO3','S327','SOP-12-2010','H-12-201',true,false,'2026-10-20 07:00:00+03','2026-10-31 19:00:00+03',5,0,null),
    (v_tpl,'H-12-202','Heaters','Recycle gas heater','FO3','S326','SOP-12-2010','H-12-202',true,false,'2026-10-20 07:00:00+03','2026-10-28 07:00:00+03',6,0,null),
    (v_tpl,'E-12-204','Exchangers','Recycle gas preheater no.2','FO3','S323','No SOP received','E-12-204',true,false,'2026-10-20 07:00:00+03','2026-10-31 19:00:00+03',7,0,'Hot bolting done'),
    (v_tpl,'E-12-205','Exchangers','Recycle gas preheater no.1','FO3','S323','No SOP received','E-12-205',true,false,'2026-10-20 07:00:00+03','2026-10-31 19:00:00+03',8,0,'Hot bolting done'),
    (v_tpl,'E-12-207','Exchangers','HPWS vapour trim cooler','FO2','S221','SOP-12-2015','E-12-207',true,false,'2026-10-20 07:00:00+03','2026-10-31 01:00:00+03',9,0,null),
    (v_tpl,'E-12-210A/B','Exchangers','LP hot separator condenser','FO3','S324','No SOP received',null,true,false,null,null,10,0,null),
    (v_tpl,'E-12-211','Exchangers','LP hot separator vapour trim cooler','FO3','S324','SOP-12-2017','E-12-211',true,false,'2026-10-20 07:00:00+03','2026-10-31 07:00:00+03',11,0,null),
    (v_tpl,'E-12-216A','Exchangers','Feed preheater no.2 A','FO3','S322','SOP-12-2018','E-12-216A',true,false,'2026-10-20 07:00:00+03','2026-10-28 19:00:00+03',12,0,null),
    (v_tpl,'E-12-216B','Exchangers','Feed preheater no.2 B','FO3','S322','SOP-12-2018','E-12-216B',true,false,'2026-10-20 07:00:00+03','2026-10-28 19:00:00+03',13,0,null),
    (v_tpl,'E-12-229','Exchangers','OCR feed / effluent exchanger','FO1','S116','No SOP received','E-12-229',true,false,'2026-10-20 07:00:00+03','2026-10-29 03:00:00+03',14,0,'Hot bolting done'),
    (v_tpl,'E-12-119','Exchangers','In logbook – not in TR-2 bar chart (confirm)',null,null,null,null,false,false,null,null,15,0,'Parts removed, tube bundle pulled out'),
    (v_tpl,'V-12-201','Vessels','Residue surge drum','FO3','S305','No SOP received','V-12-201',true,false,'2026-10-20 07:00:00+03','2026-10-23 07:00:00+03',16,2,'Manway open, under ventilation'),
    (v_tpl,'V-12-202','Vessels','Injection water surge drum','FO3','S302','SOP-12-2022','V-12-202',true,false,'2026-10-20 07:00:00+03','2026-10-25 03:00:00+03',17,0,'Under ventilation'),
    (v_tpl,'V-12-206','Vessels','HP hot separator','FO2','S219','SOP-12-2024','V-12-206',true,false,'2026-10-20 07:00:00+03','2026-10-22 15:00:00+03',18,0,'For cleaning from outside, PO/DX deblinded'),
    (v_tpl,'V-12-207','Vessels','HP warm separator','FO2','S224','No SOP received',null,true,false,null,null,19,0,'PO/DX deblinded'),
    (v_tpl,'V-12-208','Vessels','HP cold separator','FO2','S224','No SOP received',null,true,false,null,null,20,0,'PO/DX deblinded'),
    (v_tpl,'V-12-209','Vessels','LP cold separator','FO3','S325','SOP-12-2027','V-12-209',true,false,'2026-10-20 07:00:00+03','2026-10-24 19:00:00+03',21,0,null),
    (v_tpl,'V-12-210','Vessels','Wash water surge drum','FO2','S204','SOP-12-2028','V-12-210',true,false,'2026-10-20 07:00:00+03','2026-10-25 03:00:00+03',22,0,'Under ventilation'),
    (v_tpl,'V-12-212','Vessels','Recycle gas compressor K.O. drum','FO2','S222','SOP-12-2029','V-12-212',true,false,'2026-10-20 07:00:00+03','2026-10-25 19:00:00+03',23,0,'PO/DX deblinded'),
    (v_tpl,'V-12-213','Vessels','LP hot separator','FO3','S324','SOP-12-2030','V-12-213',true,false,'2026-10-20 07:00:00+03','2026-10-25 07:00:00+03',24,0,'PO/DX deblinded'),
    (v_tpl,'V-12-236','Vessels','HPCS sour water degassing drum','FO2','S211','SOP-12-2031','V-12-236',true,false,'2026-10-20 07:00:00+03','2026-10-27 03:00:00+03',25,0,'PO/DX deblinded'),
    (v_tpl,'F-12-202','Filters','Recycle gas filter','FO2','S220','No SOP received','F-12-202',true,false,'2026-10-20 07:00:00+03','2026-10-26 07:00:00+03',26,0,null),
    (v_tpl,'C-12-201-F-01B','Filters','C-201 lube oil filter','FO2','S223',null,'C-12-201-F-01B',true,false,'2026-10-20 07:00:00+03','2026-10-26 07:00:00+03',27,0,null),
    (v_tpl,'C-12-201-F-03A/B','Filters','C-201 lube oil filters (logbook)','FO2','S223',null,null,true,false,null,null,28,0,null),
    (v_tpl,'C-12-201','Compressor','Recycle gas compressor','FO2','S223','No SOP (main body)','C-12-201',true,false,'2026-10-20 07:00:00+03','2026-11-04 07:00:00+03',29,0,'Stopped at 09:30'),
    (v_tpl,'C-12-201-ST','Compressor','C-201 steam turbine driver','FO2','S223',null,'C-12-201-ST',true,false,'2026-10-20 07:00:00+03','2026-11-04 07:00:00+03',30,0,null),
    (v_tpl,'C-12-201 LO system','Compressor','C-201 lube oil system','FO2','S223',null,'C-12-201 LO system',true,false,'2026-10-20 07:00:00+03','2026-10-22 23:00:00+03',31,0,null),
    (v_tpl,'C-12-201-E-01A','Pumps / LO','C-201 LO cooler A','FO2','S223','SOP-12-2040',null,true,false,null,null,32,0,null),
    (v_tpl,'C-12-201-E-01B','Pumps / LO','C-201 LO cooler B','FO2','S223','SOP-12-2040',null,true,false,null,null,33,0,null),
    (v_tpl,'C-12-201-E-03','Pumps / LO','C-201 gland condenser','FO2','S223','SOP-12-2039',null,true,false,null,null,34,0,null),
    (v_tpl,'C-12-201-EJ-01','Pumps / LO','C-201 ejector','FO2','S223','SOP-12-2039',null,true,false,null,null,35,0,null),
    (v_tpl,'C-12-201-TK-01','Pumps / LO','C-201 LO tank','FO2','S223','SOP-12-2041',null,true,false,null,null,36,0,null),
    (v_tpl,'C-12-201-TK-03','Pumps / LO','C-201 LO rundown tank','FO2','S223','No SOP received','C-12-201-TK-03',true,false,'2026-10-20 07:00:00+03','2026-10-22 19:00:00+03',37,0,'Not in guideline'),
    (v_tpl,'P-12-203-E-01A','Pumps / LO','P-203 LO cooler A','FO3','S303','SOP-12-2037','P-12-203-E-01A',true,false,'2026-10-20 07:00:00+03','2026-10-24 07:00:00+03',38,0,null),
    (v_tpl,'P-12-203-E-01B','Pumps / LO','P-203 LO cooler B','FO3','S303','SOP-12-2037','P-12-203-E-01B',true,false,'2026-10-20 07:00:00+03','2026-10-24 07:00:00+03',39,0,null),
    (v_tpl,'P-12-203-TK-01','Pumps / LO','P-203 LO tank','FO3','S303','No SOP received',null,true,false,null,null,40,0,null),
    (v_tpl,'P-12-205-E-01','Pumps / LO','P-205 LO cooler','FO3','S307','SOP-12-2042',null,true,false,null,null,41,0,null),
    (v_tpl,'P-12-205-TK-01','Pumps / LO','P-205 LO reservoir tank','FO3','S307','No SOP received','P-12-205-TK-01',true,false,'2026-10-20 07:00:00+03','2026-10-22 07:00:00+03',42,0,null),
    (v_tpl,'P-12-203','Pumps / LO','Charge pump','FO3','S303',null,'P-12-203',true,false,'2026-10-20 07:00:00+03','2026-10-30 07:00:00+03',43,0,null),
    (v_tpl,'P-12-205','Pumps / LO','HP amine pump / HPRT','FO3','S307',null,'P-12-205',true,false,'2026-10-20 07:00:00+03','2026-10-30 07:00:00+03',44,0,'Bar chart calls it ''charge pump'' – check'),
    (v_tpl,'P-12-207A/B','Pumps / LO','Wash water pumps','FO2','S203',null,'P-12-207A/B',true,false,'2026-10-20 07:00:00+03','2026-10-21 15:00:00+03',45,0,null),
    (v_tpl,'12-HV-0534','CV shells','Control valve shell – remove, clean, inspect, hydrotest',null,null,'No isolation step in guideline','12-HV-0534',false,false,'2026-10-20 07:00:00+03','2026-10-23 03:00:00+03',46,0,null),
    (v_tpl,'12-HV-0535','CV shells','Control valve shell – remove, clean, inspect, hydrotest',null,null,'No isolation step in guideline','12-HV-0535',false,false,'2026-10-20 07:00:00+03','2026-10-23 03:00:00+03',47,0,null),
    (v_tpl,'12-HV-0536','CV shells','Control valve shell – remove, clean, inspect, hydrotest',null,null,'No isolation step in guideline','12-HV-0536',false,false,'2026-10-20 07:00:00+03','2026-10-23 03:00:00+03',48,0,null),
    (v_tpl,'12-HV-0546A','CV shells','Control valve shell – remove, clean, inspect, hydrotest',null,null,'No isolation step in guideline','12-HV-0546A',false,false,'2026-10-20 07:00:00+03','2026-10-23 03:00:00+03',49,0,null),
    (v_tpl,'12-HV-0546B','CV shells','Control valve shell – remove, clean, inspect, hydrotest',null,null,'No isolation step in guideline','12-HV-0546B',false,false,'2026-10-20 07:00:00+03','2026-10-23 03:00:00+03',50,0,null),
    (v_tpl,'12-HV-0548','CV shells','Control valve shell – remove, clean, inspect, hydrotest',null,null,'No isolation step in guideline','12-HV-0548',false,false,'2026-10-20 07:00:00+03','2026-10-23 03:00:00+03',51,0,null),
    (v_tpl,'12-HV-0548B','CV shells','Control valve shell – remove, clean, inspect, hydrotest',null,null,'No isolation step in guideline','12-HV-0548B',false,false,'2026-10-20 07:00:00+03','2026-10-23 03:00:00+03',52,0,null),
    (v_tpl,'12-HV-0580','CV shells','Control valve shell – remove, clean, inspect, hydrotest',null,null,'No isolation step in guideline','12-HV-0580',false,false,'2026-10-20 07:00:00+03','2026-10-23 03:00:00+03',53,0,null),
    (v_tpl,'12-LV-0531','CV shells','Control valve shell – remove, clean, inspect, hydrotest',null,null,'No isolation step in guideline','12-LV-0531',false,false,'2026-10-20 07:00:00+03','2026-10-23 03:00:00+03',54,0,null),
    (v_tpl,'12-LV-0553B','CV shells','Control valve shell – remove, clean, inspect, hydrotest',null,null,'No isolation step in guideline','12-LV-0553B',false,false,'2026-10-20 07:00:00+03','2026-10-23 03:00:00+03',55,0,'LV-553B passing (OPR list)'),
    (v_tpl,'12-PSV-0519','PSVs','PSV on V-12-202',null,null,null,'12-PSV-0519',false,false,'2026-10-20 07:00:00+03','2026-11-04 07:00:00+03',56,0,null),
    (v_tpl,'12-PSV-0537','PSVs','PSV on H-12-201',null,null,null,'12-PSV-0537',false,false,'2026-10-20 07:00:00+03','2026-11-04 07:00:00+03',57,0,null),
    (v_tpl,'12-PSV-0601','PSVs','PSV on P-12-203 suction',null,null,null,'12-PSV-0601',false,false,'2026-10-20 07:00:00+03','2026-11-04 07:00:00+03',58,0,null),
    (v_tpl,'12-PSV-0643','PSVs','PSV on V-12-209',null,null,null,'12-PSV-0643',false,false,'2026-10-20 07:00:00+03','2026-11-04 07:00:00+03',59,0,null),
    (v_tpl,'12-PSV-0719','PSVs','PSV on V-12-212',null,null,null,'12-PSV-0719',false,false,'2026-10-20 07:00:00+03','2026-11-04 07:00:00+03',60,0,null),
    (v_tpl,'12-PSV-1322','PSVs','PSV on C-12-201 P1A',null,null,null,'12-PSV-1322',false,false,'2026-10-20 07:00:00+03','2026-11-04 07:00:00+03',61,0,null),
    (v_tpl,'12-PSV-1339','PSVs','PSV on C-12-201 E3',null,null,null,'12-PSV-1339',false,false,'2026-10-20 07:00:00+03','2026-10-30 07:00:00+03',62,0,null),
    (v_tpl,'12-PSV-1403','PSVs','PSV on NSD – bar chart only',null,null,null,'12-PSV-1403',false,false,'2026-10-20 07:00:00+03','2026-10-30 07:00:00+03',63,0,null),
    (v_tpl,'12-PSV-1404','PSVs','PSV on NSD – bar chart only',null,null,null,'12-PSV-1404',false,false,'2026-10-20 07:00:00+03','2026-10-30 07:00:00+03',64,0,null),
    (v_tpl,'12-VC-0105','Check valves','XV-12-542 d/s NRV',null,null,null,'12-VC-0105',false,false,'2026-10-20 07:00:00+03','2026-10-30 07:00:00+03',65,0,null),
    (v_tpl,'12-VC-0106','Check valves','FV-12-0548 d/s NRV','FO1','S111','SOP-12-2006','12-VC-0106',true,false,'2026-10-20 07:00:00+03','2026-10-30 07:00:00+03',66,0,null),
    (v_tpl,'12-VC-0107','Check valves','FV-12-1427 d/s NRV','FO1','S115','SOP-12-2006','12-VC-0107',true,false,'2026-10-20 07:00:00+03','2026-10-30 07:00:00+03',67,0,null),
    (v_tpl,'12-VC-0108','Check valves','FV-12-1426 d/s NRV','FO1','S111','SOP-12-2006','12-VC-0108',true,false,'2026-10-20 07:00:00+03','2026-10-30 07:00:00+03',68,0,null),
    (v_tpl,'R-205 withdrawal line d/s KV-7B/8B','RTJ & injection','4 RTJ / injection points',null,'S117','SOP-12-2006',null,false,false,null,null,69,0,null),
    (v_tpl,'H-201 O/L to R-205 I/L','RTJ & injection','12 RTJ / injection points',null,'S115','SOP-12-2006',null,false,false,null,null,70,0,null),
    (v_tpl,'H-202 O/L','RTJ & injection','2 RTJ / injection points',null,'S118','SOP-12-2006',null,false,false,null,null,71,0,null),
    (v_tpl,'R-201 to R-202','RTJ & injection','14 RTJ / injection points',null,'S113','SOP-12-2006',null,false,false,null,null,72,0,null),
    (v_tpl,'R-202 to R-203','RTJ & injection','15 RTJ / injection points',null,'S113','SOP-12-2006',null,false,false,null,null,73,0,null),
    (v_tpl,'R-203 to R-204','RTJ & injection','14 RTJ / injection points',null,'S113','SOP-12-2006',null,false,false,null,null,74,0,null),
    (v_tpl,'R-204 to V-206','RTJ & injection','6 RTJ / injection points',null,'S113','SOP-12-2006',null,false,false,null,null,75,0,null),
    (v_tpl,'E-202 to E-203','RTJ & injection','2 RTJ / injection points',null,'S215','SOP-12-2006',null,false,false,null,null,76,0,null),
    (v_tpl,'E-205 to EA-201','RTJ & injection','74 RTJ / injection points',null,'S218','SOP-12-2006',null,false,false,null,null,77,0,null),
    (v_tpl,'V-207 to V-213','RTJ & injection','15 RTJ / injection points',null,'S217','SOP-12-2006',null,false,false,null,null,78,0,null),
    (v_tpl,'V-206 to V-213','RTJ & injection','6 RTJ / injection points',null,'S217','SOP-12-2006',null,false,false,null,null,79,0,null),
    (v_tpl,'E-229 sample point','RTJ & injection','4 RTJ / injection points',null,'S111','SOP-12-2006',null,false,false,null,null,80,0,null),
    (v_tpl,'FV-1427','RTJ & injection','2 RTJ / injection points',null,'S118','SOP-12-2006',null,false,false,null,null,81,0,null),
    (v_tpl,'R-205 to E-229','RTJ & injection','4 RTJ / injection points',null,'S111','SOP-12-2006',null,false,false,null,null,82,0,null),
    (v_tpl,'FV-1426 d/s','RTJ & injection','1 RTJ / injection points',null,'S111','SOP-12-2006',null,false,false,null,null,83,0,null),
    (v_tpl,'V-206 LT bridle','RTJ & injection','27 RTJ / injection points',null,'S219','SOP-12-2006',null,false,false,null,null,84,0,null),
    (v_tpl,'Wash water to EA-201','RTJ & injection','29 RTJ / injection points',null,'S218','SOP-12-2006',null,false,false,null,null,85,0,null),
    (v_tpl,'WP-12-2017-HRE5-1','Process piping','Process piping inspection',null,null,null,'WP-12-2017-HRE5-1',false,false,'2026-10-20 07:00:00+03','2026-10-25 07:00:00+03',86,0,null),
    (v_tpl,'P-12-2057-HRW1','Process piping','Process piping inspection',null,null,null,'P-12-2057-HRW1',false,false,'2026-10-20 07:00:00+03','2026-10-30 07:00:00+03',87,0,null),
    (v_tpl,'P-12-2059&P-12-2065','Process piping','Process piping inspection',null,null,null,'P-12-2059&P-12-2065',false,false,'2026-10-20 07:00:00+03','2026-10-30 07:00:00+03',88,0,null),
    (v_tpl,'OPR list (36 items)','OPR list','Operations misc. items as per bar chart',null,null,null,'OPR LIST MISC. ITEMS as per list (36 nos)',false,false,'2026-10-20 07:00:00+03','2026-10-20 15:00:00+03',89,0,null),
    (v_tpl,'MAB-2931','PMRs','Injection water supply upstream of E-12-205',null,null,null,null,false,false,null,null,90,0,null),
    (v_tpl,'MAB-4637','PMRs','Isolation valves upstream of FV-12-004B',null,null,null,null,false,false,null,null,91,0,null),
    (v_tpl,'MAB-4636','PMRs','Isolation valve upstream of FV-12-003B',null,null,null,null,false,false,null,null,92,0,null),
    (v_tpl,'MAB-2345','PMRs','Flow indicator on utility water header to V-213 PSV header',null,null,null,null,false,false,null,null,93,0,null),
    (v_tpl,'MAB-1881','PMRs','Replace obsolete LTs for R-12-205',null,null,null,null,false,false,null,null,94,0,null),
    (v_tpl,'MAB-3596','PMRs','Upgrade obsolete PLCs for C-12-201',null,null,null,null,false,false,null,null,95,0,null);
  insert into public.trk_trackers (event_id, title, mode, template_id, settings) select event_id, title, 'test', id, settings from public.trk_trackers where id = v_tpl returning id into v_test;
  perform public.trk_copy(v_tpl, v_test, true);
end $$;
