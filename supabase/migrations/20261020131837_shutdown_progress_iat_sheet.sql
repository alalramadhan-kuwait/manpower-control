-- The IAT tracking sheet (inspection) is loaded daily: each IAT keeps its work order, the line it is on, the status as
-- written in the sheet (New IAT, To start, In progress, Hold, Completed, Cancelled) and a remark. tag is the tracker
-- item when the IAT belongs to one (from the operations job list), else the line. One row per IAT number per tracker.
alter table public.trk_iat add column if not exists wo text;
alter table public.trk_iat add column if not exists line text;
alter table public.trk_iat add column if not exists sheet_status text;
alter table public.trk_iat add column if not exists remark text;
create unique index if not exists trk_iat_tracker_no on public.trk_iat (tracker_id, iat_no);
