-- Leave change requests: the Manpower Coordinator asks to move a leave (reschedule), with a remark and the manpower
-- impact at the time; the Section Head approves or does not approve. Approval moves the leave through leave_save
-- (old dates kept as history) and puts it back to Not submitted in Oracle. Nothing is deleted.
--
-- 1. leave_change_requests: the leave's records, old and new dates, remark, impact snapshot, decision. Staff can
--    read; all writes go through the functions below.
-- 2. change_request_create (staff), change_request_decide (Section Head only), change_request_withdraw (staff).
--    Open = requested. One open request per leave.

create table public.leave_change_requests (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees(id),
  record_ids        uuid[] not null,
  old_start         date not null,
  old_end           date not null,
  new_start         date not null,
  new_end           date not null,
  remark            text not null,
  impact            jsonb,
  status            text not null default 'requested' check (status in ('requested', 'approved', 'not_approved', 'withdrawn')),
  requested_by      uuid default auth.uid(),
  requested_at      timestamptz not null default now(),
  decision_remarks  text,
  decided_by        uuid,
  decided_at        timestamptz,
  withdraw_reason   text,
  result_record_id  uuid references public.leave_records(id),
  updated_at        timestamptz not null default now(),
  constraint leave_change_requests_dates check (old_end >= old_start and new_end >= new_start and new_end - new_start <= 365),
  constraint leave_change_requests_records check (coalesce(array_length(record_ids, 1), 0) > 0)
);
comment on table public.leave_change_requests is 'Requests to move a leave to other dates (Manpower Coordinator asks, Section Head decides). Written only through change_request_* functions.';
comment on column public.leave_change_requests.impact is 'Manpower impact of the new dates when the request was made: { short: duties short, dates: [...], clash: [names] }.';
create unique index leave_change_requests_one_open on public.leave_change_requests ((record_ids[1])) where status = 'requested';
create index leave_change_requests_status on public.leave_change_requests (status, requested_at);
create index leave_change_requests_employee on public.leave_change_requests (employee_id, requested_at);

create trigger leave_change_requests_audit after insert or update or delete on public.leave_change_requests
  for each row execute function public.audit_row_change();
alter table public.leave_change_requests enable row level security;
create policy leave_change_requests_staff_read on public.leave_change_requests for select to authenticated using (public.app_is_staff());

create or replace function public.change_request_create(p_records uuid[], p_start date, p_end date, p_remark text, p_impact jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_n integer; v_old_start date; v_old_end date; v_ids uuid[]; v_id uuid;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can request a change.' using errcode = 'insufficient_privilege'; end if;
  if coalesce(array_length(p_records, 1), 0) = 0 then raise exception 'Choose the leave to move.' using errcode = 'check_violation'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation'; end if;
  if nullif(trim(coalesce(p_remark, '')), '') is null then raise exception 'Give the remark for the change.' using errcode = 'check_violation'; end if;
  select employee_id into v_emp from public.leave_records where id = p_records[1];
  select count(*), min(start_date), max(end_date) into v_n, v_old_start, v_old_end from public.leave_records
   where id = any (p_records) and employee_id = v_emp and in_current_plan and status in ('approved', 'planned');
  if v_emp is null or v_n <> array_length(p_records, 1) then raise exception 'This leave is no longer in the current plan.' using errcode = 'check_violation'; end if;
  if (v_old_start, v_old_end) is not distinct from (p_start, p_end) then raise exception 'The new dates are the same as now.' using errcode = 'check_violation'; end if;
  select array_agg(id order by start_date) into v_ids from public.leave_records where id = any (p_records);
  begin
    insert into public.leave_change_requests (employee_id, record_ids, old_start, old_end, new_start, new_end, remark, impact)
    values (v_emp, v_ids, v_old_start, v_old_end, p_start, p_end, trim(p_remark), p_impact) returning id into v_id;
  exception when unique_violation then
    raise exception 'There is already an open request to change this leave.' using errcode = 'check_violation';
  end;
  return v_id;
end $$;

create or replace function public.change_request_decide(p_id uuid, p_approve boolean, p_remarks text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r public.leave_change_requests; v_recs public.leave_records[]; v_n integer; v_first public.leave_records; v_last public.leave_records;
  v_ids uuid[]; v_note text;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can approve or not approve a change.' using errcode = 'insufficient_privilege'; end if;
  if p_approve is null then raise exception 'Choose Approved or Not approved.' using errcode = 'check_violation'; end if;
  select * into r from public.leave_change_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.status <> 'requested' then raise exception 'This request is already closed (%).', r.status using errcode = 'check_violation'; end if;
  if p_approve then
    select array_agg(l order by l.start_date) into v_recs from public.leave_records l
     where l.id = any (r.record_ids) and l.in_current_plan and l.status in ('approved', 'planned');
    v_n := coalesce(array_length(v_recs, 1), 0);
    if v_n <> array_length(r.record_ids, 1) then raise exception 'The leave changed since this request was made. Do not approve it: ask for the change again.' using errcode = 'check_violation'; end if;
    v_first := v_recs[1]; v_last := v_recs[v_n];
    v_note := concat_ws(' · ', 'Change request approved by the Section Head', r.remark, nullif(trim(coalesce(p_remarks, '')), ''));
    v_ids := array(select l.id from unnest(v_recs) l);
    if v_n = 1 then
      v_ids[1] := public.leave_save(v_first.id, null, coalesce(v_first.absence_type_code, 'annual_leave_planned'), r.new_start, r.new_end, v_note);
    else
      if r.new_start > v_first.end_date or r.new_end < v_last.start_date then
        raise exception 'These dates change more than the first and last part of this leave. Correct it in the Leave plan.' using errcode = 'check_violation';
      end if;
      if r.new_start <> v_first.start_date then v_ids[1] := public.leave_save(v_first.id, null, coalesce(v_first.absence_type_code, 'annual_leave_planned'), r.new_start, v_first.end_date, v_note); end if;
      if r.new_end <> v_last.end_date then v_ids[v_n] := public.leave_save(v_last.id, null, coalesce(v_last.absence_type_code, 'annual_leave_planned'), v_last.start_date, r.new_end, v_note); end if;
    end if;
    -- the new dates need a new EasyHR request
    perform public.leave_set_oracle(v_ids, 'not_submitted', null);
  end if;
  update public.leave_change_requests set status = case when p_approve then 'approved' else 'not_approved' end,
    decision_remarks = nullif(trim(coalesce(p_remarks, '')), ''), decided_by = auth.uid(), decided_at = now(),
    result_record_id = case when p_approve then v_ids[1] end, updated_at = now()
  where id = p_id;
  return case when p_approve then v_ids[1] end;
end $$;

create or replace function public.change_request_withdraw(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can withdraw a request.' using errcode = 'insufficient_privilege'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Give the reason for withdrawing.' using errcode = 'check_violation'; end if;
  select status into v_status from public.leave_change_requests where id = p_id for update;
  if v_status is null then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if v_status <> 'requested' then raise exception 'This request is already closed (%).', v_status using errcode = 'check_violation'; end if;
  update public.leave_change_requests set status = 'withdrawn', withdraw_reason = trim(p_reason), updated_at = now() where id = p_id;
end $$;

revoke execute on function public.change_request_create(uuid[], date, date, text, jsonb) from public, anon;
revoke execute on function public.change_request_decide(uuid, boolean, text) from public, anon;
revoke execute on function public.change_request_withdraw(uuid, text) from public, anon;
grant execute on function public.change_request_create(uuid[], date, date, text, jsonb) to authenticated;
grant execute on function public.change_request_decide(uuid, boolean, text) to authenticated;
grant execute on function public.change_request_withdraw(uuid, text) to authenticated;
