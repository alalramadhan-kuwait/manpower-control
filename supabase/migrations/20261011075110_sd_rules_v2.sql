-- Shutdown rules v2 (approved 11 Oct 2026). Additive only: the plans made before keep rules_version 1 and are not changed.
-- New plans get rules_version 2: hard overtime limits next to the warning thresholds, Primary / Assistant Controllers,
-- Section Head exceptions, overtime and sick-leave figures typed in from Oracle / HR, the Morning <-> Night rest rule, and an
-- approval that only the server can record (after re-checking the plan) and that any later change clears.

alter table public.sd_plans
  add column rules_version integer not null default 1 check (rules_version in (1, 2)),
  add column max_overtime_hard numeric check (max_overtime_hard is null or max_overtime_hard >= 0),
  add column max_overtime_year_hard numeric check (max_overtime_year_hard is null or max_overtime_year_hard >= 0),
  add column approval_status text not null default 'draft' check (approval_status in ('draft', 'approved')),
  add column approved_by uuid,
  add column approved_at timestamptz,
  add column approval_fingerprint text,
  add column approval_check jsonb;

alter table public.sd_members
  add column controller_role text check (controller_role in ('primary', 'assistant'));

-- Section Head exceptions: two shutdowns in a row (Controllers only), sick leave over 35 days, both rest days of a pair
create table public.sd_exceptions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.sd_plans(id),
  employee_id uuid not null references public.employees(id),
  kind text not null check (kind in ('consecutive_shutdown', 'sick_leave', 'rest_day_pair')),
  reason text not null check (length(btrim(reason)) > 0),
  approved_by uuid default auth.uid(),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz, revoked_by uuid, revoke_reason text
);
create index sd_exceptions_live on public.sd_exceptions (plan_id, employee_id) where revoked_at is null;

-- Overtime already taken, from the Oracle overtime report (year and month to date, as of a date). A new entry never
-- replaces an old one; the latest counts. Missing = unknown, never zero.
create table public.overtime_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  as_of date not null,
  ytd_hours numeric not null check (ytd_hours >= 0),
  mtd_hours numeric not null check (mtd_hours >= 0 and mtd_hours <= ytd_hours),
  source text not null default 'Oracle overtime report',
  note text,
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now(),
  verified_by uuid,
  verified_at timestamptz
);
create index overtime_entries_emp on public.overtime_entries (employee_id, entered_at desc);

-- Sick-leave days in the rolling 12 months, as confirmed from HR on a date (counts only, never a diagnosis)
create table public.sick_checks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  as_of date not null,
  days integer not null check (days >= 0),
  source text not null default 'HR sick-leave report',
  note text,
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now()
);
create index sick_checks_emp on public.sick_checks (employee_id, entered_at desc);

alter table public.sd_exceptions enable row level security;
alter table public.overtime_entries enable row level security;
alter table public.sick_checks enable row level security;
create policy sd_exceptions_read on public.sd_exceptions for select to authenticated using (public.app_is_staff());
create policy overtime_entries_read on public.overtime_entries for select to authenticated using (public.app_is_staff());
create policy sick_checks_read on public.sick_checks for select to authenticated using (public.app_is_staff());
create trigger sd_exceptions_audit after insert or update or delete on public.sd_exceptions for each row execute function public.audit_row_change();
create trigger overtime_entries_audit after insert or update or delete on public.overtime_entries for each row execute function public.audit_row_change();
create trigger sick_checks_audit after insert or update or delete on public.sick_checks for each row execute function public.audit_row_change();

-- 24 h off when changing between Morning and Night duties (either way); the app checks it with the other duty rules
insert into public.validation_rules (code, label, description, severity, enabled, params)
values ('shift_type_change_rest', 'Morning ↔ Night change', 'Changing between a Morning-type duty (M, day duty, shutdown Morning) and a Night-type duty (N, shutdown Night), either way, needs 24 hours off.', 'hard_stop', true, '{"hours": 24}')
on conflict (code) do nothing;

create or replace function public.sd_exception_grant(p_plan uuid, p_employee uuid, p_kind text, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_role text;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head approves an exception.' using errcode = 'insufficient_privilege'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give the reason for the exception.' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.sd_plans where id = p_plan and rules_version = 2) then raise exception 'Exceptions apply to shutdown plans under the v2 rules.' using errcode = 'check_violation'; end if;
  if p_kind = 'consecutive_shutdown' then
    select position_code into v_role from public.employee_directory_v where id = p_employee;
    if coalesce(v_role, '') not in ('controller', 'vr_controller', 'morning_controller') then
      raise exception 'Only a Controller may work two shutdowns in a row.' using errcode = 'check_violation';
    end if;
  end if;
  insert into public.sd_exceptions (plan_id, employee_id, kind, reason) values (p_plan, p_employee, p_kind, btrim(p_reason)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.sd_exception_revoke(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head withdraws an exception.' using errcode = 'insufficient_privilege'; end if;
  update public.sd_exceptions set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = p_id and revoked_at is null;
end $$;

create or replace function public.overtime_entry_save(p_employee uuid, p_as_of date, p_ytd numeric, p_mtd numeric, p_verified boolean, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can enter overtime.' using errcode = 'insufficient_privilege'; end if;
  if p_as_of is null or p_as_of > current_date then raise exception 'The as-of date must be today or earlier.' using errcode = 'check_violation'; end if;
  if p_ytd is null or p_mtd is null or p_ytd < 0 or p_mtd < 0 or p_mtd > p_ytd then raise exception 'Enter the hours: month to date cannot be more than year to date.' using errcode = 'check_violation'; end if;
  insert into public.overtime_entries (employee_id, as_of, ytd_hours, mtd_hours, note, verified_by, verified_at)
  values (p_employee, p_as_of, p_ytd, p_mtd, nullif(btrim(coalesce(p_note, '')), ''), case when p_verified then auth.uid() end, case when p_verified then now() end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.sick_check_save(p_employee uuid, p_as_of date, p_days integer, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can enter sick leave.' using errcode = 'insufficient_privilege'; end if;
  if p_as_of is null or p_as_of > current_date then raise exception 'The as-of date must be today or earlier.' using errcode = 'check_violation'; end if;
  if p_days is null or p_days < 0 or p_days > 366 then raise exception 'Enter the sick-leave days in the last 12 months.' using errcode = 'check_violation'; end if;
  insert into public.sick_checks (employee_id, as_of, days, note) values (p_employee, p_as_of, p_days, nullif(btrim(coalesce(p_note, '')), '')) returning id into v_id;
  return v_id;
end $$;

revoke all on function public.sd_exception_grant(uuid, uuid, text, text), public.sd_exception_revoke(uuid, text),
  public.overtime_entry_save(uuid, date, numeric, numeric, boolean, text), public.sick_check_save(uuid, date, integer, text) from public, anon;
grant execute on function public.sd_exception_grant(uuid, uuid, text, text), public.sd_exception_revoke(uuid, text),
  public.overtime_entry_save(uuid, date, numeric, numeric, boolean, text), public.sick_check_save(uuid, date, integer, text) to authenticated;

-- Approval: only the server (the sd-plan-approve function, with the service key) can record it, after re-checking the plan.
create or replace function public.sd_plans_approval_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.rules_version is distinct from old.rules_version then raise exception 'The rules version of a shutdown plan does not change.' using errcode = 'check_violation'; end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
       (new.approval_status = 'approved' and old.approval_status is distinct from 'approved')
    or (new.approval_status = 'approved' and (new.approval_fingerprint is distinct from old.approval_fingerprint or new.approved_at is distinct from old.approved_at))) then
    raise exception 'A shutdown plan is approved only through the approval check.' using errcode = 'insufficient_privilege';
  end if;
  -- any change to an approved plan's own settings clears the approval (it must be checked again)
  if old.approval_status = 'approved' and new.approval_status = 'approved' and coalesce(auth.role(), '') <> 'service_role' and
     (new.start_date, new.end_date, new.days_on, new.days_off, new.shift_hours, new.ramp_days, new.ramp_hours, new.normal_hours, new.max_overtime, new.max_overtime_year, new.max_overtime_hard, new.max_overtime_year_hard, new.status)
     is distinct from
     (old.start_date, old.end_date, old.days_on, old.days_off, old.shift_hours, old.ramp_days, old.ramp_hours, old.normal_hours, old.max_overtime, old.max_overtime_year, old.max_overtime_hard, old.max_overtime_year_hard, old.status) then
    new.approval_status := 'draft'; new.approved_at := null; new.approved_by := null; new.approval_fingerprint := null;
  end if;
  return new;
end $$;
create trigger sd_plans_approval_guard before update on public.sd_plans for each row execute function public.sd_plans_approval_guard();

-- a change to its teams, people, days or exceptions sends an approved v2 plan back to draft
create or replace function public.sd_plan_unapprove()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_plan uuid; r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_table_name = 'sd_days' then select plan_id into v_plan from public.sd_members where id = r.member_id;
  else v_plan := r.plan_id; end if;
  update public.sd_plans set approval_status = 'draft', approved_at = null, approved_by = null, approval_fingerprint = null
   where id = v_plan and approval_status = 'approved';
  return r;
end $$;
create trigger sd_members_unapprove after insert or update or delete on public.sd_members for each row execute function public.sd_plan_unapprove();
create trigger sd_teams_unapprove after insert or update or delete on public.sd_teams for each row execute function public.sd_plan_unapprove();
create trigger sd_days_unapprove after insert or update or delete on public.sd_days for each row execute function public.sd_plan_unapprove();
create trigger sd_exceptions_unapprove after insert or update or delete on public.sd_exceptions for each row execute function public.sd_plan_unapprove();

-- new overtime or sick-leave figures for someone on an approved plan send it back to draft too
create or replace function public.sd_person_unapprove()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.sd_plans p set approval_status = 'draft', approved_at = null, approved_by = null, approval_fingerprint = null
   where p.approval_status = 'approved' and p.status = 'active'
     and exists (select 1 from public.sd_members m where m.plan_id = p.id and m.status = 'active' and m.employee_id = new.employee_id);
  return new;
end $$;
create trigger overtime_entries_unapprove after insert on public.overtime_entries for each row execute function public.sd_person_unapprove();
create trigger sick_checks_unapprove after insert on public.sick_checks for each row execute function public.sd_person_unapprove();
