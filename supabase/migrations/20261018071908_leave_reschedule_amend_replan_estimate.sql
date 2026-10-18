-- Leave reschedule, simpler and complete:
--   * the Section Head can change the dates of a reschedule request before approving it (change_request_amend)
--   * a planned PV cancelled this year (e.g. for a shutdown) can be given new dates: a "re-plan" request that creates the
--     new leave on approval, linked to the cancelled one
--   * "dates not confirmed yet": the request carries it to the new leave (dates_estimated)
alter table public.leave_change_requests add column estimated boolean not null default false;
alter table public.leave_change_requests add column replan boolean not null default false;
comment on column public.leave_change_requests.estimated is 'The new dates are an estimate: the new leave is marked dates_estimated until confirmed.';
comment on column public.leave_change_requests.replan is 'New dates for a planned PV that was cancelled (the leave owed): approval creates a new leave.';

-- the new form takes p_estimated (no default, so the 5-argument form below is never ambiguous)
create function public.change_request_create(p_records uuid[], p_start date, p_end date, p_remark text, p_impact jsonb, p_estimated boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_n integer; v_old_start date; v_old_end date; v_ids uuid[]; v_id uuid; v_replan boolean := false; v_c public.leave_records;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can request a change.' using errcode = 'insufficient_privilege'; end if;
  if coalesce(array_length(p_records, 1), 0) = 0 then raise exception 'Choose the leave to move.' using errcode = 'check_violation'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation'; end if;
  if nullif(trim(coalesce(p_remark, '')), '') is null then raise exception 'Give the remark for the change.' using errcode = 'check_violation'; end if;
  select employee_id into v_emp from public.leave_records where id = p_records[1];
  select count(*), min(start_date), max(end_date) into v_n, v_old_start, v_old_end from public.leave_records
   where id = any (p_records) and employee_id = v_emp and in_current_plan and status in ('approved', 'planned');
  if v_emp is not null and v_n = 0 and array_length(p_records, 1) = 1 then
    -- a cancelled planned PV, not given new dates yet: the leave owed
    select l.* into v_c from public.leave_records l join public.absence_types t on t.code = l.absence_type_code
     where l.id = p_records[1] and l.status = 'cancelled' and t.entry_mode = 'pv' and l.superseded_by is null
       and not exists (select 1 from public.leave_change_requests c where c.replan and c.status = 'approved' and c.record_ids[1] = l.id);
    if v_c.id is null then raise exception 'This leave can no longer be given new dates.' using errcode = 'check_violation'; end if;
    v_replan := true; v_n := 1; v_old_start := v_c.start_date; v_old_end := v_c.end_date;
  end if;
  if v_emp is null or v_n <> array_length(p_records, 1) then raise exception 'This leave is no longer in the current plan.' using errcode = 'check_violation'; end if;
  if not v_replan and (v_old_start, v_old_end) is not distinct from (p_start, p_end) then raise exception 'The new dates are the same as now.' using errcode = 'check_violation'; end if;
  select array_agg(id order by start_date) into v_ids from public.leave_records where id = any (p_records);
  begin
    insert into public.leave_change_requests (employee_id, record_ids, old_start, old_end, new_start, new_end, remark, impact, estimated, replan)
    values (v_emp, v_ids, v_old_start, v_old_end, p_start, p_end, trim(p_remark), p_impact, coalesce(p_estimated, false), v_replan) returning id into v_id;
  exception when unique_violation then
    raise exception 'There is already an open request to change this leave.' using errcode = 'check_violation';
  end;
  return v_id;
end $$;
revoke execute on function public.change_request_create(uuid[], date, date, text, jsonb, boolean) from public, anon;
grant execute on function public.change_request_create(uuid[], date, date, text, jsonb, boolean) to authenticated;

-- the 5-argument form (older app versions) is the same with estimated = false
create or replace function public.change_request_create(p_records uuid[], p_start date, p_end date, p_remark text, p_impact jsonb)
returns uuid language sql security definer set search_path = public as $$
  select public.change_request_create(p_records, p_start, p_end, p_remark, p_impact, false)
$$;

-- the Section Head changes the dates of an open request before deciding it (the request record follows: mirror trigger)
create function public.change_request_amend(p_id uuid, p_start date, p_end date, p_estimated boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.leave_change_requests;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can change the dates of a request.' using errcode = 'insufficient_privilege'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation'; end if;
  select * into r from public.leave_change_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.status <> 'requested' then raise exception 'This request is already closed (%).', r.status using errcode = 'check_violation'; end if;
  if not r.replan and (r.old_start, r.old_end) is not distinct from (p_start, p_end) then raise exception 'The new dates are the same as now.' using errcode = 'check_violation'; end if;
  update public.leave_change_requests set new_start = p_start, new_end = p_end, impact = null, estimated = coalesce(p_estimated, estimated),
    remark = case when (new_start, new_end) is distinct from (p_start, p_end) then remark || format(' · Dates changed by the Section Head (asked %s – %s)', to_char(r.new_start, 'FMDD Mon'), to_char(r.new_end, 'FMDD Mon')) else remark end,
    updated_at = now()
  where id = p_id and (new_start, new_end, estimated) is distinct from (p_start, p_end, coalesce(p_estimated, estimated));
end $$;
revoke execute on function public.change_request_amend(uuid, date, date, boolean) from public, anon;
grant execute on function public.change_request_amend(uuid, date, date, boolean) to authenticated;

create or replace function public.change_request_decide(p_id uuid, p_approve boolean, p_remarks text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r public.leave_change_requests; v_recs public.leave_records[]; v_n integer; v_first public.leave_records; v_last public.leave_records;
  v_ids uuid[]; v_note text; v_c public.leave_records;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can approve or not approve a change.' using errcode = 'insufficient_privilege'; end if;
  if p_approve is null then raise exception 'Choose Approved or Not approved.' using errcode = 'check_violation'; end if;
  select * into r from public.leave_change_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.status <> 'requested' then raise exception 'This request is already closed (%).', r.status using errcode = 'check_violation'; end if;
  if p_approve then
    v_note := concat_ws(' · ', 'Change request approved by the Section Head', r.remark, nullif(trim(coalesce(p_remarks, '')), ''));
    if r.replan then
      -- the leave owed: a new leave with the new dates; the cancelled one points to it (superseded_by)
      select * into v_c from public.leave_records where id = r.record_ids[1] and status = 'cancelled' and superseded_by is null;
      if v_c.id is null then raise exception 'The leave changed since this request was made. Do not approve it: ask for the change again.' using errcode = 'check_violation'; end if;
      v_ids := array[public.leave_save(null, v_c.employee_id, coalesce(v_c.absence_type_code, 'annual_leave_planned'), r.new_start, r.new_end, v_note)];
      update public.leave_records set change_reason = v_note where id = v_ids[1];
      update public.leave_records set superseded_by = v_ids[1] where id = v_c.id;
    else
      select array_agg(l order by l.start_date) into v_recs from public.leave_records l
       where l.id = any (r.record_ids) and l.in_current_plan and l.status in ('approved', 'planned');
      v_n := coalesce(array_length(v_recs, 1), 0);
      if v_n <> array_length(r.record_ids, 1) then raise exception 'The leave changed since this request was made. Do not approve it: ask for the change again.' using errcode = 'check_violation'; end if;
      v_first := v_recs[1]; v_last := v_recs[v_n];
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
    end if;
    -- estimated or confirmed, as the request says
    update public.leave_records set dates_estimated = r.estimated where id = any (v_ids) and dates_estimated is distinct from r.estimated;
    -- the new dates need a new EasyHR request
    perform public.leave_set_oracle(v_ids, 'not_submitted', null);
  end if;
  update public.leave_change_requests set status = case when p_approve then 'approved' else 'not_approved' end,
    decision_remarks = nullif(trim(coalesce(p_remarks, '')), ''), decided_by = auth.uid(), decided_at = now(),
    result_record_id = case when p_approve then v_ids[1] end, updated_at = now()
  where id = p_id;
  return case when p_approve then v_ids[1] end;
end $$;
