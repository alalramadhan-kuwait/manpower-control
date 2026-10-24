-- Rotating scope, C-201 compressor (live tracker; the five lines in the Section Head's screenshot). Rows moved, not
-- copied: P6 ids, hours, planned dates, baseline and any times unchanged; each move logged in trk_log.
--   A7430 Comp Suc Drum Inspection And Demister Cleaning  -> V-12-212 (recycle gas compressor K.O. drum, its suction drum
--         in the P&ID line-up; V-12-212 has its own demister / cleaning / inspection lines: possible P6 duplicate, flagged)
--   A6630 Cleaning Compressor Suction Line …, A7630 Compressor Suction Strainer Cleaning -> work item P-12-2085-GR1
--         (C-201 suction line from V-12-212, P&ID 117 line-up, not yet verified on site)
--   A7690 Both Lube Oil Cooler To Be Cleaned -> work item C-12-201-E-01A/B (one P6 line for both coolers; the E-01A /
--         E-01B rows keep their isolation steps)
--   A7700 Both Lube Oil Filter And Drygas Filter To Be Cleaned -> C-12-201-F-03A/B (switched on; the dry-gas filter
--         has no tag in the lists)
-- New and switched-on items are in main groups (Compressor / Filters), so the main-equipment total is unchanged.
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'; c public.trk_equipment; r record;
begin
  select * into c from public.trk_equipment where tracker_id = t and tag = 'C-12-201';
  insert into public.trk_equipment (tracker_id, tag, grp, description, fo, ho_step, procedure, barchart_key, ops_item, critical, tracked, sort, stage, updated_by_name)
  select t, v.tag, 'Compressor', v.descr, c.fo, c.ho_step, c.procedure, v.tag, false, false, true, c.sort, greatest(c.stage, 1), 'system (rotating scope)'
    from (values ('P-12-2085-GR1', 'C-201 suction line from V-12-212 and its suction strainer (P&ID 117 line-up, not yet verified)'),
                 ('C-12-201-E-01A/B', 'C-201 LO coolers A and B (one P6 line for both)')) v(tag, descr)
   where not exists (select 1 from public.trk_equipment x where x.tracker_id = t and x.tag = v.tag);
  update public.trk_equipment set barchart_key = tag, tracked = true, description = 'C-201 lube oil filters, with the dry-gas filter in the same P6 line (A7700)',
         updated_by_name = 'system (rotating scope)'
   where tracker_id = t and tag = 'C-12-201-F-03A/B' and barchart_key is null;
  for r in select * from (values ('A7430', 'V-12-212'), ('A6630', 'P-12-2085-GR1'), ('A7630', 'P-12-2085-GR1'),
                                 ('A7690', 'C-12-201-E-01A/B'), ('A7700', 'C-12-201-F-03A/B')) v(aid, to_key) loop
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_name, reason)
    select t, 'activity', a.equipment_key || ' · ' || a.activity_id, 'item', a.equipment_key, r.to_key, 'system', 'Rotating scope: P6 line moved to its own equipment / work item'
      from public.trk_activities a where a.tracker_id = t and a.activity_id = r.aid and a.equipment_key = 'C-12-201';
    update public.trk_activities set equipment_key = r.to_key where tracker_id = t and activity_id = r.aid and equipment_key = 'C-12-201';
  end loop;
end $$;
