-- Leave on leave becomes Critical (Section Head decision, 8 Oct 2026): sick leave during PV may be approved. When it
-- is, the other leave gives up the overlapping days first: it becomes a new, shorter version (one or two pieces), the
-- old version stays in the history, and the new leave is saved on the freed days. Only when the check the request
-- was sent with shows the overlap (the Section Head sees it and accepts it by approving).

update public.validation_rules set severity = 'critical', updated_at = now()
 where code = 'leave_overlap';

-- the leave of `p_employee` overlapping p_start..p_end gives up those days (internal)
create or replace function public.leave_make_room(p_employee uuid, p_start date, p_end date, p_header uuid, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare o public.leave_records; v_first uuid; v_new uuid; n integer := 0;
begin
  for o in select * from public.leave_records
            where employee_id = p_employee and in_current_plan and status in ('approved', 'planned')
              and start_date <= p_end and end_date >= p_start
            order by start_date for update loop
    v_first := null;
    if o.start_date < p_start then
      insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref, review_status, note,
                                        in_original_plan, in_current_plan, rescheduled_from, hand_corrected, origin, request_header_id, change_reason)
      values (o.employee_id, o.absence_type_code, o.start_date, p_start - 1, o.status, 'manual', 'Shortened by a request', 'none', o.note,
              false, true, o.id, true, 'request', p_header, p_reason)
      returning id into v_new;
      v_first := v_new;
    end if;
    if o.end_date > p_end then
      insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref, review_status, note,
                                        in_original_plan, in_current_plan, rescheduled_from, hand_corrected, origin, request_header_id, change_reason)
      values (o.employee_id, o.absence_type_code, p_end + 1, o.end_date, o.status, 'manual', 'Shortened by a request', 'none', o.note,
              false, true, o.id, true, 'request', p_header, p_reason)
      returning id into v_new;
      v_first := coalesce(v_first, v_new);
    end if;
    update public.leave_records set in_current_plan = false, status = 'rescheduled', superseded_by = v_first, hand_corrected = true,
      note = concat_ws(' | ', note, p_reason)
    where id = o.id;
    insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, current_record_id, from_start, from_end, to_start, to_end, note, by_hand)
    values (o.employee_id, 'corrected', o.id, v_first, o.start_date, o.end_date,
            case when v_first is not null then (select start_date from public.leave_records where id = v_first) end,
            case when v_first is not null then (select max(end_date) from public.leave_records where rescheduled_from = o.id and in_current_plan) end,
            p_reason, true);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.leave_make_room(uuid, date, date, uuid, text) from public, anon, authenticated;

create or replace function public.request_apply(p_header uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare h public.request_headers; l public.request_leave; s public.request_shift; a public.request_assignment; sd public.request_shutdown;
        v_id uuid; v_type text; v_note text;
begin
  select * into h from public.request_headers where id = p_header;
  perform set_config('app.plan_year', h.plan_year::text, true);
  v_note := coalesce(nullif(btrim(coalesce(h.remarks, '')), ''), h.summary);
  if h.type in ('unscheduled_pv', 'personal_pc', 'absence') then
    select * into l from public.request_leave where header_id = p_header;
    -- leave on leave (critical), shown by the check the request was sent with and accepted by approving it: the other
    -- leave gives up these days first (also in the dry run when the request is sent)
    if jsonb_path_exists(coalesce(h.accepted_findings, '[]'::jsonb) || coalesce(h.check_at_submit->'findings', '[]'::jsonb),
         '$[*] ? (@.rule == "leave_overlap")') then
      perform public.leave_make_room(h.employee_id, l.start_date, l.end_date, p_header, format('Days taken by %s', coalesce((select label from public.absence_types where code = l.absence_type_code), 'other leave')));
    end if;
    v_id := public.leave_save(null, h.employee_id, l.absence_type_code, l.start_date, l.end_date, v_note);
    if l.estimated then perform public.leave_set_estimated(v_id, true); end if;
    update public.request_leave set created_record_id = v_id where header_id = p_header;
  elsif h.type = 'pv_reschedule' then
    select * into l from public.request_leave where header_id = p_header;
    if array_length(l.replaces_record_ids, 1) is distinct from 1 then
      raise exception 'Choose the one PV to move.' using errcode = 'check_violation';
    end if;
    select coalesce(absence_type_code, 'annual_leave_planned') into v_type from public.leave_records where id = l.replaces_record_ids[1];
    v_id := public.leave_save(l.replaces_record_ids[1], null, v_type, l.start_date, l.end_date, v_note);
    update public.request_leave set created_record_id = v_id where header_id = p_header;
  elsif h.type = 'shift_change' then
    select * into s from public.request_shift where header_id = p_header;
    v_id := public.crew_move(h.employee_id, case when s.kind = 'permanent' then 'permanent' else 'temporary' end,
                             case when s.kind = 'day_duty' then 'DAY' else s.to_crew end, s.start_date, s.return_date - 1, coalesce(s.reason, v_note));
    update public.request_shift set movement_id = v_id where header_id = p_header;
  elsif h.type = 'vr_placement' then
    select * into a from public.request_assignment where header_id = p_header;
    v_id := public.vr_place(h.employee_id, a.crew_code, a.start_date, coalesce(a.reason, v_note));
    update public.request_assignment set result_id = v_id where header_id = p_header;
  elsif h.type = 'controller_cover' then
    select * into a from public.request_assignment where header_id = p_header;
    insert into public.controller_assignments (kind, employee_id, crew_code, covers_employee_id, start_date, end_date, note)
    values (coalesce(a.cover_kind, 'shift_cover'), h.employee_id, a.crew_code, a.covers_employee_id, a.start_date, a.end_date, a.reason)
    returning id into v_id;
    update public.request_assignment set result_id = v_id where header_id = p_header;
  elsif h.type = 'task_release' then
    select * into a from public.request_assignment where header_id = p_header;
    insert into public.task_releases (employee_id, start_date, end_date, from_time, to_time, task)
    values (h.employee_id, a.start_date, a.end_date, a.from_time, a.to_time, a.task)
    returning id into v_id;
    update public.request_assignment set result_id = v_id where header_id = p_header;
  elsif h.type = 'shutdown_adjustment' then
    select * into sd from public.request_shutdown where header_id = p_header;
    if sd.phase = 'join' and sd.follow_crew is not null and sd.end_date is not null then
      v_id := public.crew_move(h.employee_id, 'temporary', sd.follow_crew, sd.start_date, sd.end_date, v_note);
      update public.request_shutdown set movement_id = v_id where header_id = p_header;
    end if;
  else
    raise exception 'This request type (%) is applied by its own page.', h.type using errcode = 'check_violation';
  end if;
  perform set_config('app.plan_year', '', true);
  return v_id;
end $$;

create or replace function public.request_header_decide(p_id uuid, p_approve boolean, p_note text, p_check jsonb default null, p_accepted jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.request_headers; v_res uuid;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can approve or not approve.' using errcode = 'insufficient_privilege'; end if;
  if p_approve is null then raise exception 'Choose Approve or Not approve.' using errcode = 'check_violation'; end if;
  select * into r from public.request_headers where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.status <> 'submitted' then raise exception 'This request is already %.', replace(r.status, '_', ' ') using errcode = 'check_violation'; end if;
  if p_approve then perform public.request_check_allows(p_check); end if;
  -- what the Section Head accepted is known before the change is made (request_apply reads it)
  update public.request_headers set check_at_decision = p_check, accepted_findings = coalesce(p_accepted, '[]'::jsonb) where id = p_id;
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
