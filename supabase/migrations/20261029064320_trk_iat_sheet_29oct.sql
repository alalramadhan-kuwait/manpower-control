-- IAT tracking sheet, Train-2 shutdown, as received 29 Oct 2026: every IAT on the sheet into the tracker (one row per IAT
-- number). An IAT already in the tracker keeps its item (tag), operations label and issue date; the sheet sets its work
-- order, details, checks, painting IAT, who acts, status and remark (each status / remark change is logged by trigger).
with s(iat_no, wo, tag, line, job_text, finding, recommendation, line_class, material, checks, painting, action_by, sheet_status, remark) as (values
('2022-19516','12419285','H-12-201','WP-12-2017','Damaged RTJ flange','On May-09-2022 Operations reported that, 3'''' dia. RTJ flange was found damaged at the grooving area as highlighted on the attached sketch.','1) Gently remove the damage/ dent locations by pencil grinding.
2) After removal carryout LPT to confirm the surface free from any defects.
3) Carry out weld build-up using ER 70S-2 filler wire/GTAW process with min. preheat 50°F.
3) Machine to original dimension.
4) Carry out final LPT.
KMA/MAA
File : 12.03','HR9','1.1/2" X2500 RTJ Flange required (HR9)/ IAT IS FOR FLANGE REPAIR','{"lpt": "REQ"}'::jsonb,'{}'::jsonb,'WS','In progress','Clamp Removal done
Area prep. Done
Cutting to start as per new IAT'),
('2026-64351','20399634','VT-12-2018','VT-12-2018','Defective valve replacement (GR1) [sr 30 ]','Operation / Mechanical Maintenance requested IAT for replace 3/4" dia. defective valve of LT-12-598 on the subjected line VT-12-2018-GR1-2". See the attached sketch for the location.','1) Replace the defective 3/4" dia. valve as marked in the attached sketch using in kind "GR1" line class material.
2) Carry out welding using ER 70S-2 filler wires/GTAW process.
3) New welds shall be visually and LTP checked.
4) Carry out hydrotest at 2740 psig.
 .
MAE/UBM
File: 12.03','GR1','3/4" x1500 glabe valve 1 Nos. (GR1)','{"lpt": "REQ", "hydro": "REQ\n2740"}'::jsonb,'{"wo": "20419697", "ref": "2026-64635"}'::jsonb,'WS','In progress','Area Prep. Done
WS COMP
HT to start'),
('2026-64352','20399651','P-12-2061','P-12-2061','Replacement of defective valves (GR1) [sr 37]','Operations / Mechanical Maintenance has requested an IAT for the replacement of two (2) defective 3/4-inch diameter valves on the subject line P-12-2061-GR1-3/4" See the attached sketch for the location.','1. Replace the 2 nos. of defective valves in kind using "GR1" line class valves. Refer to the attached sketch for location.
2. Use ER 70S-2 filler wire/GTAW process for welding.
3. Offer the new welds for liquid penetrant testing.
4. Hardness test the new socket welds and if hardness exceeds 200 BHN, PWHT will be required. Separate IAT will be issued after carrying out hardness test, if required.
5. Hydrotest the spool at 2760 psig.
MG/UBM
File :12.3','GR1','¾" × 1500# S.W. Gate Valve ( 2 Nos)
¾" Pipe ( 4 meters ) (GR1)','{"lpt": "REQ", "pwht": "IF REQ.", "hardness": "REQ", "hydro": "REQ\n2760"}'::jsonb,'{"wo": "20419806", "ref": "2026-64638", "status": "IP"}'::jsonb,'MM','Completed','Welding Done
HT COMP
Fixed back
Painting IP'),
('2026-64624','20420139','PO-12-2006','PO-12-2006','Replacement of thinned piping section','Ultrasonic thickness was carried out for the subject line PO-12-2006-A5-1.5". which revealed low thickness readings, thickness as low as 2.7 mm was measured against the nominal of 5.1 mm. See the attach sketch for location.','1) Replace the corroded / marked 1.5" dia piping section in kind using "A5" line class materials.
2) Use ER 70S-2 filler wire/GTAW process for welding.
3) Carry out Liquid Penetrant examination of new welds.
4) Offer 5% radiography of the new butt weld joints.
5) service test .
6) Separate IAT will be issued for external painting.
MG/UBM
File :12.3','A5',null,'{"lpt": "REQ", "xray": "REQ", "service": "REQ"}'::jsonb,'{"wo": "20429789", "ref": "2026-64873", "status": "IP"}'::jsonb,'MM','In progress','RT to not req
WS COMP
Spool shifted to painting
Painting to start'),
('2026-64622','20420105','P-12-2087','P-12-2087','Replacement of thinned piping section','Ultrasonic thickness was carried out for the subject Recycle gas line P-12-2087-AD8-8". which revealed low thickness readings, thickness as low as 4.7 mm was measured against the nominal of 7 mm. See the attach sketch for location.','1) Replace the marked / thinned 8" dia section of the line in kind using "AD8" line class material requirements.
2) For welding use E 7018 electrodes / SMAW process with a min. preheat 50°F.
3) Offer the new welds for visual inspection & LP checked.
4) Carry out 5% radiography test of the new butt weld joints.
5) Hydro test the line at 23 psig.
MG/UBM
File: 12.3','AD8',null,'{"lpt": "REQ", "xray": "REQ", "hydro": "REQ"}'::jsonb,'{"wo": "20430339", "ref": "2026-64872"}'::jsonb,'MM','In progress','Spool Dropped & Shifted
WS done
RT cleared
HT COMP
Painting to start at yard'),
('2026-64623','20399735','P-12-2099','P-12-2099','Replacement of corroded piping section (CH4)','Ultrasonic thickness measurement for the subject line (P-12-2099-CH4-6") was carried out and thickness as low as 4.4 mm was measured against the nominal of 8.5 mm on the 4" dia. section as marked in the attached sketch.','1. Replace the marked / thinned 4"  dia section of the line in kind using "CH4" line class piping materials. Materials shall comply with NACE MR-01-75.
2. Use E 6010 electrodes/SMAW process for root pass and E 7018 electrodes/SMAW process for the remaining passes.
3. Offer the new welds for LP check.
4. Carryout hardness test for the newly weld joints.
Stress relieving may be required if hardness value exceeds 200 BHN.
If required PWHT shall be carried out as per following cycle:
 Heating Rate : 250 °F /hr.
 Holding temperature/time : 1150 °F/ 1 hr.
 Cooling Rate : 200 °F/hr.
5. Carry out 5% radiography test of the new butt weld joints. In case the new weld joint being are subjected to PWHT, 100% radiography of the new welds BEFORE and AFTER PWHT shall be carried out.
6. Hydrotest the spool at 525 psig.
7. Separate IAT will be issued by corrosion engineer for painting.
Note:  Offer new pipe/fittings for ultrasonic thickness measurements prior to use.
MG/UBM
Attach.,
File :12.3','CH4',null,'{"lpt": "REQ", "xray": "REQ", "pwht": "REQ", "hardness": "REQ", "hydro": "REQ"}'::jsonb,'{"wo": "20430698", "ref": "2026-64871", "status": "IP"}'::jsonb,'MM','In progress','Spool Dropped & Shifted
WS Comp
RT cleared
HT COMP
Painting IP at yard'),
('2026-64210','20393359','P-12-2350','P-12-2350','Replacement of corroded piping section (CH4)','Ultrasonic Thickness Measurement and Ultrasonic Flaw Detector scanning were carried out for the subjected line P-12-2350-CH4-6"/4", which revealed low thickness readings, thickness as low as 5.1 mm was measured against the nominal of 11 mm. See the attach sketch for location.','1. Replace the marked / thinned 6" dia section of the line in kind using "CH4" line class piping materials.
2. Use E 6010 electrodes/SMAW process for root pass and E 7018 electrodes/SMAW process for the remaining passes.
3. Offer the new welds for LP check.
4. Carryout hardness test. Stress relieving may be required if hardness value exceeds 200 BHN.
5. Carry out 5% radiography test of the new butt weld joints.
6. Hydrotest at 540 psig.
Note: Materials shall comply with NACE MR-01-03.
MG/UBM
File :12.3','CH4',null,'{"lpt": "REQ", "xray": "REQ", "pwht": "IF REQ", "hardness": "REQ", "hydro": "REQ"}'::jsonb,'{"wo": "20430858", "ref": "2026-64870", "status": "COMP"}'::jsonb,'MM','In progress','Painting COMP
Fixback IP'),
('2026-64743','20425952','E-12-119',null,'complete re-tubing','As recommended in ICR #2025-02519 for full re-tubing','1. Complete re-tubing using 3/4" OD X BWG 16 70/30 Cu-Ni tubes to SB-111-alloy C-71500.
2. Expand the tubes after insertion.
3. After removing the existing tubes, offer the tube-sheet for inspection.
4. If weld repair of the tube sheet and tack welds is required. Use E NiCu-7 electrodes / SMAW process and machine the tube sheet as per original dimensions.
MG/AMQ
File:  E-12-119','Re-Tubing IAT','3/4" OD X BWG 16 70/30 Cu-Ni tubes to SB-111-alloy C-71500','{}'::jsonb,'{}'::jsonb,'MS / MM','In progress','Comp, Sacrificial anode fab.?'),
('2026-64808','20427218','V-12-202',null,'Internal Painting of the equipment','Visual inspection of the vessel was carried out, and internal painting was observed damaged on the bottom dish, manway and shell (upto approx. 2mt. height from the bottom dish) at isolated locations which shall be painted after completion of all mechanical works as per following procedure:','Internal surface of bottom dish, manway and shell (up to approx. 2.0mt. height from the bottom dish)
1) Clean surface of paint damaged locations mechanically by power tools to St-3.
2) Apply two coats of Phenolic Epoxy (P-220) at the cleaned locations and match with existing paint thickness.
Note: Paint DFT, overcoat intervals and final curing shall be as per used paint manufacturer datasheets.
FAS/RDT
File #V-12-202','PAINTING IAT',null,'{}'::jsonb,'{}'::jsonb,'MM','Completed','Painting COMP'),
('2026-64807','20427221','V-12-210',null,'Internal Painting of the equipment','Visual inspection of the vessel was carried out, and internal painting was observed damaged on the bottom dish, manway and shell (upto approx. 2mt. height from the bottom dish) at isolated locations which shall be painted after completion of all mechanical works as per following procedure:','Internal surface of bottom dish, manway and shell (up to approx. 2.0mt. height from the bottom dish)
1) Clean surface of paint damaged locations mechanically by power tools to St-3.
2) Apply two coats of Phenolic Epoxy (P-220) at the cleaned locations and match with existing paint thickness.
Note: Paint DFT, overcoat intervals and final curing shall be as per used paint manufacturer datasheets.
FAS/RDT
File #V-12-210','PAINTING IAT',null,'{}'::jsonb,'{}'::jsonb,'MM','Completed','Painting COMP'),
('2026-64925','20436566','P-12-2058','P-12-2058','RTJ Groove Repair','During LPT survey of the offered RTJ flanges in the subject line, a crack was observed at the groove of the marked RTJ (valve side) (RTJ#10).','1. Remove the crack in the RTJ groove by machining/grinding and confirm by liquid penetrant testing. See the attached sketch.
2. Weld build up using ER 347 filler wire/GTAW process.
3. Machine to original dimensions, followed by LPT.
MG/AMQ',null,null,'{"lpt": "REQ"}'::jsonb,'{}'::jsonb,null,'In progress','CV dropped LV-539
MS & WS to start'),
('2026-64933','20436582','E-12-119',null,'Weld Repair of Floating Head Cover','The subject exchanger was offered during Oct-2026 shutdown. Visual inspection of the components revealed that Weep hole on the pass partition plate of the Floating head cover has been enlarged.
Note: Inspection activities are still in progress. Further IAT will be issued based on inspection findings.','For repair of enlarged weep hole proceed as follows:
1) Smoothen the enlarged weep hole by grinding.
2) Weld build up the weep hole using ER Cu-Ni Filler Wire/GTAW process.
3) Machine and drill back the weep hole to original dimension & location.
4) Carry out LPT on completed weld.
YAM/ARA
File: E-12-119.',null,null,'{"lpt": "REQ"}'::jsonb,'{"wo": "20447926", "ref": "2026-65089"}'::jsonb,null,'In progress','Comp, Sacrificial anode fab.?'),
('2026-64971','20454241','P-12-2057-HRW1','P-12-2057','RTJ Crack Repair','During LP check of the RTJ grooves of the subject piping, A crack was noticed on RTJ groove of water injection nozzle flange. See attached sketch. (RTJ-54)','1. Remove the cracks in the RTJ groove of flanges/spacers by machining and confirm by liquid penetrant testing.
2. Weld build up using ER 347 filler wire/GTAW process.
3. Machine to original dimensions.
4. Carryout liquid penetrant testing.
Note: LP check of RTJ grooves in the subject line is still in progress. Further cracks (if found) will be repaired as per the same repair procedure.
MG/UBM
File: 12.3',null,null,'{"lpt": "REQ"}'::jsonb,'{}'::jsonb,'MS','In progress','MS pre-Machineing'),
('2026-64977','20454253','WP-12-2008','WP-12-2008','RTJ Crack Repair','During LP check and visual inspection, cracks were observed in 1 nos of injection nozzle RTJ groves in the subject wash water line. Line class is "HRW1". Locations are marked as RTJ # 5 in the attached sketch.','1. Remove the cracks in the RTJ groove of the 2" dia defective flange by machining and confirm by liquid penetrant testing.
2. Weld build up using ER 347 filler wire/GTAW process.
3. Machine to original dimensions.
4. Carryout liquid penetrant testing.
a) In case cracks could not be removed, then replace the 2" dia flange in kind using "HRW1" line class flange.
b) Offer the new flange for PMI before welding.
c) Use ER 347 filler wire/GTAW process.
d) Offer the new welds for LP check.
e) Radiograph the butt weld.
f) Hydrotest the line at 2865 psig using process water containing chlorides <50ppm.
Note : RTJ inspection of the remaining flanges are in progress. Separate IAT will be issued if required.
MG/UBM
File : 12.3','HRW1',null,'{"lpt": "REQ", "xray": "REQ", "hydro": "REQ"}'::jsonb,'{}'::jsonb,null,'In progress','Spool dropped & shifted
Welding COMP,
Final machine IP'),
('2026-65008','20454719','E-12-122B',null,'Full retubing','Operation suspected leak in the subject exchanger (from tube to shell side). Accordingly, the OVHD Gas After Cooler was opened and made available for preliminary visual inspection.
Subsequently, both heat exchangers, E-12-122A/B, were offered for preliminary hydrotesting. During water filling, heavy leaks was observed from E-12-122B.
Based on the initial findings, it was decided to test E-12-122A separately to establish the extent of leakage, while full retubing of E-12-122B was recommended due to the following observations:
1. Several tube ends were found detached and/or perforated/completely eroded specially towards the floating head side)
2. Rat holes and sever corrosion in the form of grooving were observed in the tubesheet face adjacent to the gasket face seating area.
Note: This is the first inspection of the subject heat exchangers since their replacement on 14 March 2022 as per contract number CB/CPC/2133.','For Tubesheet repair proceed as follows,:
1. Grind out corroded area & carry out Cupper Sulphate test to confirm no iron pick-up and offer for inspection for further investigationof both tube-sheet for the locations as marked at site.
2. If the grooving did not reach the carbon steel section , Carry out weld buildup at marked locations using ER Ni-cu7 filler wire / GTAW process with minimum preheat temperature of 50°F.
4.If the grooving reach the carbon steel section Carry out weld build up using  filler wire ER Ni-1 /GTAW process with a min. preheat of  175 deg F to build up the CS section and then use ER Ni-cu7 filler wires / GTAW process.
5. Machine weld repaired areas to their original dimensions.
6. Offer for visual & LPT.
Cage repair : (if required)
1. Carry out welding of Tie rods/ Baffles/Runners using ER 316L filler wire / GTAW process with minimum preheat of 50°F.
2. Flush the tack welds and smoothen the edges to avoid scoring the shell during insertion of bundle, followed by LPT.
For full retubing  proceed as follows,
After inspection clearance of tubesheet, proceed with tubes inserting with newly procured tubes as following:
1. Offer all new tubes for PMI.
2. Insert new tubes into tube sheets in kind using Bimetallic tube material (Refer to construction  drawing # 12-230-014-E-12-122 A/B-SK-006).
3. After inserting the tubes, carry out expansion of tubes as per construction  drawing # 12-230-014-E-12-122 A/B-SK-006).
4. Offer the tube bundle assembly for shell & tube sides Hydrotest at 173 psig & 225 psig respectively at the time of installation.
Note:
1. This IAT is applicable for E-12-122B tube bundle Additional IAT might be issued for E-12-122A after inspection.
2. Separate IAT  for components will be issued if required after cleaning and NDT activities.
3. Separate IAT will be issued for painting (as required)
MG/UBM
File: E-12-122B',null,null,'{"lpt": "REQ"}'::jsonb,'{"wo": "20456654", "ref": "2026-65101"}'::jsonb,'WS/MS','In progress','Retubing IP
TSH Repair IP'),
('2026-65024','20454906','12-LT-0531',null,'Miscellaneous Job Request','During U-12 Oct''26 Tr-2 SD, miscellaneous job request was received from Inst. Maintenance Division for the weld repair and replacement of parts on LT-12-0531 chamber drain line and LT-12-0540 drain line.
PMI was done and the following was found:
LT-12-0531:
Chamber drain Line: SS347
Nipple and drain valves: SS347
LT-12-0540:
Drain line valve: 5Cr-0.5Mo
Valve: Carbon Steel','1- For welding of SS347, use ER-347 filler wire with GTAW process.
For welding of Carbon Steel, use ER 70S-2 Filler wire with GTAW process.
If welding is required on the 5CR-0.5 Mo material, use  ER 80S-B6 filler wire/GTAW process with a minimum preheat temperature of 350°F.
2- If any welding carried out on 5Cr-0.5Mo material, perform the following PWHT:
- Rate of Heating - 300 °F/hr
- Soaking temperature & time - 1350°F for 2 hrs.
- Cooling rate - 250 °F/hr,
3- Machine/rethread to required dimensions
4- Offer for LPT.
MG/AMM
File:- 12.07',null,null,'{"lpt": "REQ", "pwht": "REQ"}'::jsonb,'{}'::jsonb,'Inst./MM/WS','In progress','Dropped to ins.
To be sent to Welding'),
('2026-65033','20455417','R-12-101',null,'Collector Ring Repair','The subject reactor is not due for inspection however Process engg requested an IAT to weld repair the collector ring. Collector ring was inspected by process engg at workshop.
Note:
1- This IAT is applicable for all reactors (R-12-101/102/103/104)
2- Damaged locations shall be marked by process engr.','Collector Rings Repair:
1. Carry out repairs of the damaged areas of the Johnson''s Screen in consultation with Process Engineer.
2. If agreed by the Process Engineer, use minimum possible size overlay patches to cover the damaged locations using 3 mm thick TP 321 SS plate. Offer the new plate for PMI before welding.(if required)
3. Use ER 347 filler wire / GTAW process for welding.
4. Use low current to avoid damages of the nearby areas.
5. Offer for LPT & Visual inspection.
Bubble Cap Repair: (As required)
1. Provide suitable size patch on the bubble cap as required using Tp 347 SS plate. Offer the new plate for PMI before welding.
2. For tack welding use ER 347 filler wire/GTAW process.
3. LP check the repaired locations.
Filter elements repair:(As required)
1. Fix back the broken wires with a tack weld as required.
2. For welding use E-347 electrodes / SMAW process.
3. Offer all new welds for LPT.
MG/UBM
File : R-12-101',null,null,'{"lpt": "REQ"}'::jsonb,'{}'::jsonb,null,'In progress','Collector ring repair COMP
Bubble Cap repair IP'),
('2026-65066','20436502','P-12-203-E-01B',null,'Internal & External Painting of the equipment','Visual inspection of the cooler was carried out after hydroblast cleaning which revealed minor damage to the painting on the water side (ID) surface of channel barrel & channel cover at isolated locations.
Moreover, minor paint damages on external surface of channel barrel, channel cover and end cover were observed at isolated locations.
The cooler shall be re-painted after completion of all mechanical repairs, if any, as per following recommendations:','Internal Painting (channel barrel & channel cover):
1) Clean surface of paint damaged locations mechanically up to St-3.
2) Apply three coats of P-208 amine cured epoxy on the ID surface.
External painting (channel barrel, channel cover and end cover)
1) Clean paint damaged locations by mechanical wire brush to St 3.
2) Apply one coat of P-105 Epoxy Primer.
3) Apply one coat of P-203 High Build Polyamide Epoxy.
4) Apply one coat of P-209 Polyurethane paint of existing color.
Note:  A). DFT and over-coating interval shall be as per manufacturer''s recommendation.
MAS/DAG/RDT
File: P-12-203--E-01B','PAINTING IAT',null,'{}'::jsonb,'{}'::jsonb,null,'Completed','COMP'),
('2026-65067','20436504','P-12-203-E-01A',null,'Internal & External Painting of the equipment','Visual inspection of the cooler was carried out after hydroblast cleaning which revealed minor damage to the painting on the water side (ID) surface of channel barrel & channel cover at isolated locations.
Moreover, minor paint damages on external surface of channel barrel, channel cover and end cover were observed at isolated locations.
The cooler shall be re-painted after completion of all mechanical repairs, if any, as per following recommendations:','Internal Painting (channel barrel & channel cover):
1) Clean surface of paint damaged locations mechanically up to St-3.
2) Apply three coats of P-208 amine cured epoxy on the ID surface.
External painting (channel barrel, channel cover and end cover)
1) Clean paint damaged locations by mechanical wire brush to St 3.
2) Apply one coat of P-105 Epoxy Primer.
3) Apply one coat of P-203 High Build Polyamide Epoxy.
4) Apply one coat of P-209 Polyurethane paint of existing color.
Note:  A). DFT and over-coating interval shall be as per manufacturer''s recommendation.
MAS/DAG/RDT
File: P-12-203--E-01A','PAINTING IAT',null,'{}'::jsonb,'{}'::jsonb,null,'Completed','COMP'),
('2026-65081','20456204','V-12-209',null,'Internal Touch up Painting of the equipment','Visual inspection of the vessel was carried out, and overall internal painting was observed in good condition except at few locations that has been marked at site which shall be painted after completion of all mechanical works as per following procedure:','Internal surface Touch up painting at damaged locations.
1- Clean surface of paint damaged locations mechanically up to St-3.
2- Apply two (2) coats of epoxy phenolic P-220.
NOTE : Paint DFT, overcoat intervals and final curing shall be as per used paint manufacturer datasheets.
MAS/DAG
File # V-12-209','PAINTING IAT',null,'{}'::jsonb,'{}'::jsonb,null,'Completed','COMP'),
('2026-65107','20456679','VT-12-2015','VT-12-2015','operation worklist #2','This is with reference to the received Operation request for U-12 TR-2 SD . requesting to replace defective valves (2no) on LN# VT-12-2015-GR7-2", See attached sketch for exact location.','1. Replace the defective 1/2" dia defective valve in kind using "GR7" line class . Material shall comply to NACE MR-01-75
2. Use ER 70S-2 filler wire/GTAW process for welding.
3. Offer the new welds for LP check.
4. Carryout hardness test. PWHT is required if hardness value exceeds 200 BHN.
5. Hydro test the piping at 2760 psig.',null,null,'{"hardness": "Y", "hydro": "REQ\n2760"}'::jsonb,'{}'::jsonb,null,'To start','OP to release'),
('2026-65106','20456676','VT-12-2011','VT-12-2011','operation worklist #6','This is referenced to the received Operation SD job list for U-12 SD Tr-II - item no.5. Requesting to replace defective valve on Line# VT-12-2011-HRW1-2".
See attached sketch for the exact locations.','1. Replace the 3/4" dia.  defective valves in kind using HRW1 line class material. Material shall comply with NACE MR-01-75. See attached sketch.
2. Offer all new materials for PMI prior to welding.
3. For welding use ER 347 filler wire / GTAW process.
4. Offer the new welds for liquid penetrant examinations.
5. Hydrotest the line at 3720 psig using process water containing chlorides <50ppm.',null,null,'{"hydro": "REQ\n3720"}'::jsonb,'{}'::jsonb,null,'To start','OP to release'),
('2026-65105','20456670','P-12-2048','P-12-2048','operation worklist #5','This is referenced to the received Operation SD job list for U-12 TR-2 SD Item no.5 Requesting to replace the 2No of defective valve on LN P-12-2048-HR2-6", See the attached sketch for the exact location.','1. Replace the defective 1/2" valves (2 NO) in kind using HR2 line class material.
2. For welding use ER 70S 2 filler wire/GTAW process.
3. Offer the new welds for liquid penetrant testing.
4. Carry out hardness test.
5. Hydrotest the line at 3600 psig.',null,null,'{"hardness": "Y", "hydro": "REQ\n3600"}'::jsonb,'{}'::jsonb,null,'In progress','Released'),
('2026-65099','20456669','P-12-2013','P-12-2013','operation worklist #4','This is referenced to the received Operation SD job list for U-12 SD Tr-II sr # 4 requesting to replace 1 No. defective valve at Line# P-12-2013-CD3-12". See attached sketch for the exact location.','1. Replace the defective 1/2" dia valve in kind using "CD3" line class.
2. For welding, use ER 70S-2 filler wire/GTAW process.
3. Offer the new welds for liquid penetrant testing.
4. Hydrotest at 775 psig.',null,null,'{"hydro": "REQ\n775"}'::jsonb,'{}'::jsonb,null,'To start','OP to release'),
('2026-65100','20456664','VT-12-2018','VT-12-2018','operation worklist 1&3','Operation / Mechanical Maintenance requested IAT for replace 1 1/2" and 3/4" dia. defective valve of LT-12-598 and LT-12-597 on the subjected line VT-12-2018-GR1-2". See the attached sketch for the location.','1) Replace the defective 1 1/2 (2no) and 3/4" dia. valves as marked in the attached sketch using in kind "GR1" line class material.
2) Carry out welding using ER 70S-2 filler wires/GTAW process.
3) Offer for LPT & Visual inspection..
4) Carry out hydrotest at 2740 psig.','GR1',null,'{"hydro": "REQ\n2740"}'::jsonb,'{}'::jsonb,null,'To start','Spool to be dropped'),
('2026-65102','20456666','V-12-236',null,'External & Internal coating','During inspection of subject vessel, paint on internal surfaces found in satisfactory condition except at manway & bottom shell location near vortex breaker.
However, for WFMPI inspection, paint on internal surface at weld joint locations were removed by commercial grit blasting.
Additionally, the external painting of the vessel was removed at isolated locations for carrying out PAUT inspection.
The painting on the vessel ID & OD surface shall be carried out as per following procedure after completion of all mechanical works.','Internal Painting (at the paint removed/damaged locations):
1) Clean the surface by grit blast to Sa 2.5.
2) Apply two coats of phenolic epoxy (P-220) on the cleaned surface.
External Painting:
1) Clean external surfaces at paint damaged locations by mechanical wire brush to St 3.
2) Apply one coat of Epoxy primer (P-105) at the cleaned areas.
3) Apply one coat of High Build Polyamide Epoxy (P-203)
4) Apply one coat of Polyurethane (P-209) of existing color.
Note: Paint DFT, overcoat intervals and final curing time shall be as per used paint manufacture datasheets.
MAS/DAG
File: V-12-236','PAINTING IAT',null,'{}'::jsonb,'{}'::jsonb,null,'In progress','IP'),
('2026-65103','20456671','C-12-201-E-03',null,'Belzona touch up repair & Internal Painting of Equipment','Visual inspection of the gland condenser components and tube bundle was carried out which revealed existing belzona coating on the tube sheets & painting on the ID surface of the channel barrel found damaged at isolated locations.
which shall be painted after completion of all mechanical works as per following procedure:','A) Tube Sheets (belzona touch-up repair):
1. Clean the damaged Belzona locations on the Tubesheets by wire brush to St-
2. apply one coat of belzona, P-214 Epoxy filler may be applied at damaged locations to match the thickness of existing coating.
B) Channel barrel  ID side painting
1. Grit blast clean the surface to SA 2.5
2. Apply two coats of phenolic epoxy (P-220)
NOTE : Paint DFT, overcoat intervals and final curing shall be as per used paint manufacturer datasheets.
MAS/DAG
File: C-12-201--E-03','PAINTING IAT',null,'{}'::jsonb,'{}'::jsonb,null,'In progress','CHANNEL TO START
TSH. IP'),
('2026-65104','20456685','P-12-2057-HRW1','P-12-2057','RTJ Crack Repair','During LP check of the RTJ grooves of the subject piping, A crack was noticed on RTJ groove on the location marked on the attached sketch. (RTJ-59)','1. Remove the cracks in the RTJ groove of flanges/spacers by machining and confirm by liquid penetrant testing.
2. Weld build up using ER 347 filler wire/GTAW process.
3. Machine to original dimensions.
4. Carryout liquid penetrant testing.
Note: LP check of RTJ grooves in the subject line is still in progress. Further cracks (if found) will be repaired as per the same repair procedure.
MG/AMM
File: 12.3',null,null,'{"lpt": "REQ"}'::jsonb,'{}'::jsonb,null,'To start',null),
('2026-65110','20457293','E-12-122A',null,'Partial retubing and tubsheet repair','In continuation of IAT 2026-65008 issued for E-12-122B, and based on the initial findings, it was decided to test heat exchanger E-12-122A separately to establish the extent of leakage. No leakage was observed during the hydrotest. However, the following observations were noted during the subsequent visual inspection:
Tube Damage: A total of 16 tube ends were found detached, perforated, and/or completely eroded, particularly in the peripheral area toward the floating head side.
Tubesheet Corrosion: Severe corrosion in the form of grooving was observed on the tubesheet face, adjacent to the gasket seating area.
Shell cover: One pin hole was observed in the gasket seating area.
Note: This is the first inspection of the subject heat exchangers since their replacement on 14 March 2022, under Contract No. CB/CPC/2133.','For Tubesheet and Shell cover repair proceed as follows,:
1. Grind out corroded area & carry out Cupper Sulphate test to confirm no iron pick-up and offer for inspection for further investigationof both tube-sheet for the locations as marked at site.
2. If the grooving did not reach the carbon steel section , Carry out weld buildup at marked locations using ER Ni-cu7 filler wire / GTAW process with minimum preheat temperature of 50°F.
4.If the grooving reach the carbon steel section Carry out weld build up using  filler wire ER Ni-1 /GTAW process with a min. preheat of  175 deg F to build up the CS section and then use ER Ni-cu7 filler wires / GTAW process.
5. Machine weld repaired areas to their original dimensions.
6. Offer for visual & LPT.
For partial retubing proceed as follows (16 nos for tubes are marked at site)
1. Offer16 new tubes for PMI.
2. Insert new tubes into tube sheets in kind using Bimetallic tube material (Refer to construction  drawing # 12-230-014-E-12-122 A/B-SK-006).
3. After inserting the tubes, carry out expansion of tubes as per construction  drawing # 12-230-014-E-12-122 A/B-SK-006).
4. Offer both the tube bundle assembly for shell & tube sides Hydrotest at 260.4 psig & 260.4 psig respectively at the time of installation.
5. Separate IAT will be issued for painting (as required)
MG/UBM
File: E-12-122B',null,null,'{"lpt": "REQ"}'::jsonb,'{}'::jsonb,null,'To start',null),
('2026-65124','20502261','H-12-202',null,'refractory repair','The subject Eq. was not due for inspection. However, Operation requested for minor refractory repair on the floor and on the walls.','General Refractory Repairs:
1. Remove the loose refractory on the radiant, convection walls and also in the cone section of the stack as mentioned above .
2. Fill the gaps/cracks in the wall refractory using " KAO-WOOL" and cover with castable " KAST-O-LITE-30GR " refractory layer.
3. Repair the damaged refractory on the peep holes including covers. In case any damaged layers on the  explosion door shall be replaced in kind with fiber boards(Lumus Dwg # NASBA-20131/2024). Refractory damages at the tube support of seal plates shall be suitably repaired & covered with kao wool.
4. Replace the damaged refractory blanket on the man ways covers with kao wool.
5. Wide gaps found in the expansion joints of roof section of the radinat fire box shall be filled with kao wool.
6. Replace the damaged refractory at the anchor support locations in kind.
7. Remove the loose refractory on the burner floor after completion all the repairs.
8. Refix the loose fire bricks on the burner floor as required.
MG/AMQ','REFRACTORY REPAIR',null,'{}'::jsonb,'{}'::jsonb,null,'To start',null),
('2026-65125','20500401','H-12-201',null,'refractory repair','The subject Eq. was not due for inspection. However, Operation requested for minor refractory repair on the floor and on the walls.','1. Remove the loose refractory on the vertical walls of the radiation fire box up to a height of approx. 2 meters, fill the gaps/cracks in addition to the expansion joints in the wall refractory using "KAO-WOOL" and cover with castable "KAST-O-LITE-30GR" refractory layer.
2. Re-fix the loose fire bricks on the burner floor near the radiant coils.
3. Suitably repair the castable refractory near the peep hole doors and peep hole covers.
4. Remove loose/fallen refractory on the burner floor after completion of all repairs.
Note: General Works shall be consulted if further repair is required.
MG/AMQ','REFRACTORY REPAIR',null,'{}'::jsonb,'{}'::jsonb,null,'To start',null),
('2026-65155','20505638','12-LT-0554',null,'Miscellaneous Inspection Request','This IAT is issued as per the Miscellaneous Inspection Job Request Form received from instrument division for repair of 12-LT-554 LT chamber drain line connection. Positive Material Identification (PMI) was conductedmaterial is identifiedas Carbon steel. (Refer attachment for more details).','1) For welding use filler wire ER 70S-2 / GTAW process.
2) Offer for LPT.
3) carry out hydrotest test at shop as per data sheet.
MG/UBM
File :12-LT-0554',null,null,'{"lpt": "REQ", "hydro": "REQ"}'::jsonb,'{}'::jsonb,null,'To start',null),
('2026-65154','20509226','H-12-201','WP-12-2017','Cut and Re-weld','IAT# 2022-19516 was issued On May-09-2022 where Operation reported that, 3'''' dia. RTJ flange was found damaged at the grooving area as highlighted on the attached sketch in the previous IAT. Repair was not possible at that time and furmanite clamp was installed. Now to facilitate executing the IAT the flange needs to be removed and sent to workshop to attend the repair.','1) Cut and re-weld the damaged RTJ flange to asses with repairing the RTJ groove as marked in the previous IAT.
2) For welding use ER 70S-2 filler wire/GTAW process with min. preheat 50°F.
3) Offer new welds for LPT.
4) Hydro test the line at 4099 psig.
MG/AMQ',null,null,'{"lpt": "REQ", "hydro": "REQ"}'::jsonb,'{}'::jsonb,null,'To start',null),
('2026-65152','20509178','E-12-211',null,'Tubsheet repair and 1 tube plug','The subject exchanger was offered for full inspection and during visual inspection the following are our observations:','For the tube plug:
1.Plug the 1 no. U-tubes from the two ends (total 2 plugs) using 70/30 Cu/Ni tapered plugs (offer for PMI).
2. Seal weld the plugs using ER NiCrMo13 Filler wire / GTAW process.
3. Carry out LPT for the new seal welds.
4. Offer for shell hydro test at 620 psig.
 Tubesheet Repair:
 1. Smooth grind the defected area until reaching sound metal.
2.Offer for Acid test (Copper Sulphate test) to confirm the metallurgy at the grinded surface.
* If the test:
a.Revealed iron indication:
- weld build up using one layer of E Ni-1 electrode, and E CuNi for the subsequent layers /SMAW. Refer to OEM drawing for exact dimension.
- Offer newly welded areas for final acid test to make sure no iron exists at the surface of the tube sheet. If iron still exists repeat the same procedure.
b.NO iron indication observed, then, weld build up using E CuNi electrode / SMAW process.
4. Machine repaired locations to original dimensions.
5. Offer for LPT.
MG/AMQ.
File E-12-211',null,null,'{"lpt": "REQ", "hydro": "REQ"}'::jsonb,'{}'::jsonb,null,'To start',null),
('2026-65150','20457286','E-12-211',null,'External & internal Coating for the exchanger','The subject cooler shell & component were inspected after hydroblast cleaning and following observations were made:
1. Tube Bundle: The existing Belzona coating on the tube-sheet face was removed by grit blasting to assess the condition of the tubes. Of the 14 SMO 254 tubes (7 U-tubes) installed on a trial basis, only one tube, located at the end position adjacent to the seal weld near the pass-partition gasket seating area, was found to be perforated. The remaining SMO 254 tubes were observed to be in satisfactory condition. At a few locations near the tube ends of the original bimetallic tubes, damage and peeling of the Cu-Ni cladding layer were observed.
2. Channel Barrel: The existing Belzona coating was removed from the channel barrel to assess the underlying surface condition. General surface roughening was observed across the barrel''s internal surface.
3. Channel Cover: The existing Belzona coating was found to be damaged at a few isolated locations.
4.Shell: The external paint coating on the shell was found to be discoloured and deteriorated.
The cooler shall be belzona coated on the sea water side surface and the shell shall be externally pained as per following procedure.','A. Belzona Coating on ID surface (sea water side) of tube sheets, & channel Barrel
1. Grit blast clean the surface to SA 2.5. For tube sheet protect the tube ends during grit blasting and covering them with ceramic caps.
2. Apply Belzona 1311(Ceramic -R metal) on the cleaned surface followed by Belzona 1321.
3. Level the coating with tube ends. Allow to cure the coating. Grind to remove the excess material without damaging the tube-ends.
4. Coating intervals and final curing shall be as per used Belzona product datasheets.
B. Touch-up Belzona Coating on Channel Cover
1. Clean the damaged Belzona locations on the channel cover by wire brush to St-3.
2. Apply P-214 Epoxy Filler and level it with existing Belzona.
C. External surface painting on the shell
1. Clean external surfaces by grit blasting to SA 2.5.
2. Apply one coat of P-101 Inorganic Zinc Silicate.
3. Apply one coat of High Build Polyamide Epoxy (P-203)
4. Apply one coat of Polyurethane (P-209) of existing color.
Notes:
1. Curing time and DFT of painting shall be as per used manufacturer’s datasheets.
2. Belzona coating at the tube sheet location shall only be applied after successful completion of shell side hydrotest, in case of retubing, to check for any potential rolled joint leak.
3. Apply thin layer of belzona 1321 coating on ID surface of tubes up to 1" from tube ends to mitigate future corrosion.
MAS/DAG
File : E-12-211','PAINTING IAT',null,'{}'::jsonb,'{}'::jsonb,null,'To start',null),
('2026-65147','20494924','V-12-212',null,'Internal Touch up Painting of the equipment.','Visual inspection of the vessel was carried out after hydroblast cleaning and paint damages at various locations on Vessel ID surface, at nozzles, dishends & demister supporting beams. The locations are marked at site.
The painting on the vessel ID surface shall be carried out as per following procedure after completion of all mechanical works.','Internal surface Touch up painting at damaged locations.
1- Clean surface of paint damaged locations mechanically up to St-3.
2- Apply two (2) coats of epoxy phenolic P-220.
NOTE: Paint DFT, overcoat intervals and final curing shall be as per used paint manufacturer datasheets.
MAS/DAG/RDT
File # V-12-209','PAINTING IAT',null,'{}'::jsonb,'{}'::jsonb,null,'In progress',null),
('2026-65142','20506630','E-12-122A',null,'Channel barrel repair','In continuation of IAT 2026-65008 issued for E-12-122A the following observations were noted during the subsequent NDT and visual inspection:
Channel Barrel for E-12-122A: It was observed that the fillet weld joint on the partition plate was detached and re-welding is required. Complete removal of the existing weld and re-welding are required. Additionally, corrosion was observed on the channel barrel base metal adjacent to the fillet weld.','For Channel Barrel base repair proceed as follows,:
1. Grind out corroded area & carry out Cupper Sulphate test to confirm no iron pick-up
2. If the grooving did not reach the carbon steel section , Carry out weld buildup at marked locations using ER Ni-cu7 filler wire / GTAW process with minimum preheat temperature of 50°F.
 3.If the grooving reach the carbon steel section Carry out weld build up using  filler wire ER Ni-1 /GTAW process with a min. preheat of  175 deg F to build up the CS section and then use ER Ni-cu7 filler wires / GTAW process.
4. Machine weld repaired areas to their original dimensions.
5. Offer for visual & LPT.
 For Channel Barrel Partition weld and plate end repair proceed as follows,:
1. Grind out corroded area as marked at site for both fillet weld and plate end
2. Carry out weld buildup at marked locations using ER Ni-cu7 filler wire / GTAW process with minimum preheat temperature of 50°F.
3. Machine weld repaired areas to their original dimensions.
4. Offer for LPT.
MG/AMQ',null,null,'{"lpt": "REQ"}'::jsonb,'{"wo": "20457380", "ref": "2026-65149"}'::jsonb,null,'To start',null),
('2026-65134','20502543','E-12-122B',null,'Channel barrel and cover repair','In continuation of IAT 2026-65008 issued for E-12-122B the following observations were noted during the subsequent NDT and visual inspection:
 Channel cover for E-12-122B : Grooving adjacent to the gasket seating area were observed.
It was observed that the fillet weld joint on the partition plate was detached. Complete removal of the existing weld and re-welding are required. Additionally, corrosion was observed on the channel barrel base metal adjacent to the fillet weld.','For Channel Barrel base & Cover repair proceed as follows,:
1. Grind out corroded area & carry out Cupper Sulphate test to confirm no iron pick-up
2. If the grooving did not reach the carbon steel section , Carry out weld buildup at marked locations using ER Ni-cu7 filler wire / GTAW process with minimum preheat temperature of 50°F.
 3.If the grooving reach the carbon steel section Carry out weld build up using  filler wire ER Ni-1 /GTAW process with a min. preheat of  175 deg F to build up the CS section and then use ER Ni-cu7 filler wires / GTAW process.
4. Machine weld repaired areas to their original dimensions.
5. Offer for visual & LPT.
 For Channel Barrel Partition weld and plate end repair proceed as follows,:
1. Grind out corroded area as marked at site for both fillet weld and plate end
2. Carry out weld buildup at marked locations using ER Ni-cu7 filler wire / GTAW process with minimum preheat temperature of 50°F.
5. Machine weld repaired areas to their original dimensions.
6. Offer for LPT.
MG/AMQ',null,null,'{"lpt": "REQ"}'::jsonb,'{"wo": "20509186", "ref": "2026-65151"}'::jsonb,null,'To start',null),
('2026-65167','20511280','E-12-122B',null,'Stationary Tubesheet repair (Rear Side)','In continuation to the previous IAT for full retubing, it was advised to offer the tubesheets for visual inspection and the following are our observations on the stationary tubesheet:
- Corrosion was found on the pass partition slot on the rear side
- Corrosion was found on the outer peripheral on the copper nickel section
- Corrosion was found on the CS section (width area of the tubesheet)','For Tubesheet repair proceed as follows,:
1. Grind out corroded area & carry out Cupper Sulphate test to confirm no iron pick-up and offer for inspection for further investigationof both tube-sheet for the locations as marked at site.
2. If the grooving did not reach the carbon steel section , Carry out weld buildup at marked locations using ER Ni-cu7 filler wire / GTAW process with minimum preheat temperature of 50°F.
4.If the grooving reach the carbon steel section Carry out weld build up using  filler wire ER Ni-1 /GTAW process with a min. preheat of  175 deg F to build up the CS section and then use ER Ni-cu7 filler wires / GTAW process.
5. For CS-CS section weld using ER 70S-2 fillerwire / GTAW process
6. Machine weld repaired areas to their original dimensions.
7. Offer for visual & LPT.
MG/AMQ',null,null,'{"lpt": "REQ"}'::jsonb,'{}'::jsonb,null,'New IAT',null))
insert into public.trk_iat (tracker_id, iat_no, wo, tag, line, job_text, discipline, issued_at, status, closed_at, finding, recommendation, line_class, material, checks, painting, action_by, sheet_status, remark)
select '406998dc-a9ce-47ca-9a4f-fe74845b4b6a', s.iat_no, s.wo, s.tag, s.line, s.job_text, 'INSP', now(),
  case when s.sheet_status in ('Completed','Cancelled') then 'closed' else 'open' end,
  case when s.sheet_status in ('Completed','Cancelled') then now() end,
  s.finding, s.recommendation, s.line_class, s.material, s.checks, s.painting, s.action_by, s.sheet_status, s.remark
from s
on conflict (tracker_id, iat_no) do update set
  wo = excluded.wo, line = coalesce(excluded.line, trk_iat.line), job_text = excluded.job_text, finding = excluded.finding,
  recommendation = excluded.recommendation, line_class = coalesce(excluded.line_class, trk_iat.line_class), material = coalesce(excluded.material, trk_iat.material),
  checks = excluded.checks, painting = excluded.painting, action_by = excluded.action_by,
  sheet_status = excluded.sheet_status, status = excluded.status,
  closed_at = case when excluded.status = 'closed' then coalesce(trk_iat.closed_at, now()) end,
  remark = coalesce(excluded.remark, trk_iat.remark);
