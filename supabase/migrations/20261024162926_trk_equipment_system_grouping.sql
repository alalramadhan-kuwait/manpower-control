-- Equipment system: a display group for items that belong to one machine (a compressor and its turbine, lube oil,
-- suction, gland condenser ...). Display only: every item keeps its own steps, stage, P6 activities, progress and
-- history; the item's group (used in counts and alerts) is unchanged.
alter table public.trk_equipment add column if not exists system text;
comment on column public.trk_equipment.system is 'Display group: items of one machine shown together (expandable). Not used in progress or counts.';
update public.trk_equipment set system = 'C-12-201 Recycle gas compressor system'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and system is null
   and (tag like 'C-12-201%' or tag = 'P-12-2085-GR1');
