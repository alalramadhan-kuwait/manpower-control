-- Controller leave rules: the Section Head's approvals for exceptions.
-- Rules (checked by the app, src/core/controllers/leaveRules.ts; leave itself is never blocked, imports still load):
--   overlap:     two Controllers (crew and VR) on leave on the same day;
--   extra_leave: a Controller's 5th or later annual leave in a year.
-- An approval names the leave record(s) it covers, so new dates (a new record) need a new approval.
-- Staff read; only the Section Head approves or withdraws; withdrawn, never deleted; audited.

create table public.controller_leave_approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('overlap', 'extra_leave')),
  leave_a uuid not null references public.leave_records (id),
  leave_b uuid references public.leave_records (id),
  note text,
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  withdraw_reason text,
  approved_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint cla_pair check ((kind = 'overlap') = (leave_b is not null) and leave_a is distinct from leave_b),
  constraint cla_withdraw_reason check (status = 'active' or nullif(trim(withdraw_reason), '') is not null)
);
comment on table public.controller_leave_approvals is
  'Section Head approvals for Controller leave exceptions: two Controllers on leave together (overlap), or a 5th+ leave in a year (extra_leave).';

-- one active approval per pair (order-free) / per leave
create unique index cla_one_active on public.controller_leave_approvals
  (kind, least(leave_a, coalesce(leave_b, leave_a)), greatest(leave_a, coalesce(leave_b, leave_a))) where status = 'active';

alter table public.controller_leave_approvals enable row level security;
create policy cla_staff_read on public.controller_leave_approvals for select using (public.app_is_staff());
create policy cla_head_insert on public.controller_leave_approvals for insert with check (public.app_is_section_head() and status = 'active');
create policy cla_head_update on public.controller_leave_approvals for update using (public.app_is_section_head()) with check (public.app_is_section_head());

create trigger controller_leave_approvals_audit after insert or update or delete on public.controller_leave_approvals
  for each row execute function public.audit_row_change();
