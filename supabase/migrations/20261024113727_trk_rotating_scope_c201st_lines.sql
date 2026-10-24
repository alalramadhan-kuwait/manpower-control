-- Rotating scope, C-201 turbine (live tracker). The P6 bar chart lists five lines under C-12-201-ST that are not
-- turbine overhaul steps. Moved (same rows: P6 ids, hours, planned dates, baseline, times and notes unchanged):
--   A3768 Gland Condenser Cleaning                 -> C-12-201-E-03  (C-201 gland condenser, plant equipment list)
--   A3769 Check The Condition Of Gland Cond. Ejector -> C-12-201-EJ-01 (C-201 ejector, plant equipment list)
--   A3765 insulation, A3771 overspeed system, A6640 governing linkages -> one work item "C-12-201-ST on-site checks"
--   (turbine checks on site, apart from the workshop overhaul; no separate tag exists, none invented).
-- The two existing items are switched on and, like the new one, kept in the Compressor group so the main-equipment
-- total is unchanged. Each move is written to trk_log. A re-import or publish from the template would bring the
-- original P6 mapping back (documented).
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'; st public.trk_equipment; r record;
begin
  select * into st from public.trk_equipment where tracker_id = t and tag = 'C-12-201-ST';
  update public.trk_equipment set barchart_key = tag, tracked = true, grp = 'Compressor', updated_by_name = 'system (rotating scope)'
   where tracker_id = t and tag in ('C-12-201-E-03', 'C-12-201-EJ-01') and barchart_key is null;
  insert into public.trk_equipment (tracker_id, tag, grp, description, fo, ho_step, procedure, barchart_key, ops_item, critical, tracked, sort, stage, updated_by_name)
  select t, 'C-12-201-ST on-site checks', 'Compressor', 'C-201 turbine, on site: insulation, overspeed system, governing linkages (P6 lines of C-12-201-ST)',
         st.fo, st.ho_step, st.procedure, 'C-12-201-ST on-site checks', false, false, true, st.sort, greatest(st.stage, 1), 'system (rotating scope)'
   where not exists (select 1 from public.trk_equipment where tracker_id = t and tag = 'C-12-201-ST on-site checks');
  for r in select * from (values ('A3768', 'C-12-201-E-03'), ('A3769', 'C-12-201-EJ-01'), ('A3765', 'C-12-201-ST on-site checks'),
                                 ('A3771', 'C-12-201-ST on-site checks'), ('A6640', 'C-12-201-ST on-site checks')) v(aid, to_key) loop
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_name, reason)
    select t, 'activity', a.equipment_key || ' · ' || a.activity_id, 'item', a.equipment_key, r.to_key, 'system', 'Rotating scope: P6 line moved to its own equipment / work item'
      from public.trk_activities a where a.tracker_id = t and a.activity_id = r.aid and a.equipment_key = 'C-12-201-ST';
    update public.trk_activities set equipment_key = r.to_key where tracker_id = t and activity_id = r.aid and equipment_key = 'C-12-201-ST';
  end loop;
end $$;
