-- Equipment scope and the Maintenance follow-up (owner, 13 Nov 2026: "each equipment … its own profile … options to
-- make as sd or non sd item" and "a section to follow up maintenance activities"). A Non-SD item is out of the
-- shutdown's %, forecast and flags, but its open steps stay to follow on the Maintenance tab, with a reason and an
-- optional due date until it is back in service. A day-to-day item (origin 'daily') was never in a shutdown. Notes are
-- kept per item. Only the Section Head changes the scope, due date or back-in-service; every change is logged.
alter table public.trk_equipment
  add column if not exists scope text not null default 'sd',
  add column if not exists nonsd_reason text,
  add column if not exists nonsd_at timestamptz,
  add column if not exists due_date date,
  add column if not exists back_at timestamptz,
  add column if not exists origin text not null default 'sd';
alter table public.trk_equipment add constraint trk_equipment_scope_check check (scope in ('sd', 'non_sd'));
alter table public.trk_equipment add constraint trk_equipment_origin_check check (origin in ('sd', 'daily'));
alter table public.trk_equipment add constraint trk_equipment_nonsd_reason_len check (nonsd_reason is null or length(nonsd_reason) <= 200);
comment on column public.trk_equipment.scope is 'sd = counted in the shutdown; non_sd = followed on the Maintenance tab, out of the shutdown %, forecast and flags';
comment on column public.trk_equipment.origin is 'sd = from the shutdown scope; daily = a day-to-day maintenance job added on the Maintenance tab';

create or replace function public.trk_equipment_scope_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.scope is distinct from old.scope or new.due_date is distinct from old.due_date or new.back_at is distinct from old.back_at)
     and auth.uid() is not null and not public.app_is_section_head() then
    raise exception 'Only the Section Head changes an item''s scope, due date or back in service.' using errcode = 'insufficient_privilege';
  end if;
  if new.scope = 'non_sd' and (tg_op = 'INSERT' or old.scope is distinct from 'non_sd') then new.nonsd_at := coalesce(new.nonsd_at, now()); end if;
  if new.scope = 'sd' then new.nonsd_at := null; new.nonsd_reason := null; new.back_at := null; end if;
  return new;
end $$;
revoke all on function public.trk_equipment_scope_guard() from public, anon;
create trigger trk_equipment_scope_guard before insert or update on public.trk_equipment for each row execute function public.trk_equipment_scope_guard();

create or replace function public.trk_equipment_scope_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.scope is distinct from old.scope then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason)
    values (new.tracker_id, 'equipment', new.tag, 'scope', old.scope, new.scope, auth.uid(), public.trk_who(), new.nonsd_reason);
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'equipment', new.tag, 'due date', old.due_date::text, new.due_date::text, auth.uid(), public.trk_who());
  end if;
  if new.back_at is distinct from old.back_at then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'equipment', new.tag, 'back in service', old.back_at::text, new.back_at::text, auth.uid(), public.trk_who());
  end if;
  return null;
end $$;
revoke all on function public.trk_equipment_scope_log() from public, anon;
create trigger trk_equipment_scope_log after update of scope, due_date, back_at on public.trk_equipment for each row execute function public.trk_equipment_scope_log();

-- notes / updates on an item, newest first on its page
create table if not exists public.trk_item_notes (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers (id),
  equipment_id uuid not null references public.trk_equipment (id),
  body text not null check (length(trim(body)) between 1 and 1000),
  by_user uuid default auth.uid(),
  by_name text,
  created_at timestamptz not null default now(),
  removed boolean not null default false
);
create index if not exists trk_item_notes_eq on public.trk_item_notes (equipment_id, created_at desc);
alter table public.trk_item_notes enable row level security;
revoke all on public.trk_item_notes from anon;
revoke delete, truncate on public.trk_item_notes from authenticated;
create policy trk_item_notes_read on public.trk_item_notes for select to authenticated using ((select public.app_current_role()) is not null or tracker_id = (select public.trk_access_tracker()));
create policy trk_item_notes_add on public.trk_item_notes for insert to authenticated with check (coalesce((select public.app_current_role()) = any (array['section_head', 'manpower_coordinator', 'engineer', 'controller']), false) or tracker_id = (select public.trk_access_tracker()));
create policy trk_item_notes_hide on public.trk_item_notes for update to authenticated using (by_user = auth.uid() or (select public.app_is_section_head())) with check (by_user = auth.uid() or (select public.app_is_section_head()));
create or replace function public.trk_item_note_stamp() returns trigger language plpgsql security definer set search_path = public as $$
begin new.by_name := public.trk_who(); if tg_op = 'INSERT' then new.by_user := auth.uid(); new.created_at := now(); end if; return new; end $$;
revoke all on function public.trk_item_note_stamp() from public, anon;
create trigger trk_item_note_stamp before insert on public.trk_item_notes for each row execute function public.trk_item_note_stamp();
