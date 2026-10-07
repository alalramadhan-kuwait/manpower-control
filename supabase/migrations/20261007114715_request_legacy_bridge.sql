-- Phase 1 bridge between the legacy request screens and the request history.
-- Rule while a legacy screen is still in use: the legacy row is the only writer (through its own functions); every
-- insert or update of it rewrites its one linked request header in the same transaction (both or neither). The link
-- is (legacy_table, legacy_id), unique. Deciding or withdrawing from the request side goes through the legacy
-- function, so the two can never disagree. request_legacy_drift() lists any difference (expected: none).

alter table public.request_headers add column legacy_status text;
alter table public.request_headers add constraint rh_legacy_pair check ((legacy_table is null) = (legacy_id is null));
alter table public.request_headers add constraint rh_legacy_kind check (
  legacy_table is null
  or (legacy_table = 'leave_change_requests' and type = 'pv_reschedule')
  or (legacy_table = 'leave_requests' and type = 'leave_form'));

-- the reschedule request → its header (insert once, then update the same header)
create or replace function public.request_mirror_change_row(c public.leave_change_requests) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type text;
begin
  select coalesce(absence_type_code, 'annual_leave_planned') into v_type from public.leave_records where id = c.record_ids[1];
  insert into public.request_headers (type, employee_id, source, workflow, status, legacy_status, plan_year, start_date, end_date, summary, remarks,
    requested_by, requested_at, decided_by, decided_at, decision_note, result_table, result_id, legacy_table, legacy_id)
  values ('pv_reschedule', c.employee_id, 'normal_request', 'approval',
    case c.status when 'requested' then 'submitted' else c.status end, c.status,
    extract(year from c.old_start)::integer, c.new_start, c.new_end,
    format('PV %s – %s → %s – %s', to_char(c.old_start, 'FMDD Mon'), to_char(c.old_end, 'FMDD Mon'), to_char(c.new_start, 'FMDD Mon'), to_char(c.new_end, 'FMDD Mon YYYY')),
    c.remark, c.requested_by, c.requested_at, c.decided_by, c.decided_at, coalesce(c.decision_remarks, c.withdraw_reason),
    case when c.result_record_id is not null then 'leave_records' end, c.result_record_id, 'leave_change_requests', c.id)
  on conflict (legacy_table, legacy_id) do update set employee_id = excluded.employee_id, status = excluded.status, legacy_status = excluded.legacy_status,
    plan_year = excluded.plan_year, start_date = excluded.start_date, end_date = excluded.end_date, summary = excluded.summary, remarks = excluded.remarks,
    requested_by = excluded.requested_by, requested_at = excluded.requested_at, decided_by = excluded.decided_by, decided_at = excluded.decided_at,
    decision_note = excluded.decision_note, result_table = excluded.result_table, result_id = excluded.result_id
  returning id into v_id;
  insert into public.request_leave (header_id, absence_type_code, start_date, end_date, replaces_record_ids, old_start, old_end, created_record_id)
  values (v_id, v_type, c.new_start, c.new_end, c.record_ids, c.old_start, c.old_end, c.result_record_id)
  on conflict (header_id) do update set absence_type_code = excluded.absence_type_code, start_date = excluded.start_date, end_date = excluded.end_date,
    replaces_record_ids = excluded.replaces_record_ids, old_start = excluded.old_start, old_end = excluded.old_end, created_record_id = excluded.created_record_id;
end $$;
revoke execute on function public.request_mirror_change_row(public.leave_change_requests) from public, anon, authenticated;

-- the leave form → its header (submitted and reviewed both wait for the Section Head; legacy_status keeps which)
create or replace function public.request_mirror_form_row(f public.leave_requests) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.request_headers (type, employee_id, source, workflow, status, legacy_status, plan_year, start_date, end_date, summary, remarks,
    requested_by, requested_at, decided_by, decided_at, decision_note, result_table, result_id, legacy_table, legacy_id)
  values ('leave_form', f.employee_id, 'normal_request', 'approval',
    case when f.status in ('submitted', 'reviewed') then 'submitted' else f.status end, f.status,
    extract(year from f.start_date)::integer, f.start_date, f.end_date,
    format('Leave form (%s) %s – %s', f.request_type, to_char(f.start_date, 'FMDD Mon'), to_char(f.end_date, 'FMDD Mon YYYY')),
    f.reason, f.entered_by, f.created_at, f.decided_by, f.decided_at, coalesce(f.decision_remarks, f.withdraw_reason),
    case when f.leave_record_id is not null then 'leave_records' end, f.leave_record_id, 'leave_requests', f.id)
  on conflict (legacy_table, legacy_id) do update set employee_id = excluded.employee_id, status = excluded.status, legacy_status = excluded.legacy_status,
    plan_year = excluded.plan_year, start_date = excluded.start_date, end_date = excluded.end_date, summary = excluded.summary, remarks = excluded.remarks,
    requested_by = excluded.requested_by, requested_at = excluded.requested_at, decided_by = excluded.decided_by, decided_at = excluded.decided_at,
    decision_note = excluded.decision_note, result_table = excluded.result_table, result_id = excluded.result_id
  returning id into v_id;
  insert into public.request_leave (header_id, absence_type_code, start_date, end_date, created_record_id)
  values (v_id, public.request_type_code(f.request_type), f.start_date, f.end_date, f.leave_record_id)
  on conflict (header_id) do update set absence_type_code = excluded.absence_type_code, start_date = excluded.start_date, end_date = excluded.end_date,
    created_record_id = excluded.created_record_id;
end $$;
revoke execute on function public.request_mirror_form_row(public.leave_requests) from public, anon, authenticated;

-- legacy request rows are history: never deleted
create or replace function public.request_legacy_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Requests are kept for history and cannot be deleted: withdraw the request instead.' using errcode = 'check_violation';
end $$;
create trigger leave_change_requests_no_delete before delete on public.leave_change_requests for each row execute function public.request_legacy_no_delete();
create trigger leave_requests_no_delete before delete on public.leave_requests for each row execute function public.request_legacy_no_delete();

-- Decide from the request side: a legacy request is decided by its own function (which writes the legacy row and,
-- through the mirror, this header); the checks seen and the warnings accepted are kept on the header.
create or replace function public.request_header_decide(p_id uuid, p_approve boolean, p_note text, p_check jsonb default null, p_accepted jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.request_headers; v_res uuid;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can approve or not approve.' using errcode = 'insufficient_privilege'; end if;
  if p_approve is null then raise exception 'Choose Approve or Not approve.' using errcode = 'check_violation'; end if;
  select * into r from public.request_headers where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.status <> 'submitted' then raise exception 'This request is already %.', replace(r.status, '_', ' ') using errcode = 'check_violation'; end if;
  if r.legacy_table = 'leave_change_requests' then
    v_res := public.change_request_decide(r.legacy_id, p_approve, p_note);
  elsif r.legacy_table = 'leave_requests' then
    v_res := public.request_decide(r.legacy_id, p_approve, p_note);
  else
    if p_approve then v_res := public.request_apply(p_id); end if;
    update public.request_headers set status = case when p_approve then 'approved' else 'not_approved' end, decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(btrim(coalesce(p_note, '')), ''), result_id = v_res, result_table = case when p_approve then public.request_result_table(r.type) end
    where id = p_id;
  end if;
  update public.request_headers set check_at_decision = p_check, accepted_findings = coalesce(p_accepted, '[]'::jsonb) where id = p_id
  returning * into r;
  return jsonb_build_object('id', p_id, 'status', r.status, 'result', v_res);
end $$;

create or replace function public.request_header_withdraw(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.request_headers;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can withdraw a request.' using errcode = 'insufficient_privilege'; end if;
  select * into r from public.request_headers where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.status <> 'submitted' then raise exception 'Only a request still waiting can be withdrawn.' using errcode = 'check_violation'; end if;
  if r.legacy_table = 'leave_change_requests' then
    perform public.change_request_withdraw(r.legacy_id, p_reason);
  elsif r.legacy_table = 'leave_requests' then
    perform public.request_withdraw(r.legacy_id, p_reason);
  else
    update public.request_headers set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_reason, '')), '') where id = p_id;
  end if;
end $$;

-- Every difference between a legacy request and its header (expected: none).
create or replace function public.request_legacy_drift()
returns table (legacy_table text, legacy_id uuid, header_id uuid, problem text)
language sql stable security definer set search_path = public as $$
  select 'leave_change_requests', c.id, h.id,
         case when h.id is null then 'no header'
              when h.legacy_status is distinct from c.status or h.status <> case c.status when 'requested' then 'submitted' else c.status end then 'status differs'
              when h.employee_id <> c.employee_id or h.start_date <> c.new_start or h.end_date is distinct from c.new_end then 'employee or dates differ'
              when l.replaces_record_ids is distinct from c.record_ids or l.old_start <> c.old_start or l.old_end <> c.old_end then 'original leave differs'
              else 'decision differs' end
    from public.leave_change_requests c
    left join public.request_headers h on h.legacy_table = 'leave_change_requests' and h.legacy_id = c.id
    left join public.request_leave l on l.header_id = h.id
   where public.app_is_staff()
     and (h.id is null or h.legacy_status is distinct from c.status or h.status <> case c.status when 'requested' then 'submitted' else c.status end
          or h.employee_id <> c.employee_id or h.start_date <> c.new_start or h.end_date is distinct from c.new_end
          or l.replaces_record_ids is distinct from c.record_ids or l.old_start is distinct from c.old_start or l.old_end is distinct from c.old_end
          or h.decided_at is distinct from c.decided_at or h.result_id is distinct from c.result_record_id)
  union all
  select 'leave_requests', f.id, h.id,
         case when h.id is null then 'no header'
              when h.legacy_status is distinct from f.status or h.status <> case when f.status in ('submitted', 'reviewed') then 'submitted' else f.status end then 'status differs'
              when h.employee_id <> f.employee_id or h.start_date <> f.start_date or h.end_date is distinct from f.end_date then 'employee or dates differ'
              else 'decision differs' end
    from public.leave_requests f
    left join public.request_headers h on h.legacy_table = 'leave_requests' and h.legacy_id = f.id
   where public.app_is_staff()
     and (h.id is null or h.legacy_status is distinct from f.status or h.status <> case when f.status in ('submitted', 'reviewed') then 'submitted' else f.status end
          or h.employee_id <> f.employee_id or h.start_date <> f.start_date or h.end_date is distinct from f.end_date
          or h.decided_at is distinct from f.decided_at or h.result_id is distinct from f.leave_record_id)
  union all
  select h.legacy_table, h.legacy_id, h.id, 'legacy request missing'
    from public.request_headers h
   where public.app_is_staff() and h.legacy_table is not null
     and not exists (select 1 from public.leave_change_requests c where h.legacy_table = 'leave_change_requests' and c.id = h.legacy_id)
     and not exists (select 1 from public.leave_requests f where h.legacy_table = 'leave_requests' and f.id = h.legacy_id)
  union all
  select h.legacy_table, h.legacy_id, null, format('%s headers for one request', count(*))
    from public.request_headers h
   where public.app_is_staff() and h.legacy_table is not null
   group by h.legacy_table, h.legacy_id having count(*) > 1;
$$;
revoke execute on function public.request_legacy_drift() from public, anon;
grant execute on function public.request_legacy_drift() to authenticated;

-- sync the existing rows again (idempotent: updates the same headers, fills legacy_status)
select public.request_mirror_change_row(c) from public.leave_change_requests c order by c.requested_at;
select public.request_mirror_form_row(f) from public.leave_requests f order by f.created_at;
