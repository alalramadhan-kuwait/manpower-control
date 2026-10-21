-- Rollback of phase 1 (not applied): the new tables and functions, the two added C-201 lines on the test tracker and
-- its new settings keys. The baseline and every other row are untouched by phase 1, so nothing else needs restoring.
drop table if exists public.trk_forecast, public.trk_link, public.trk_update, public.trk_qty_entry, public.trk_qty_estimate, public.trk_qty_scope, public.trk_measure;
drop function if exists public.trk_insert_only(), public.trk_stamp_entry(), public.trk_qty_estimate_apply(), public.trk_qty_scope_guard(), public.trk_qty_entry_log();
delete from public.trk_activities where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and activity_id in ('ADD-C201-1', 'ADD-C201-2');
update public.trk_trackers set settings = settings - array['progressV2', 'fcWindow', 'fcMin', 'staleH', 'miscDays'] where id = '2e9c8262-20e9-4274-bd52-87c156a3a487';
