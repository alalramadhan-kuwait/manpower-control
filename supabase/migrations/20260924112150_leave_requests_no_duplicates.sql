-- One leave, one record: leave requests (Stage F) and leave entered by hand (Stage E) never duplicate each other.
-- 1. leave_save: adding leave by hand is refused while an open leave request covers those dates (decide it in
--    Requests instead). request_decide marks the request it is approving (app.deciding_request) so its own
--    approval passes.
-- 2. request_save: a second open request for the same employee and overlapping dates is refused.
-- 3. request_decide, on approval:
--    - no current leave on those dates        → a new hand-entered record (as before);
--    - one current record with the same dates → that record is confirmed and linked (type corrected if it differs);
--    - a Scheduled request and one planned / rescheduled PV block with other dates → the block is moved to the
--      approved dates through leave_save (old dates kept as history);
--    - anything else overlapping              → refused, naming the leave to correct or cancel first.

create or replace function public.leave_save(p_record uuid, p_employee uuid, p_type text, p_start date, p_end date, p_note text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
  v_old   public.leave_records;
  v_emp   uuid;
  v_clash record;
  v_new   uuid;
  v_what  text;
  v_req   record;
begin
  if not public.app_is_staff() then
    raise exception 'Only the Section Head or the Manpower Coordinator can change leave.' using errcode = 'insufficient_privilege';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation';
  end if;
  if p_end - p_start > 365 then
    raise exception 'One leave record can be at most a year long.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.absence_types where code = p_type and is_active) then
    raise exception 'Choose a leave type.' using errcode = 'check_violation';
  end if;

  if p_record is not null then
    select * into v_old from public.leave_records where id = p_record for update;
    if not found then raise exception 'Leave record not found.' using errcode = 'no_data_found'; end if;
    if not (v_old.in_current_plan and v_old.status in ('approved', 'planned')) then
      raise exception 'Only leave in the current plan can be corrected.' using errcode = 'check_violation';
    end if;
    if v_note is null then raise exception 'Give the reason for the correction.' using errcode = 'check_violation'; end if;
    if (v_old.absence_type_code, v_old.start_date, v_old.end_date) is not distinct from (p_type, p_start, p_end) then
      raise exception 'Nothing changed.' using errcode = 'check_violation';
    end if;
    v_emp := v_old.employee_id;
  else
    v_emp := p_employee;
    if v_emp is null or not exists (select 1 from public.employees where id = v_emp) then
      raise exception 'Choose the employee.' using errcode = 'check_violation';
    end if;
  end if;

  select l.start_date, l.end_date into v_clash from public.leave_records l
   where l.employee_id = v_emp and l.in_current_plan and l.status in ('approved', 'planned', 'unresolved')
     and l.id is distinct from p_record and l.start_date <= p_end and l.end_date >= p_start
   order by l.start_date limit 1;
  if found then
    raise exception 'Overlaps leave already recorded (% – %). Correct or cancel that record instead.',
      to_char(v_clash.start_date, 'FMDD Mon YYYY'), to_char(v_clash.end_date, 'FMDD Mon YYYY') using errcode = 'check_violation';
  end if;

  -- add
  if p_record is null then
    -- one leave, one record: an open leave request for these dates is decided in Requests, not added again here
    -- (request_decide sets app.deciding_request to the request it is approving)
    select r.id, r.created_at into v_req from public.leave_requests r
     where r.employee_id = v_emp and r.status in ('submitted', 'reviewed') and r.start_date <= p_end and r.end_date >= p_start
       and r.id::text is distinct from nullif(current_setting('app.deciding_request', true), '')
     limit 1;
    if found then
      raise exception 'An open leave request (entered %) covers these dates. Approve or withdraw it in Requests instead.',
        to_char(v_req.created_at, 'FMDD Mon YYYY') using errcode = 'check_violation';
    end if;
    insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref,
                                      review_status, note, in_original_plan, in_current_plan, hand_corrected)
    values (v_emp, p_type, p_start, p_end, 'approved', 'manual', 'Entered by hand', 'none', v_note, false, true, true)
    returning id into v_new;
    insert into public.leave_plan_changes (employee_id, change_kind, current_record_id, to_start, to_end, note, by_hand)
    values (v_emp, 'added', v_new, p_start, p_end, coalesce(v_note, 'Entered by hand'), true);
    return v_new;
  end if;

  v_what := concat_ws('; ',
    case when v_old.absence_type_code is distinct from p_type then
      format('type %s → %s', coalesce((select short_code from public.absence_types where code = v_old.absence_type_code), '—'),
                             (select short_code from public.absence_types where code = p_type)) end,
    case when (v_old.start_date, v_old.end_date) is distinct from (p_start, p_end) then 'dates' end);

  -- correct in place: a hand-entered record, or only the type changes
  if v_old.source_kind = 'manual' or (v_old.start_date = p_start and v_old.end_date = p_end) then
    update public.leave_records set absence_type_code = p_type, start_date = p_start, end_date = p_end, hand_corrected = true,
      note = concat_ws(' | ', note, 'Corrected by hand: ' || v_note)
    where id = v_old.id;
    insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, current_record_id, from_start, from_end, to_start, to_end, note, by_hand)
    values (v_emp, 'corrected', v_old.id, v_old.id, v_old.start_date, v_old.end_date, p_start, p_end, format('Corrected by hand (%s): %s', v_what, v_note), true);
    return v_old.id;
  end if;

  -- new dates for an imported record: a hand-entered replacement; the imported record stays as history
  insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref,
                                    review_status, note, in_original_plan, in_current_plan, rescheduled_from, hand_corrected)
  values (v_emp, p_type, p_start, p_end, 'approved', 'manual', 'Corrected by hand', 'none', v_note, false, true, v_old.id, true)
  returning id into v_new;
  update public.leave_records set in_current_plan = false, status = 'rescheduled', superseded_by = v_new, hand_corrected = true,
    note = concat_ws(' | ', note, 'Replaced by a hand correction: ' || v_note)
  where id = v_old.id;
  insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, current_record_id, from_start, from_end, to_start, to_end, note, by_hand)
  values (v_emp, 'corrected', v_old.id, v_new, v_old.start_date, v_old.end_date, p_start, p_end, format('Corrected by hand (%s): %s', v_what, v_note), true);
  return v_new;
end $$;

create or replace function public.request_save(p_id uuid, p_employee uuid, p_type text, p_start date, p_end date, p_reason text,
  p_address text, p_phone text, p_balance numeric, p_balance_as_of date, p_form_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text; v_other record;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can enter leave requests.' using errcode = 'insufficient_privilege'; end if;
  if p_type not in ('scheduled', 'unscheduled', 'unpaid') then raise exception 'Choose Scheduled, Unscheduled or Unpaid.' using errcode = 'check_violation'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation'; end if;
  if p_end - p_start > 365 then raise exception 'One request can cover at most a year.' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.employees where id = p_employee and is_active) then raise exception 'Choose an active employee.' using errcode = 'check_violation'; end if;
  select r.start_date, r.end_date, r.created_at into v_other from public.leave_requests r
   where r.employee_id = p_employee and r.status in ('submitted', 'reviewed') and r.id is distinct from p_id
     and r.start_date <= p_end and r.end_date >= p_start
   limit 1;
  if found then
    raise exception 'This employee already has an open request for % – % (entered %). Correct that request instead of entering a second one.',
      to_char(v_other.start_date, 'FMDD Mon'), to_char(v_other.end_date, 'FMDD Mon YYYY'), to_char(v_other.created_at, 'FMDD Mon') using errcode = 'check_violation';
  end if;
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

create or replace function public.request_decide(p_id uuid, p_approve boolean, p_remarks text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r       public.leave_requests;
  v_leave uuid;
  v_code  text;
  v_note  text;
  v_n     int;
  v_one   public.leave_records;
  v_list  text;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can approve or not approve a leave request.' using errcode = 'insufficient_privilege'; end if;
  if p_approve is null then raise exception 'Choose Approved or Not approved.' using errcode = 'check_violation'; end if;
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.status not in ('submitted', 'reviewed') then raise exception 'This request is already closed (%).', r.status using errcode = 'check_violation'; end if;
  if p_approve then
    perform set_config('app.deciding_request', r.id::text, true);
    v_code := public.request_type_code(r.request_type);
    v_note := concat_ws(' · ', format('%s leave request approved by the Section Head',
                case r.request_type when 'scheduled' then 'Scheduled' when 'unscheduled' then 'Unscheduled' else 'Unpaid' end),
              nullif(trim(r.reason), ''), nullif(trim(p_remarks), ''));
    select count(*), string_agg(format('%s %s – %s', coalesce(t.short_code, '?'), to_char(l.start_date, 'FMDD Mon'), to_char(l.end_date, 'FMDD Mon')), ', ' order by l.start_date)
      into v_n, v_list
      from public.leave_records l left join public.absence_types t on t.code = l.absence_type_code
     where l.employee_id = r.employee_id and l.in_current_plan and l.status in ('approved', 'planned', 'unresolved')
       and l.start_date <= r.end_date and l.end_date >= r.start_date;
    if v_n = 1 then
      select l.* into v_one from public.leave_records l
       where l.employee_id = r.employee_id and l.in_current_plan and l.status in ('approved', 'planned', 'unresolved')
         and l.start_date <= r.end_date and l.end_date >= r.start_date;
    end if;
    if v_n = 0 then
      v_leave := public.leave_save(null, r.employee_id, v_code, r.start_date, r.end_date, v_note);
    elsif v_n = 1 and v_one.status <> 'unresolved' and v_one.start_date = r.start_date and v_one.end_date = r.end_date then
      -- the same leave is already recorded (monthly sheet, PV plan or by hand): confirm it, never add a second record
      if v_one.absence_type_code is distinct from v_code then
        v_leave := public.leave_save(v_one.id, null, v_code, r.start_date, r.end_date, 'Type set by the approved leave request');
      else
        update public.leave_records set hand_corrected = true, note = concat_ws(' | ', note, v_note) where id = v_one.id;
        v_leave := v_one.id;
      end if;
    elsif v_n = 1 and r.request_type = 'scheduled' and v_one.status <> 'unresolved'
          and v_one.absence_type_code in ('annual_leave_planned', 'annual_leave_rescheduled') then
      -- a scheduled request for a planned block on other dates: the block moves to the approved dates
      v_leave := public.leave_save(v_one.id, null, v_one.absence_type_code, r.start_date, r.end_date, 'Moved to the dates of the approved leave request');
    else
      raise exception 'Leave already recorded on these dates: %. Correct or cancel it in the Annual Leave Plan first, then approve.', v_list using errcode = 'check_violation';
    end if;
  end if;
  update public.leave_requests set status = case when p_approve then 'approved' else 'not_approved' end,
    decision_remarks = nullif(trim(p_remarks), ''), decided_by = auth.uid(), decided_at = now(), leave_record_id = v_leave, updated_at = now()
  where id = p_id;
  return v_leave;
end $$;
