-- Stage H: Controller Management. Shift cover (who acts as a crew's Controller) and Morning Controller rotation.
-- Rules live in the database so no screen can bypass them:
--   Grade 15+ Controllers only; at most 2 months per assignment; one person cannot hold two overlapping
--   assignments (a VR cannot cover two shifts at once); one cover per crew per day; one Morning rotation at a time;
--   nobody covers their own crew. History: rows are never deleted; cancelling keeps the row, and every change is
--   written to audit_log by the shared audit trigger.
create extension if not exists btree_gist with schema extensions;

create table public.controller_assignments (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null check (kind in ('shift_cover', 'morning_rotation')),
  employee_id         uuid not null references public.employees(id),
  crew_code           text check (crew_code in ('A', 'B', 'C', 'D')),
  covers_employee_id  uuid references public.employees(id),
  start_date          date not null,
  end_date            date not null,
  status              text not null default 'active' check (status in ('active', 'cancelled')),
  note                text,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  cancelled_by        uuid,
  cancelled_at        timestamptz,
  cancel_reason       text,
  constraint ca_dates check (end_date >= start_date),
  constraint ca_max_two_months check (end_date < (start_date + interval '2 months')::date),
  constraint ca_crew_for_cover check ((kind = 'shift_cover') = (crew_code is not null)),
  constraint ca_one_at_a_time exclude using gist (employee_id with =, daterange(start_date, end_date, '[]') with &&) where (status = 'active'),
  constraint ca_one_cover_per_crew exclude using gist (crew_code with =, daterange(start_date, end_date, '[]') with &&) where (status = 'active' and kind = 'shift_cover'),
  constraint ca_one_morning_rotation exclude using gist (kind with =, daterange(start_date, end_date, '[]') with &&) where (status = 'active' and kind = 'morning_rotation')
);
create index controller_assignments_dates on public.controller_assignments (start_date, end_date) where status = 'active';

create or replace function public.controller_assignment_check()
returns trigger language plpgsql set search_path = public as $$
declare
  v_grade int; v_pos text; v_crew text;
begin
  if tg_op = 'UPDATE' and old.status = 'cancelled' then
    raise exception 'A cancelled assignment is kept as history and cannot be changed.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' or (new.status = 'active' and (new.employee_id, new.kind, new.crew_code) is distinct from (old.employee_id, old.kind, old.crew_code)) then
    select e.grade into v_grade from public.employees e where e.id = new.employee_id;
    select p.code, c.code into v_pos, v_crew
      from public.employee_role_assignments ra
      join public.positions p on p.id = ra.position_id
      left join public.crews c on c.id = ra.home_crew_id
     where ra.employee_id = new.employee_id and ra.effective_to is null
     order by ra.effective_from desc limit 1;
    if v_pos is null or v_pos not in ('controller', 'vr_controller', 'morning_controller') then
      raise exception 'Only a Controller can be assigned.' using errcode = 'check_violation';
    end if;
    if v_grade is null or v_grade < 15 then
      raise exception 'Controller assignments need Grade 15 or higher.' using errcode = 'check_violation';
    end if;
    if new.kind = 'shift_cover' and v_crew = new.crew_code then
      raise exception 'A Controller cannot cover their own crew.' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'cancelled' then
    new.cancelled_at := now(); new.cancelled_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.controller_assignment_check() from public, anon, authenticated;

create trigger controller_assignments_check before insert or update on public.controller_assignments
  for each row execute function public.controller_assignment_check();
create trigger controller_assignments_audit after insert or update or delete on public.controller_assignments
  for each row execute function public.audit_row_change();

alter table public.controller_assignments enable row level security;
create policy ca_staff_read   on public.controller_assignments for select to authenticated using (public.app_is_staff());
create policy ca_staff_insert on public.controller_assignments for insert to authenticated with check (public.app_is_staff());
create policy ca_staff_update on public.controller_assignments for update to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
-- no delete policy: assignments are history
