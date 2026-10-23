-- Problems on an item (Section Head, 23 Oct): an event can name the item it is on, so a problem (high temperature in
-- a bed, a failed gas test …) is recorded apart from the item's short status note and listed under Issues in the
-- report until it is ended.
alter table public.trk_event add column if not exists equipment_key text;
create index if not exists trk_event_item on public.trk_event (tracker_id, equipment_key) where equipment_key is not null;
