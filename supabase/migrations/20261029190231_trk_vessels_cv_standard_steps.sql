-- Train-2 vessels and CV shells: one step list per group (owner, 29 Oct 2026: group by type and by who asked for
-- the work). Renames only (the P6 text is kept in p6_activity by the rename guard) and the order; nothing recorded
-- is removed, no plan date changes.
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a';
begin
  update public.trk_activities a set activity = m.std from (values
    ('Blinding','Blind'),
    ('Internal Cleaning by HB','Cleaning (HB / HJ)'),('Cleaning by Hydroblast','Cleaning (HB / HJ)'),('Internal cleaning by Hydrojetting','Cleaning (HB / HJ)'),('Hydroblast shell ID','Cleaning (HB / HJ)'),
    ('Possible internal painting of the vessel with phenolic epoxy','Painting if required'),('Under painting','Painting if required'),
    ('Erect Internal Scaffold','Erect scaffold'),('Erect internal scaffold','Erect scaffold'),
    ('Remove Internal Scaffolding','Remove scaffold'),('Remove Internal Scaffold','Remove scaffold'),
    ('Demister Removal (If required)','Demister out'),('Demister Removal','Demister out'),('Demister fixing back','Demister back'),
    ('Buff & clean Weld Joints Internally','Buff weld joints'),('Spot Buff Clean the shell weld joints internally','Buff weld joints'),
    ('Offer NDT/Inspection','Offer for inspection'),('Offer for Inspection','Offer for inspection'),
    ('Possible Welding Repair','Repair if required')) m(old, std)
  where a.tracker_id = t and a.equipment_key ~ '^V-12-2' and a.activity = m.old;

  update public.trk_activities a set seq = r.n from (
    select id, row_number() over (partition by equipment_key order by coalesce(k.rank, 50), coalesce(x.seq, 999), x.activity_id) n
    from public.trk_activities x left join (values
      ('Blind',1),('Open manway',2),('Install ventilation',3),('Cleaning for scaffolding',4),('Erect scaffold',5),('Demister out',6),
      ('Cleaning (HB / HJ)',7),('Comp Suc Drum Inspection And Demister Cleaning',8),('Grit blast shell ID',9),('Buff weld joints',10),
      ('Offer for inspection',11),('Repair if required',12),('Painting if required',13),('PE / OP inspection',14),('Clearance',15),
      ('Demister back',16),('Remove scaffold',17),('Box-up',18),('Deblind',19)) k(name, rank) on k.name = x.activity
    where x.tracker_id = t and x.equipment_key ~ '^V-12-2' and not coalesce(x.detail, false) and coalesce(x.grp, '') <> 'Operations') r
  where a.id = r.id;

  -- CV shells: the typo, and the plan order (remove the shell after blinding; drain before blind)
  update public.trk_activities set activity = 'Shell fixing back' where tracker_id = t and equipment_key ~ '^12-(HV|LV)-' and activity = 'Shell Fixing B ack';
  update public.trk_activities a set seq = r.n from (
    select id, row_number() over (partition by equipment_key order by (not tracked), planned_start nulls last, activity_id) n
    from public.trk_activities where tracker_id = t and equipment_key ~ '^12-(HV|LV)-' and not coalesce(detail, false)) r
  where a.id = r.id;
end $$;
