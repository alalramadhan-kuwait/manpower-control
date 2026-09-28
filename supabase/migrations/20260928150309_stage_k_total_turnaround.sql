-- Stage K, part 3: total turnaround (the whole unit down) next to train shutdowns.
-- 1. sd_plans.kind: 'train' (one train down, crews keep running) or 'total' (the whole unit down, everyone on the teams).
-- 2. sd_plans.areas: the area groups of a total turnaround (e.g. TR-II, L.P & TR-I); sd_members.area: a member's group.
-- 3. sd_phases: for a total turnaround, the people needed per team (Controllers, and operators per area) from a first
--    to a last day, e.g. full teams for the first days, fewer after. Removed, not deleted. Staff; audited.
-- 4. operating_modes 'total_shutdown': crew minimums of 0 while the unit is down.

alter table public.sd_plans add column kind text not null default 'train' check (kind in ('train', 'total')),
  add column areas text[] not null default '{}';
alter table public.sd_members add column area text;

create table public.sd_phases (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.sd_plans (id),
  start_date date not null,
  end_date date not null,
  needs jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'removed')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint sd_phase_dates check (end_date >= start_date)
);
comment on column public.sd_phases.needs is 'Per team id: {"controller": n, "areas": {"<area>": n}} — people needed each day of the phase.';
create index sd_phases_plan on public.sd_phases (plan_id) where status = 'active';
alter table public.sd_phases enable row level security;
create policy sd_phases_staff on public.sd_phases for all using (public.app_is_staff()) with check (public.app_is_staff());
revoke delete on public.sd_phases from authenticated, anon;
create trigger sd_phases_audit after insert or update or delete on public.sd_phases for each row execute function public.audit_row_change();

insert into public.operating_modes (code, label, controller_min, panel_min, panel_grade14_min, field_min, sort_order, note)
values ('total_shutdown', 'Total shutdown', 0, 0, 0, 0, 200, 'The whole unit down (turnaround): the crews work on the shutdown teams.')
on conflict (code) do nothing;
