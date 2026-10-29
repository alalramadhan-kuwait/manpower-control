-- Items a person chose not to follow on a tracker (owner, 29 Oct 2026): for that login only, they are off the
-- no-update list, update requests, progress and the forecast. Everyone else keeps the full tracker. Soft state: off = false follows again.
create table if not exists public.trk_follow_off (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  user_id uuid not null default auth.uid(),
  item_key text not null,
  off boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (tracker_id, user_id, item_key)
);
alter table public.trk_follow_off enable row level security;
create policy trk_follow_off_read on public.trk_follow_off for select to authenticated using (public.app_is_staff() and user_id = auth.uid());
create policy trk_follow_off_insert on public.trk_follow_off for insert to authenticated with check (public.app_is_staff() and user_id = auth.uid());
create policy trk_follow_off_update on public.trk_follow_off for update to authenticated using (public.app_is_staff() and user_id = auth.uid()) with check (public.app_is_staff() and user_id = auth.uid());
revoke all on public.trk_follow_off from anon;
revoke delete, truncate on public.trk_follow_off from authenticated;
comment on table public.trk_follow_off is 'Per-person list of tracker items not followed (off = true): hidden from that person''s no-update list, update requests, progress and forecast only.';

-- the Section Head's choice for Train-2 (29 Oct 2026): follow C-201-ST, V-201, V-213; not the C-201 auxiliaries, the LO pumps and coolers, or the PSVs
insert into public.trk_follow_off (tracker_id, user_id, item_key)
select '406998dc-a9ce-47ca-9a4f-fe74845b4b6a', p.auth_user_id, k
from (select auth_user_id from public.user_profiles where role_code = 'section_head' and is_active and auth_user_id is not null) p
cross join unnest(array['C-12-201-F-03A/B','C-12-201-E-01A/B','P-12-2085-GR1','C-12-201 LO system','C-12-201-EJ-01','C-12-201-TK-03','P-12-207A/B','P-12-203','P-12-203-E-01A','P-12-203-E-01B','P-12-205']
  || (select array_agg(coalesce(barchart_key, tag)) from public.trk_equipment where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and grp = 'PSVs' and covered_by is null)) k
on conflict (tracker_id, user_id, item_key) do update set off = true, updated_at = now();
