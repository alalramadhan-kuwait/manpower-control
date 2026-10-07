-- Fix for request_foundation: three of its functions reused the names of the leave-form (Stage F) functions.
-- request_withdraw(uuid, text) had replaced the leave-form withdraw, and request_decide gained an ambiguous overload.
-- The new request functions get their own names; the leave-form withdraw is restored exactly as Stage F wrote it.

alter function public.request_submit(text, uuid, integer, text, text, jsonb, jsonb, text, uuid, text) rename to request_header_submit;
alter function public.request_decide(uuid, boolean, text, jsonb, jsonb) rename to request_header_decide;
alter function public.request_withdraw(uuid, text) rename to request_header_withdraw;

-- Leave-form withdraw, as in 20260924111007_stage_f_leave_requests.sql.
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
revoke execute on function public.request_withdraw(uuid, text) from public, anon;
grant execute on function public.request_withdraw(uuid, text) to authenticated;

-- The approval wrappers call the renamed functions.
create or replace function public.approval_submit(p_kind text, p_employee uuid, p_start date, p_end date, p_summary text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_type text; v_detail jsonb; r jsonb; p jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if p_kind = 'leave' then
    v_type := case when p->>'type' = 'annual_leave_unscheduled' then 'unscheduled_pv' else 'absence' end;
    v_detail := jsonb_build_object('absence_type_code', p->>'type', 'start_date', p_start, 'end_date', coalesce(p_end, p_start));
  elsif p_kind = 'movement' then
    v_type := 'shift_change';
    v_detail := jsonb_build_object('kind', case when p->>'to' = 'DAY' then 'day_duty' when p->>'kind' = 'permanent' then 'permanent' else 'temporary' end,
      'to_crew', case when p->>'to' = 'DAY' then null else p->>'to' end, 'start_date', p_start, 'return_date', p_end + 1, 'reason', p->>'reason');
  elsif p_kind = 'vr_placement' then
    v_type := 'vr_placement';
    v_detail := jsonb_build_object('crew_code', p->>'crew', 'start_date', p_start, 'end_date', p_end, 'reason', p->>'reason');
  elsif p_kind = 'task_release' then
    v_type := 'task_release';
    v_detail := jsonb_build_object('start_date', p_start, 'end_date', coalesce(p_end, p_start), 'from_time', p->>'from_time', 'to_time', p->>'to_time', 'task', p->>'task');
  elsif p_kind = 'controller_cover' then
    v_type := 'controller_cover';
    v_detail := jsonb_build_object('cover_kind', p->>'kind', 'crew_code', p->>'crew_code', 'covers_employee_id', p->>'covers_employee_id', 'start_date', p_start, 'end_date', p_end, 'reason', p->>'note');
  else
    raise exception 'Unknown request type %.', p_kind using errcode = 'check_violation';
  end if;
  r := public.request_header_submit(v_type, p_employee, extract(year from p_start)::integer, p_summary, case when p_kind = 'leave' then p->>'note' end, v_detail, null, null, null, 'approval');
  return jsonb_build_object('id', r->>'id', 'status', case when r->>'status' = 'submitted' then 'pending' else 'approved' end, 'result', r->>'result');
end $$;

create or replace function public.approval_decide(p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public.request_header_decide(p_id, p_approve, p_note, null, '[]'::jsonb);
end $$;

create or replace function public.approval_withdraw(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.request_header_withdraw(p_id, p_reason);
end $$;
