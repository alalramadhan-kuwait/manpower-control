-- Loop schematic corrections, part 2: a connection's role (active route / bypass / standby / injection) and items with
-- a stated state (a valve closed per the SOP, a standby pump, an unresolved header). Only drawings with these
-- corrections change. Same rules as trk_loop_fix: read like the tracker, added by Section Head / Coordinator / Engineer,
-- withdrawn never deleted, logged.
alter table public.trk_loop_fix add column if not exists role text check (role is null or role in ('active', 'bypass', 'standby', 'injection'));

create table public.trk_loop_node (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  point_id uuid not null references public.trk_points(id),
  tag text not null check (length(trim(tag)) > 0),
  label text,
  state text not null check (state in ('active', 'standby', 'closed', 'open', 'known', 'unresolved')),
  source text not null check (length(trim(source)) > 0),
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  by_user uuid default auth.uid(),
  by_name text default public.trk_who(),
  at timestamptz not null default now(),
  withdrawn_at timestamptz, withdrawn_by_name text, withdrawn_reason text
);
create index trk_loop_node_tracker on public.trk_loop_node (tracker_id);
alter table public.trk_loop_node enable row level security;
create policy trk_loop_node_read on public.trk_loop_node for select using (public.trk_can_read(tracker_id));
create policy trk_loop_node_insert on public.trk_loop_node for insert with check (
  public.app_is_admin_staff() and status = 'active' and withdrawn_at is null
  and exists (select 1 from public.trk_points p where p.id = point_id and p.tracker_id = trk_loop_node.tracker_id));
revoke update, delete, truncate on public.trk_loop_node from anon, authenticated;
grant select on public.trk_loop_node to anon, authenticated;
grant insert on public.trk_loop_node to authenticated;

create or replace function public.trk_loop_node_added() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  new.by_user := auth.uid(); new.by_name := public.trk_who(); new.at := now();
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason)
  values (new.tracker_id, 'schematic', (select p.ref from public.trk_points p where p.id = new.point_id), 'item', null,
    concat_ws(' · ', new.tag, new.label, new.state), new.by_user, new.by_name, new.source);
  return new;
end $$;
create or replace trigger trk_loop_node_added before insert on public.trk_loop_node for each row execute function public.trk_loop_node_added();
revoke execute on function public.trk_loop_node_added() from public, anon, authenticated;

create or replace function public.trk_loop_node_withdraw(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare n public.trk_loop_node; who text := public.trk_who();
begin
  if not public.app_is_admin_staff() then raise exception 'Only the Section Head, a Coordinator or an Engineer can withdraw a correction.' using errcode = 'insufficient_privilege'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Give the reason.' using errcode = 'check_violation'; end if;
  update public.trk_loop_node set status = 'withdrawn', withdrawn_at = now(), withdrawn_by_name = who, withdrawn_reason = trim(p_reason)
   where id = p_id and status = 'active' returning * into n;
  if not found then raise exception 'This correction is already withdrawn.'; end if;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason)
  values (n.tracker_id, 'schematic', (select p.ref from public.trk_points p where p.id = n.point_id), 'item', n.tag, 'withdrawn', auth.uid(), who, trim(p_reason));
end $$;
revoke execute on function public.trk_loop_node_withdraw(uuid, text) from public, anon;
grant execute on function public.trk_loop_node_withdraw(uuid, text) to authenticated;
