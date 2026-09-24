-- Stage F: leave requests, following the MAB Operations Department leave request form.
-- The Coordinator enters the paper form; the Controller / Supervisor overtime decision is recorded by the
-- Coordinator; the Section Head approves or does not approve. Approval puts the leave in the plan through
-- leave_save (hand-entered, so imports never change it). Nothing is deleted: every step stays on the request.
--
-- 1. New absence type Unpaid Leave (UNPAID).
-- 2. leave_requests: form fields, review, decision, link to the leave record created on approval. Staff can read;
--    all writes go through the functions below (no insert / update / delete policies).
-- 3. request_save (enter or correct while open), request_review, request_decide (Section Head only),
--    request_withdraw. Open = submitted or reviewed; a decided or withdrawn request is locked.

insert into public.absence_types (code, label, short_code, reduces_manpower, requires_approval, is_active, sort_order)
values ('unpaid_leave', 'Unpaid Leave', 'UNPAID', true, true, true, 24);

create table public.leave_requests (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id),
  request_type       text not null check (request_type in ('scheduled', 'unscheduled', 'unpaid')),
  start_date         date not null,
  end_date           date not null,
  reason             text,
  address            text,
  phone              text,
  balance_days       numeric,
  balance_as_of      date,
  form_date          date,
  status             text not null default 'submitted' check (status in ('submitted', 'reviewed', 'approved', 'not_approved', 'withdrawn')),
  overtime_required  boolean,
  review_signed_by   text,
  review_remarks     text,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  decision_remarks   text,
  decided_by         uuid,
  decided_at         timestamptz,
  withdraw_reason    text,
  leave_record_id    uuid references public.leave_records(id),
  entered_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint leave_requests_dates check (end_date >= start_date and end_date - start_date <= 365)
);
comment on table public.leave_requests is 'Leave requests from the MAB Operations leave request form (Scheduled / Unscheduled / Unpaid). Written only through request_* functions.';
comment on column public.leave_requests.form_date is 'Date the employee signed the paper form.';
comment on column public.leave_requests.review_signed_by is 'Who signed the Shift Controller / Shift Supervisor part of the paper form.';
create index leave_requests_open on public.leave_requests (status, start_date);
create index leave_requests_employee on public.leave_requests (employee_id, start_date);

create trigger leave_requests_audit after insert or update or delete on public.leave_requests
  for each row execute function public.audit_row_change();
alter table public.leave_requests enable row level security;
create policy leave_requests_staff_read on public.leave_requests for select to authenticated using (public.app_is_staff());

create or replace function public.request_type_code(p_type text)
returns text language sql immutable set search_path = public as $$
  select case p_type when 'scheduled' then 'annual_leave_planned' when 'unscheduled' then 'annual_leave_unscheduled' when 'unpaid' then 'unpaid_leave' end
$$;

create or replace function public.request_save(p_id uuid, p_employee uuid, p_type text, p_start date, p_end date, p_reason text,
  p_address text, p_phone text, p_balance numeric, p_balance_as_of date, p_form_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can enter leave requests.' using errcode = 'insufficient_privilege'; end if;
  if p_type not in ('scheduled', 'unscheduled', 'unpaid') then raise exception 'Choose Scheduled, Unscheduled or Unpaid.' using errcode = 'check_violation'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation'; end if;
  if p_end - p_start > 365 then raise exception 'One request can cover at most a year.' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.employees where id = p_employee and is_active) then raise exception 'Choose an active employee.' using errcode = 'check_violation'; end if;
  if p_id is null then
    insert into public.leave_requests (employee_id, request_type, start_date, end_date, reason, address, phone, balance_days, balance_as_of, form_date)
    values (p_employee, p_type, p_start, p_end, nullif(trim(p_reason), ''), nullif(trim(p_address), ''), nullif(trim(p_phone), ''), p_balance, p_balance_as_of, p_form_date)
    returning id into v_id;
    return v_id;
  end if;
  select status into v_status from public.leave_requests where id = p_id for update;
  if v_status is null then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if v_status not in ('submitted', 'reviewed') then raise exception 'This request is closed (%) and can no longer be changed.', v_status using errcode = 'check_violation'; end if;
  update public.leave_requests set employee_id = p_employee, request_type = p_type, start_date = p_start, end_date = p_end,
    reason = nullif(trim(p_reason), ''), address = nullif(trim(p_address), ''), phone = nullif(trim(p_phone), ''),
    balance_days = p_balance, balance_as_of = p_balance_as_of, form_date = p_form_date, updated_at = now()
  where id = p_id;
  return p_id;
end $$;

create or replace function public.request_review(p_id uuid, p_overtime boolean, p_signed_by text, p_remarks text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can record the review.' using errcode = 'insufficient_privilege'; end if;
  if p_overtime is null then raise exception 'Choose Overtime required or Overtime not required.' using errcode = 'check_violation'; end if;
  select status into v_status from public.leave_requests where id = p_id for update;
  if v_status is null then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if v_status not in ('submitted', 'reviewed') then raise exception 'This request is closed (%) and can no longer be changed.', v_status using errcode = 'check_violation'; end if;
  update public.leave_requests set status = 'reviewed', overtime_required = p_overtime, review_signed_by = nullif(trim(p_signed_by), ''),
    review_remarks = nullif(trim(p_remarks), ''), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_id;
end $$;

create or replace function public.request_decide(p_id uuid, p_approve boolean, p_remarks text)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.leave_requests; v_leave uuid; v_label text;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can approve or not approve a leave request.' using errcode = 'insufficient_privilege'; end if;
  if p_approve is null then raise exception 'Choose Approved or Not approved.' using errcode = 'check_violation'; end if;
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.status not in ('submitted', 'reviewed') then raise exception 'This request is already closed (%).', r.status using errcode = 'check_violation'; end if;
  if p_approve then
    v_label := case r.request_type when 'scheduled' then 'Scheduled' when 'unscheduled' then 'Unscheduled' else 'Unpaid' end;
    -- the approved leave goes into the plan as a hand entry (refuses overlaps with leave already recorded)
    v_leave := public.leave_save(null, r.employee_id, public.request_type_code(r.request_type), r.start_date, r.end_date,
      concat_ws(' · ', format('%s leave request approved by the Section Head', v_label), nullif(trim(r.reason), ''), nullif(trim(p_remarks), '')));
  end if;
  update public.leave_requests set status = case when p_approve then 'approved' else 'not_approved' end,
    decision_remarks = nullif(trim(p_remarks), ''), decided_by = auth.uid(), decided_at = now(), leave_record_id = v_leave, updated_at = now()
  where id = p_id;
  return v_leave;
end $$;

create or replace function public.request_withdraw(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can withdraw a request.' using errcode = 'insufficient_privilege'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Give the reason for withdrawing.' using errcode = 'check_violation'; end if;
  select status into v_status from public.leave_requests where id = p_id for update;
  if v_status is null then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if v_status not in ('submitted', 'reviewed') then raise exception 'This request is already closed (%).', v_status using errcode = 'check_violation'; end if;
  update public.leave_requests set status = 'withdrawn', withdraw_reason = trim(p_reason), updated_at = now() where id = p_id;
end $$;

revoke execute on function public.request_save(uuid, uuid, text, date, date, text, text, text, numeric, date, date) from public, anon;
revoke execute on function public.request_review(uuid, boolean, text, text) from public, anon;
revoke execute on function public.request_decide(uuid, boolean, text) from public, anon;
revoke execute on function public.request_withdraw(uuid, text) from public, anon;
grant execute on function public.request_save(uuid, uuid, text, date, date, text, text, text, numeric, date, date) to authenticated;
grant execute on function public.request_review(uuid, boolean, text, text) to authenticated;
grant execute on function public.request_decide(uuid, boolean, text) to authenticated;
grant execute on function public.request_withdraw(uuid, text) to authenticated;
