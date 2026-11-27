-- Limit changes from the app (owner, 27 Nov 2026: "can I click and change the limit"; owner chose: Section Head only;
-- target, normal range and IOW standard / critical may change; trip stays locked). Each change keeps the old and new
-- values, who, when and why; the latest change of a limit can be undone (logged as a change too). Nothing is deleted.
create table public.unit_limit_changes (
  id bigint generated always as identity primary key,
  param_id text not null references public.unit_limits (param_id),
  changed_by uuid not null default auth.uid(),
  changed_at timestamptz not null default now(),
  old_values jsonb not null,
  new_values jsonb not null,
  reason text not null check (length(btrim(reason)) between 3 and 400),
  undoes bigint references public.unit_limit_changes (id)
);
comment on table public.unit_limit_changes is 'History of limit changes made in the app: old and new target / normal / IOW values, who, when, why';
create index unit_limit_changes_param_idx on public.unit_limit_changes (param_id, changed_at desc);
alter table public.unit_limit_changes enable row level security;
create policy unit_limit_changes_read on public.unit_limit_changes for select using (public.app_is_staff());
revoke all on public.unit_limit_changes from anon;
revoke insert, update, delete, truncate on public.unit_limit_changes from authenticated;

create or replace function public.unit_limit_values(l public.unit_limits)
returns jsonb language sql immutable as $$
  select jsonb_build_object('target', l.target, 'normal_lo', l.normal_lo, 'normal_hi', l.normal_hi, 'iow_std', l.iow_std, 'iow_crit', l.iow_crit);
$$;
revoke all on function public.unit_limit_values(public.unit_limits) from public, anon;

-- An IOW cell is empty, one number, or a band "a–b" / "a-b" (what the app can judge).
create or replace function public.unit_limit_iow_ok(v text)
returns boolean language sql immutable as $$
  select v is null or btrim(v) ~ '^[0-9]+(\.[0-9]+)?(\s*[–-]\s*[0-9]+(\.[0-9]+)?)?$';
$$;
revoke all on function public.unit_limit_iow_ok(text) from public, anon;

create or replace function public.unit_limit_set(p_param text, p_target text, p_lo numeric, p_hi numeric, p_iow_std text, p_iow_crit text, p_reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare l public.unit_limits; n public.unit_limits; cid bigint;
begin
  if not public.app_is_section_head() then
    raise exception 'Only the Section Head can change a limit.' using errcode = 'insufficient_privilege';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason for the change.'; end if;
  if p_lo is not null and p_hi is not null and p_lo > p_hi then raise exception 'Normal low is above normal high.'; end if;
  if not public.unit_limit_iow_ok(nullif(btrim(p_iow_std), '')) or not public.unit_limit_iow_ok(nullif(btrim(p_iow_crit), '')) then
    raise exception 'IOW must be one number or a band like 15–20.';
  end if;
  select * into l from public.unit_limits where param_id = p_param for update;
  if not found or l.status = 'retired' then raise exception 'No such limit.'; end if;
  update public.unit_limits set target = nullif(btrim(p_target), ''), normal_lo = p_lo, normal_hi = p_hi,
    iow_std = nullif(btrim(p_iow_std), ''), iow_crit = nullif(btrim(p_iow_crit), ''), version = version + 1, updated_at = now()
    where param_id = p_param returning * into n;
  if public.unit_limit_values(n) = public.unit_limit_values(l) then raise exception 'Nothing changed.'; end if;
  insert into public.unit_limit_changes (param_id, old_values, new_values, reason)
    values (p_param, public.unit_limit_values(l), public.unit_limit_values(n), btrim(p_reason)) returning id into cid;
  return cid;
end $$;
revoke all on function public.unit_limit_set(text, text, numeric, numeric, text, text, text) from public, anon;
grant execute on function public.unit_limit_set(text, text, numeric, numeric, text, text, text) to authenticated;

-- Undo the latest change of a limit: its old values come back, and the undo is itself logged.
create or replace function public.unit_limit_undo(p_change bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare c public.unit_limit_changes; latest bigint; l public.unit_limits; n public.unit_limits; cid bigint;
begin
  if not public.app_is_section_head() then
    raise exception 'Only the Section Head can change a limit.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.unit_limit_changes where id = p_change;
  if not found then raise exception 'No such change.'; end if;
  select id into latest from public.unit_limit_changes where param_id = c.param_id order by changed_at desc, id desc limit 1;
  if latest <> c.id then raise exception 'Only the latest change of a limit can be undone.'; end if;
  select * into l from public.unit_limits where param_id = c.param_id for update;
  update public.unit_limits set target = c.old_values->>'target', normal_lo = (c.old_values->>'normal_lo')::numeric, normal_hi = (c.old_values->>'normal_hi')::numeric,
    iow_std = c.old_values->>'iow_std', iow_crit = c.old_values->>'iow_crit', version = version + 1, updated_at = now()
    where param_id = c.param_id returning * into n;
  insert into public.unit_limit_changes (param_id, old_values, new_values, reason, undoes)
    values (c.param_id, public.unit_limit_values(l), public.unit_limit_values(n), 'Undo of change ' || c.id, c.id) returning id into cid;
  return cid;
end $$;
revoke all on function public.unit_limit_undo(bigint) from public, anon;
grant execute on function public.unit_limit_undo(bigint) to authenticated;
