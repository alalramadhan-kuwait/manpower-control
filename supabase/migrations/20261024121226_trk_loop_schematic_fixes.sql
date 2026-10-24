-- Auto-generated loop schematics: the schematic is built in the app from the loop record, its field procedure, the
-- P&ID line-up and the blind list each time it is opened (so it follows the data). People correct it with small
-- recorded edits applied on top: remove a generated element (with the reason), add a connection or a fill / drain /
-- vent / isolation point (marked verified only with the P&ID sheet it was checked on), or add a note. Edits are never
-- deleted: they are withdrawn with a reason. Read like the tracker; edited by Section Head, Coordinator, Engineer.
create table public.trk_loop_fix (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  point_id uuid not null references public.trk_points(id),
  op text not null check (op in ('remove', 'add_link', 'add_mark', 'note')),
  target text,
  a text, b text, line text,
  kind text check (kind is null or kind in ('fill', 'drain', 'vent', 'isolation', 'blind')),
  text text,
  sheet text,
  reason text,
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  by_user uuid default auth.uid(),
  by_name text default public.trk_who(),
  at timestamptz not null default now(),
  withdrawn_at timestamptz, withdrawn_by_name text, withdrawn_reason text,
  check (op <> 'remove' or (target is not null and length(trim(coalesce(reason, ''))) > 0)),
  check (op <> 'add_link' or (length(trim(coalesce(a, ''))) > 0 and length(trim(coalesce(b, ''))) > 0)),
  check (op <> 'add_mark' or (kind is not null and length(trim(coalesce(text, ''))) > 0)),
  check (op <> 'note' or length(trim(coalesce(text, ''))) > 0)
);
create index trk_loop_fix_tracker on public.trk_loop_fix (tracker_id);
alter table public.trk_loop_fix enable row level security;
create policy trk_loop_fix_read on public.trk_loop_fix for select using (public.trk_can_read(tracker_id));
create policy trk_loop_fix_insert on public.trk_loop_fix for insert with check (
  public.app_is_admin_staff() and status = 'active' and withdrawn_at is null
  and exists (select 1 from public.trk_points p where p.id = point_id and p.tracker_id = trk_loop_fix.tracker_id));
revoke update, delete, truncate on public.trk_loop_fix from anon, authenticated;
grant select on public.trk_loop_fix to anon, authenticated;
grant insert on public.trk_loop_fix to authenticated;

create or replace function public.trk_loop_fix_added() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  new.by_user := auth.uid(); new.by_name := public.trk_who(); new.at := now();
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason)
  values (new.tracker_id, 'schematic', (select p.ref from public.trk_points p where p.id = new.point_id), new.op, new.target,
    concat_ws(' · ', nullif(concat_ws(' → ', new.a, new.b), ''), new.line, new.kind, new.text, 'sheet ' || new.sheet), new.by_user, new.by_name, new.reason);
  return new;
end $$;
create or replace trigger trk_loop_fix_added before insert on public.trk_loop_fix for each row execute function public.trk_loop_fix_added();
revoke execute on function public.trk_loop_fix_added() from public, anon, authenticated;

create or replace function public.trk_loop_fix_withdraw(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare f public.trk_loop_fix; who text := public.trk_who();
begin
  if not public.app_is_admin_staff() then raise exception 'Only the Section Head, a Coordinator or an Engineer can withdraw a correction.' using errcode = 'insufficient_privilege'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Give the reason.' using errcode = 'check_violation'; end if;
  update public.trk_loop_fix set status = 'withdrawn', withdrawn_at = now(), withdrawn_by_name = who, withdrawn_reason = trim(p_reason)
   where id = p_id and status = 'active' returning * into f;
  if not found then raise exception 'This correction is already withdrawn.'; end if;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason)
  values (f.tracker_id, 'schematic', (select p.ref from public.trk_points p where p.id = f.point_id), f.op, coalesce(f.target, concat_ws(' → ', f.a, f.b), f.text), 'withdrawn', auth.uid(), who, trim(p_reason));
end $$;
revoke execute on function public.trk_loop_fix_withdraw(uuid, text) from public, anon;
grant execute on function public.trk_loop_fix_withdraw(uuid, text) to authenticated;
