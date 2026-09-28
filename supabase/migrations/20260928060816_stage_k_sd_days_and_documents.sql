-- Stage K, part 2: exact day schedules and the two shutdown documents (shift schedule; overtime for approval).
-- 1. sd_days: a member's own day, overriding the plan pattern: works or off, and the hours when not the plan's
--    shift hours (e.g. a reduced 8-hour day). Staff read and write; audited.
-- 2. sd_members.slot: 'member' for a team member without a level (records of past shutdowns, Panel Operators).
-- 3. sd_teams.shift_code (M / N) and shift_hours_label (e.g. 06:00 - 18:00) as printed on the documents.
-- 4. sd_plans.signatures: the approval block of the overtime sheet ([{title, name}], data, edited in the app).
-- (Data, not in this file: Train-1 SD, 26 Dec 2025 - 24 Jan 2026, recorded in the app from its shift schedule.)

create table public.sd_days (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.sd_members (id),
  work_date date not null,
  works boolean not null,
  hours numeric check (hours is null or (hours > 0 and hours <= 24)),
  created_at timestamptz not null default now(),
  unique (member_id, work_date)
);
alter table public.sd_days enable row level security;
create policy sd_days_staff on public.sd_days for all using (public.app_is_staff()) with check (public.app_is_staff());
create trigger sd_days_audit after insert or update or delete on public.sd_days for each row execute function public.audit_row_change();

alter table public.sd_members drop constraint sd_members_slot_check;
alter table public.sd_members add constraint sd_members_slot_check check (slot in ('controller', 'senior', 'good', 'new', 'member'));

alter table public.sd_teams add column shift_code text not null default 'M' check (shift_code in ('M', 'N')),
  add column shift_hours_label text;
update public.sd_teams set shift_code = case when name ilike 'night%' then 'N' else 'M' end,
  shift_hours_label = case when name ilike 'night%' then '18:00 - 06:00' else '06:00 - 18:00' end;

alter table public.sd_plans add column signatures jsonb not null default '[]'::jsonb;
comment on column public.sd_plans.signatures is 'Approval block of the overtime sheet: [{"title": ..., "name": ...}] in order.';
