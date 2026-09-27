-- Stage K: shutdown team planner.
-- 1. employees.fo_level: the Section Head's own grading of a Field Operator for shutdown teams (senior / good / new).
-- 2. sd_plans: one plan per shutdown (optionally linked to its unit event): dates and the working pattern
--    (days on / off, shift hours, reduced first / last days and their hours, normal shift hours, overtime cap per month).
-- 3. sd_teams: the teams of a plan (e.g. Day, Night) with the people needed per slot on full days and on reduced days.
-- 4. sd_members: who fills which slot (controller / senior / good / new), their place in the on/off pattern (day_offset)
--    and dates; a member is off their crew for those dates. Removed, not deleted. One active place per person per plan.
-- Staff read and write; audited. Seeded: the Train-2 SD plan (1–30 Nov 2026) with a Day and a Night team.

alter table public.employees add column fo_level text check (fo_level in ('senior', 'good', 'new'));
comment on column public.employees.fo_level is 'Field Operator level for shutdown teams, set by the Section Head: senior, good or new.';

create table public.sd_plans (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.unit_events (id),
  title text not null,
  start_date date not null,
  end_date date not null,
  days_on int not null default 3 check (days_on between 1 and 30),
  days_off int not null default 1 check (days_off between 0 and 30),
  shift_hours numeric not null default 12 check (shift_hours > 0 and shift_hours <= 24),
  ramp_days int not null default 2 check (ramp_days between 0 and 10),
  ramp_hours numeric not null default 8 check (ramp_hours > 0 and ramp_hours <= 24),
  normal_hours numeric not null default 8 check (normal_hours > 0 and normal_hours <= 24),
  max_overtime numeric not null default 80 check (max_overtime >= 0),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint sd_plan_dates check (end_date >= start_date)
);

create table public.sd_teams (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.sd_plans (id),
  name text not null,
  sort int not null default 0,
  controller_n int not null default 1 check (controller_n >= 0),
  senior_n int not null default 2 check (senior_n >= 0),
  good_n int not null default 2 check (good_n >= 0),
  new_n int not null default 1 check (new_n >= 0),
  ramp_controller_n int not null default 1 check (ramp_controller_n >= 0),
  ramp_senior_n int not null default 1 check (ramp_senior_n >= 0),
  ramp_good_n int not null default 1 check (ramp_good_n >= 0),
  ramp_new_n int not null default 1 check (ramp_new_n >= 0),
  status text not null default 'active' check (status in ('active', 'removed'))
);

create table public.sd_members (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.sd_plans (id),
  team_id uuid not null references public.sd_teams (id),
  employee_id uuid not null references public.employees (id),
  slot text not null check (slot in ('controller', 'senior', 'good', 'new')),
  day_offset int not null default 0 check (day_offset >= 0),
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active', 'removed')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint sd_member_dates check (end_date >= start_date)
);
create unique index sd_members_one_place on public.sd_members (plan_id, employee_id) where status = 'active';
create index sd_members_dates on public.sd_members (start_date, end_date) where status = 'active';

alter table public.sd_plans enable row level security;
alter table public.sd_teams enable row level security;
alter table public.sd_members enable row level security;
create policy sd_plans_staff on public.sd_plans for all using (public.app_is_staff()) with check (public.app_is_staff());
create policy sd_teams_staff on public.sd_teams for all using (public.app_is_staff()) with check (public.app_is_staff());
create policy sd_members_staff on public.sd_members for all using (public.app_is_staff()) with check (public.app_is_staff());
revoke delete on public.sd_plans, public.sd_teams, public.sd_members from authenticated, anon;

create trigger sd_plans_audit after insert or update or delete on public.sd_plans for each row execute function public.audit_row_change();
create trigger sd_teams_audit after insert or update or delete on public.sd_teams for each row execute function public.audit_row_change();
create trigger sd_members_audit after insert or update or delete on public.sd_members for each row execute function public.audit_row_change();

-- seed: the Train-2 shutdown plan with a Day and a Night team
do $$
declare v_plan uuid;
begin
  insert into public.sd_plans (event_id, title, start_date, end_date, note)
  values ((select id from public.unit_events where status = 'active' and category = 'shutdown' and unit = 'Train-2' and start_date = '2026-11-01' limit 1),
          'Train-2 SD', '2026-11-01', '2026-11-30', '3 on / 1 off, 12 h; first and last 2 days reduced, 8 h')
  returning id into v_plan;
  insert into public.sd_teams (plan_id, name, sort) values (v_plan, 'Day', 0), (v_plan, 'Night', 1);
end $$;
