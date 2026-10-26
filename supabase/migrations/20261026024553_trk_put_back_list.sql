-- Put back list (owner, 26 Oct 2026): small parts taken out during the shutdown (orifices, NRVs, control valves, PSVs)
-- followed removed -> serviced -> installed, so none is missed at startup. Not equipment, not in the M&I progress.
create table if not exists public.trk_return_item (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  tag text not null,
  kind text not null default 'other' check (kind in ('control_valve', 'orifice', 'nrv', 'psv', 'other')),
  what text,
  status text not null default 'removed' check (status in ('removed', 'serviced', 'installed')),
  removed_at timestamptz, serviced_at timestamptz, installed_at timestamptz,
  source text, remark text,
  archived boolean not null default false,
  by_name text, updated_by_name text, updated_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists trk_return_item_tracker on public.trk_return_item (tracker_id);
alter table public.trk_return_item enable row level security;
create policy trk_return_item_read on public.trk_return_item for select
  using (((select public.app_current_role()) is not null) or (tracker_id = (select public.trk_access_tracker())));
create policy trk_return_item_insert on public.trk_return_item for insert
  with check (coalesce((select public.app_current_role()) = any (array['section_head', 'manpower_coordinator', 'engineer', 'controller']), false));
create policy trk_return_item_update on public.trk_return_item for update
  using (coalesce((select public.app_current_role()) = any (array['section_head', 'manpower_coordinator', 'engineer', 'controller']), false))
  with check (coalesce((select public.app_current_role()) = any (array['section_head', 'manpower_coordinator', 'engineer', 'controller']), false));
grant select, insert, update on public.trk_return_item to authenticated;

-- who and when, and every change in the tracker's change log (kind 'return')
create or replace function public.trk_return_item_stamp() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    new.by_name := coalesce(public.trk_who(), new.by_name);
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'return', new.tag, 'put back', null, new.status, auth.uid(), coalesce(public.trk_who(), new.by_name));
  else
    new.updated_at := now(); new.updated_by_name := coalesce(public.trk_who(), new.updated_by_name);
    if new.status is distinct from old.status then
      if new.status = 'serviced' and new.serviced_at is null then new.serviced_at := now(); end if;
      if new.status = 'installed' and new.installed_at is null then new.installed_at := now(); end if;
      if new.status = 'removed' then new.serviced_at := null; new.installed_at := null; end if;
      if new.status = 'serviced' then new.installed_at := null; end if;
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
      values (new.tracker_id, 'return', new.tag, 'status', old.status, new.status, auth.uid(), new.updated_by_name);
    end if;
    if new.archived is distinct from old.archived then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
      values (new.tracker_id, 'return', new.tag, case when new.archived then 'removed from list' else 'back on list' end, null, null, auth.uid(), new.updated_by_name);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.trk_return_item_stamp() from public, anon;
create trigger trk_return_item_stamp before insert or update on public.trk_return_item
  for each row execute function public.trk_return_item_stamp();

-- the parts named in the plant report of 25 Oct 19:00 that are not tracked items (tags as written in the report)
insert into public.trk_return_item (tracker_id, tag, kind, what, status, removed_at, serviced_at, source, by_name)
select '406998dc-a9ce-47ca-9a4f-fe74845b4b6a', v.tag, v.kind, v.what, v.status, '2026-10-25 16:00:00+00',
       case when v.status = 'serviced' then '2026-10-25 16:00:00+00'::timestamptz end, 'Report 25/10 19:00', 'Section Head'
from (values
  ('LV-553A', 'control_valve', 'Control valve dropped', 'removed'),
  ('LV-553C', 'control_valve', 'Control valve dropped', 'removed'),
  ('FE-534', 'orifice', 'Flow element (orifice) removed', 'removed'),
  ('FE-508', 'orifice', 'Flow element (orifice) removed', 'removed'),
  ('FE-536', 'orifice', 'Flow element (orifice) removed', 'removed'),
  ('FE-553A', 'orifice', 'Flow element (orifice) removed', 'removed'),
  ('FE-553B', 'orifice', 'Flow element (orifice) removed', 'removed'),
  ('FE-553C', 'orifice', 'Flow element (orifice) removed', 'removed'),
  ('FE-553D', 'orifice', 'Flow element (orifice) removed', 'removed'),
  ('XV-542 NRV', 'nrv', 'NRV servicing done', 'serviced'),
  ('FV-548 NRV', 'nrv', 'NRV hydrotest preparation I/P', 'removed'),
  ('FV-1426 NRV', 'nrv', 'NRV hydrotest preparation I/P', 'removed'),
  ('FV-003B', 'other', 'Hydrotest pending (PMR)', 'removed')
) as v(tag, kind, what, status)
where not exists (select 1 from public.trk_return_item r where r.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and r.tag = v.tag);
