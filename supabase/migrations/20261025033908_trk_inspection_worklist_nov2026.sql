-- Inspection worklist, Unit-12 Train 2 shutdown November 2026 (Inspection & Corrosion Division), applied 25 Oct 2026:
--  · each item's work required from the worklist is kept on the item (insp_ref = where it comes from, insp_work = the
--    work lines), shown in the item's details. Reference only: no step, plan date or hour changes.
--  · 12-PSV-0516 (V-12-201) and 12-PSV-0587 (T-12-201) are on the worklist PSV list but were not in the tracker: added
--    with the PSV steps as added steps (no plan time, so the % and the end date do not change).
--  · P-12-203-E-01A: "Offer for Rotating" reads "Offer for Inspection / NDT" as the worklist asks (the P6 text is kept
--    by the rename trigger).
--  · C-12-201-F-01B is not on the Inspection worklist (process inspection only): listed under Rotating scope (owner).
alter table public.trk_equipment add column if not exists insp_ref text, add column if not exists insp_work text;
comment on column public.trk_equipment.insp_ref is 'Inspection worklist reference (document, item, last inspection, frequency). Display only.';
comment on column public.trk_equipment.insp_work is 'Work required by the inspection worklist, one line per bullet. Display only.';

insert into public.trk_equipment (tracker_id, tag, grp, description, barchart_key, sort)
select v.t::uuid, v.tag, v.g, v.d, v.k, coalesce((select max(sort) from public.trk_equipment where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'), 0) + row_number() over ()
  from (values
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', '12-PSV-0516', 'PSVs', 'PSV on V-12-201 residue surge drum · worklist: 1 1/2x1 408 (attachment 1; not on the bar chart)', '12-PSV-0516'),
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', '12-PSV-0587', 'PSVs', 'PSV on T-12-201 top (H2S scrubber) · worklist: 1x2 1858.40 (attachment 1; not on the bar chart)', '12-PSV-0587')) v(t, tag, g, d, k)
 where not exists (select 1 from public.trk_equipment e where e.tracker_id = v.t::uuid and e.tag = v.tag);

insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, seq, baseline)
select v.t::uuid, v.aid, v.g, v.k, v.a, v.s, coalesce((select max(baseline) from public.trk_activities where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'), 1)
  from (values
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', 'ENG-WL-0516-1', 'PSVs', '12-PSV-0516', 'Isolate and remove PSV to shop', 1),
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', 'ENG-WL-0516-2', 'PSVs', '12-PSV-0516', 'Install blind on flange', 2),
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', 'ENG-WL-0516-3', 'PSVs', '12-PSV-0516', 'Overhaul PSV (workshop)', 3),
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', 'ENG-WL-0516-4', 'PSVs', '12-PSV-0516', 'Remove blind', 4),
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', 'ENG-WL-0516-5', 'PSVs', '12-PSV-0516', 'Install PSV', 5),
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', 'ENG-WL-0587-1', 'PSVs', '12-PSV-0587', 'Isolate and remove PSV to shop', 1),
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', 'ENG-WL-0587-2', 'PSVs', '12-PSV-0587', 'Install blind on flange', 2),
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', 'ENG-WL-0587-3', 'PSVs', '12-PSV-0587', 'Overhaul PSV (workshop)', 3),
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', 'ENG-WL-0587-4', 'PSVs', '12-PSV-0587', 'Remove blind', 4),
  ('406998dc-a9ce-47ca-9a4f-fe74845b4b6a', 'ENG-WL-0587-5', 'PSVs', '12-PSV-0587', 'Install PSV', 5)) v(t, aid, g, k, a, s)
 where not exists (select 1 from public.trk_activities x where x.tracker_id = v.t::uuid and x.activity_id = v.aid);

update public.trk_equipment e set insp_ref = v.r, insp_work = v.w
  from (values
  ('E-12-211', 'Inspection worklist Nov 2026 · item 1 · last inspected 15.05.2025 · every 12 months', '• Open covers, pull out tube bundle, hydroblast clean using process water containing chloride < 50 ppm and offer for inspection.
• Through cleaning of shell for carrying out extensive NDT on the shell and nozzles.
• Possible belzona 1311 and 1321 coating repairs on the sea water side./P-214 Epoxy Filler
• Hydrotest shell side at 620 psig and tube side at 620 psig using process water containing chloride < 50 ppm.'),
  ('E-12-216A', 'Inspection worklist Nov 2026 · item 2 · last inspected 14.03.2022 · every 60 months', '• Open tube side, pull out shell, hydroblast clean using 2% Soda Ash solution and offer for inspection.
• Carry out Eddy current /IRIS inspection.
• Hydrotest tube side at 4500 psig and shell side 383 psig using process water containing chlorides <50ppm.'),
  ('E-12-216B', 'Inspection worklist Nov 2026 · item 4 · last inspected 14.03.2022 · every 60 months', '• Open tube side, pull out shell, hydroblast clean using 2% Soda Ash solution and offer for inspection.
• Carry out Eddy current /IRIS inspection.
• Hydrotest tube side at 4500 psig and shell side 383 psig using process water containing chlorides <50ppm.'),
  ('E-12-204', 'Inspection worklist Nov 2026 · item 5 · last inspected 14.03.2022 · every 60 months', '• Neutralize the tube bundle with 2% soda ash solution.
• Open, pull out the tube bundle and clean for inspection
• Hydroblast tube bundle using 2% soda ash inspection.
• Hydroblast tube bundle using 2% soda ash solution.
• Measure diaphragm dimensions
• Replace threaded lock ring in kind, Part # 124 of L&T Dwg # 131301-01 Sheet 1 of 2
• Remove insulation on shell, channel external surface over approx. 2ft. X 2ft. , buff/grit blast clean for carrying HTHA scanning.
• Hydrotest shell side at differential pressure of 866 psig'),
  ('V-12-236', 'Inspection worklist Nov 2026 · item 6 · last inspected 14.03.2022 · every 60 months', '• Open, Clean the vessel ID by grit blasting, make the vessel gas free and offer for inspection.
• WFMPI inspection
• PAUT to be carried out.
• Paint touch up for the WFMPI locations to be done
• Paint touch up for the PAUT LOCATIONS to be done'),
  ('E-12-229', 'Inspection worklist Nov 2026 · item 7 · last inspected 21.04.2025 · every 12 months', '• Neutralize tube bundle with 2% Soda ash solution.
• Pull out tube bundle, hydroblast using 2% soda ash solution & offer for inspection.
• Measure diaphragm dimensions.
• Hydrotest shell side at differential pressure of 1900 psig using process water containing chloride <50 ppm.
• Hydrotest shell and tube sides simultaneously at 4805 psig and 3300 psig respectively.'),
  ('P-12-203-E-01A', 'Inspection worklist Nov 2026 · item 8 · last inspected 15.05.2025 · every 24 months', '• Open, dismatle, clean and offer for inspection/NDT.
• Possible repairs to painting on cooling water side of subject equiment parts.
• Hydrotest shell side at 240 psig and tube side at 225 psig.'),
  ('P-12-205-TK-01', 'Inspection worklist Nov 2026 · item 9 · last inspected 19.08.2019 · every 90 months', '• Open, remove all the lube oil, clean and offer for inspection.'),
  ('R-12-205', 'Inspection worklist Nov 2026 · item 10 · last inspected 21.04.2025 · every 12 months', '• Disconnect the isotopes used for catalyst level measurements, pull up into the safe container on top of reactor and lock up for safe entry into the reactor.
• Open top & bottom elbows, dump catalyst & hydroblast clean internally for inspection using 2% Soda Ash soln.
• Erect complete internal scaffolding and provide access at all thermowells, nozzles and quench pipe locations, clean by buffing and offer for inspection.
• Remove grating from the top platform & provide suitable approach for inlet nozzle neck inspection.
• Remove the insulation on the inlet nozzle up to the bottom of the nozzle neck including weld joint between head and nozzle for inspection/Magnetic particle.
• offer for inspection/NDT'),
  ('V-12-201', 'Inspection worklist Nov 2026 · item 11 · last inspected 19.08.2019 · every 96 months', '• Open Vessel and erect Internal scaffolding.
• Hydroblast clean & offer for inspection.
• Spot buff clean the shell weld joints internally for NDT/Inspection.'),
  ('12-HV-0534', 'Inspection worklist Nov 2026 · item 12 · last inspected 14.03.2022 · every 60 months', '• Clean and offer for inspection.
• Offer hydrotest at 225 psig pressure.'),
  ('12-HV-0535', 'Inspection worklist Nov 2026 · item 13 · last inspected 14.03.2022 · every 60 months', '• Clean and offer for inspection.
• Offer hydrotest at 225 psig pressure.'),
  ('12-HV-0536', 'Inspection worklist Nov 2026 · item 14 · last inspected 14.03.2022 · every 60 months', '• Clean and offer for inspection.
• Offer hydrotest at 225 psig pressure.'),
  ('12-HV-0546A', 'Inspection worklist Nov 2026 · item 15 · last inspected 14.03.2022 · every 60 months', '• Clean and offer for inspection.
• Offer hydrotest at 225 psig pressure.'),
  ('12-HV-0546B', 'Inspection worklist Nov 2026 · item 16 · last inspected 14.03.2022 · every 60 months', '• Clean and offer for inspection.
• Offer hydrotest at 225 psig pressure.'),
  ('12-HV-0548B', 'Inspection worklist Nov 2026 · item 17 · last inspected 14.03.2022 · every 60 months', '• Clean and offer for inspection.
• Offer hydrotest at 225 psig pressure.'),
  ('12-HV-0548', 'Inspection worklist Nov 2026 · item 18 · last inspected 14.03.2022 · every 60 months', '• Clean and offer for inspection.
• Offer hydrotest at 225psig pressure.'),
  ('12-HV-0580', 'Inspection worklist Nov 2026 · item 19 · last inspected 14.03.2022 · every 60 months', '• Clean and offer for inspection.
• Offer hydrotest at 214 psig pressure.'),
  ('12-LV-0531', 'Inspection worklist Nov 2026 · item 20 · last inspected 14.03.2022 · every 60 months', '• Clean and offer for inspection.
• Offer hydrotest at 300 psig pressure.'),
  ('12-LV-0553B', 'Inspection worklist Nov 2026 · item 21 · last inspected 14.03.2022 · every 60 months', '• Clean and offer for inspection.
• Offer hydrotest at 300 psig pressure.'),
  ('C-12-201-TK-03', 'Inspection worklist Nov 2026 · item 22 · last inspected 03.06.2018 · every 96 months', '• Open clean and offer for inspection'),
  ('WP-12-2017-HRE5-1', 'Inspection worklist Nov 2026 · item 23', '• Service the check valves in the injection water spools to H-12-201 & carry out hydrotest of the spools @ 3980 psig.
• Erect complete scaffolding to carry out 100% UT scanning of pipe & Xray/Radiography of 25% butt weld joints.
• Buffing of the weld joints is required.
• RT/UFD for 25% of weld joints for all lines.
• Erect complete scaffolding to carry out 100% UT scanning of pipe & Xray/Radiography of 25% butt weld joints.
• Buffing of the weld joints is required.
• Scaffolding, Crane / baskets etc for thickness survey shall be provided as required for lines which shall be listed separately. Insulation removal, cleaning of welds by wire brush / buffing for carrying out NDE, as required.'),
  ('H-12-201', 'Inspection worklist Nov 2026 · item 30 · not due for inspection', '• Neutralize tube OD/ID with 2% Soda ash solution.
• Remove complete insulation on outlet headers including all the 4 pass connections.
• Carry out profile radiography and UFD scanning of 90° elbows on the radiation outlet of all four passes.
• Possible refractory repairs.'),
  ('12-PSV-0516', 'Inspection worklist Nov 2026 · attachment 1 (PSVs) · 1 1/2x1 408 V-12-201, RESIDUE SURGE DRUM · every 60 months · next due 30.03.2027', '• Remove and overhaul the safety valves as per the list.'),
  ('12-PSV-0519', 'Inspection worklist Nov 2026 · attachment 1 (PSVs) · 1 1/2x3 95 V-12-202, INJ WATER SURGE DRUM · every 60 months · next due 30.03.2027', '• Remove and overhaul the safety valves as per the list.'),
  ('12-PSV-0537', 'Inspection worklist Nov 2026 · attachment 1 (PSVs) · 1.5x2.5 2550 Inj: Water to H-12-201, CHARGE HEATER HOT WATER COIL · every 60 months · next due 04.07.2026', '• Remove and overhaul the safety valves as per the list.'),
  ('12-PSV-0601', 'Inspection worklist Nov 2026 · attachment 1 (PSVs) · 1x2 446.42 P-12-203 A Suction, RESID CHARGE PUMP · every 60 months · next due 16.05.2027', '• Remove and overhaul the safety valves as per the list.'),
  ('12-PSV-0643', 'Inspection worklist Nov 2026 · attachment 1 (PSVs) · 3x4 350 V-12-209, L.O PRESS COLD SEP · every 60 months · next due 24.04.2027', '• Remove and overhaul the safety valves as per the list.'),
  ('12-PSV-0719', 'Inspection worklist Nov 2026 · attachment 1 (PSVs) · 1x2 , 1858.4 V-12-112, RECYCLE GAS K.O · every 90 months · next due 16.03.2027', '• Remove and overhaul the safety valves as per the list.'),
  ('12-PSV-1322', 'Inspection worklist Nov 2026 · attachment 1 (PSVs) · 2x4 ,85.85 C-12-201 PUMP TURBINE · every 48 months · next due 16.08.2026', '• Remove and overhaul the safety valves as per the list.'),
  ('12-PSV-1339', 'Inspection worklist Nov 2026 · attachment 1 (PSVs) · 3/4x1,150 C-12-201 L.O. Turb. C.W. O/L · every 48 months · next due 16.08.2026', '• Remove and overhaul the safety valves as per the list.'),
  ('12-PSV-0587', 'Inspection worklist Nov 2026 · attachment 1 (PSVs) · 1x2 1858.40 T-12-201 Top, H2S SCRUBBER · every 45 months · next due 25.12.2027', '• Remove and overhaul the safety valves as per the list.')) v(tag, r, w)
 where e.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and e.tag = v.tag;
update public.trk_equipment set insp_ref = 'Inspection worklist Nov 2026 · item 29 · high-pressure check valves (the list is not in the worklist file)', insp_work = '• Open, service and hydrotest body & seat of the HP check valves as per the list.'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and grp = 'Check valves';
update public.trk_equipment set insp_ref = 'Inspection worklist Nov 2026 · items 24–25 · attachment 4 (236 RTJ flanges on 18 lines) and 5 (8 injection points)', insp_work = '• Provide access/ scaffold as requierd. Remove insulation,open flanges,clean and offer for inspection & LPT check RTJ groove as repair may be requierd.
• open all the injection nozzels , clean the pipe section and offer for LP check & UT scanning.'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and grp = 'RTJ & injection';

update public.trk_activities set activity = 'Offer for Inspection / NDT'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and equipment_key = 'P-12-203-E-01A' and activity = 'Offer for Rotating';

update public.trk_equipment set list = 'rotating' where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and tag = 'C-12-201-F-01B' and list is null;
