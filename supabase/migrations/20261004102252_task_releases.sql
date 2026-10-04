-- Task release: the Section Head releases one employee from the crew's duty for a time to handle a task. It counts as an
-- absence of the crew for the day (the whole shift, whatever the hours: a conservative check), is not leave, and is audited.
-- Staff read and write; nothing is deleted (cancelled keeps the record).
create table public.task_releases (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  start_date date not null,
  end_date date not null,
  from_time time,
  to_time time,
  task text not null check (length(btrim(task)) > 0),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  cancel_reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint tr_dates check (end_date >= start_date),
  constraint tr_times check ((from_time is null) = (to_time is null))
);
create index task_releases_dates on public.task_releases (start_date, end_date) where status = 'active';
create index task_releases_employee on public.task_releases (employee_id);

alter table public.task_releases enable row level security;
create policy tr_staff_read on public.task_releases for select to authenticated using (public.app_is_staff());
create policy tr_staff_insert on public.task_releases for insert to authenticated with check (public.app_is_staff());
create policy tr_staff_update on public.task_releases for update to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
revoke delete on public.task_releases from authenticated, anon;

create trigger task_releases_audit after insert or update or delete on public.task_releases for each row execute function public.audit_row_change();
