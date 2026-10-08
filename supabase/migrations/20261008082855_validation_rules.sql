-- Phase 1 step 3: validation framework.
-- validation_rules holds each check's severity (info / warning / critical / hard_stop), parameters and whether it is
-- on. The 7th duty day in a row and a rest of 0 hours or less are always hard stops (fixed); the minimum rest is a
-- parameter, off until the operational rule is confirmed. Shift times (Asia/Kuwait) are parameters too.
-- The app runs the checks (one engine for the rota, moves, day duty, covers and shutdown shifts) and sends what it
-- found with the request; a request whose check has a hard stop can be neither submitted nor approved.

create table public.validation_rules (
  code        text primary key,
  label       text not null,
  description text,
  severity    text not null check (severity in ('info', 'warning', 'critical', 'hard_stop')),
  enabled     boolean not null default true,
  params      jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid(),
  constraint vr_fixed_hard_stops check (code not in ('max_consecutive_duty_days', 'rest_between_duties') or (severity = 'hard_stop' and enabled))
);
alter table public.validation_rules enable row level security;
create policy validation_rules_staff_read on public.validation_rules for select to authenticated using (public.app_is_staff());
revoke insert, update, delete on public.validation_rules from anon, authenticated;
create trigger validation_rules_audit after insert or update or delete on public.validation_rules for each row execute function public.audit_row_change();

insert into public.validation_rules (code, label, description, severity, enabled, params) values
  ('max_consecutive_duty_days', 'Duty days in a row', 'The 7th duty day in a row is never allowed (the rota gives at most 6).', 'hard_stop', true, '{"max": 6}'),
  ('rest_between_duties', 'Rest between duties', 'A rest of 0 hours or less between two duties (from the actual start and end times) is never allowed.', 'hard_stop', true, '{}'),
  ('min_rest_hours', 'Minimum rest', 'Rest shorter than this many hours. Off until the operational rule is confirmed.', 'warning', false, '{"hours": null}'),
  ('leave_overlap', 'Leave on leave', 'New leave on days the person is already on leave.', 'hard_stop', true, '{}'),
  ('assignment_overlap', 'Two assignments at once', 'A move or cover on days the person already has another move, cover or shutdown team.', 'hard_stop', true, '{}'),
  ('crew_minimum', 'Crew below its minimum', 'The change leaves a crew below the minimum of the operating mode.', 'critical', true, '{}'),
  ('shift_times', 'Shift times', 'Start of each duty (Asia/Kuwait) and its length, used for the rest check.', 'info', true,
   '{"M": "07:00", "A": "15:00", "N": "23:00", "hours": 8, "dayDutyStart": "07:00", "dayDutyHours": 8}');

-- the Section Head sets a rule (the two fixed hard stops can only change their parameters)
create or replace function public.validation_rule_set(p_code text, p_severity text, p_enabled boolean, p_params jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can change a rule.' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from public.validation_rules where code = p_code) then raise exception 'Unknown rule.' using errcode = 'no_data_found'; end if;
  if p_code in ('max_consecutive_duty_days', 'rest_between_duties') and (p_severity <> 'hard_stop' or not p_enabled) then
    raise exception 'This rule is always a hard stop.' using errcode = 'check_violation';
  end if;
  update public.validation_rules set severity = p_severity, enabled = p_enabled, params = coalesce(p_params, params), updated_at = now(), updated_by = auth.uid()
   where code = p_code;
end $$;
revoke execute on function public.validation_rule_set(text, text, boolean, jsonb) from public, anon;
grant execute on function public.validation_rule_set(text, text, boolean, jsonb) to authenticated;

-- a check with a hard stop stops the request (internal)
create or replace function public.request_check_allows(p_check jsonb) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_check is not null and jsonb_path_exists(p_check, '$.findings[*] ? (@.severity == "hard_stop")') then
    raise exception 'This change has a hard stop: %', coalesce(jsonb_path_query_first(p_check, '$.findings[*] ? (@.severity == "hard_stop").message') #>> '{}', 'see the check')
      using errcode = 'check_violation';
  end if;
end $$;
revoke execute on function public.request_check_allows(jsonb) from public, anon, authenticated;

-- the check the app ran when the request was sent, kept with it (once, by the person who sent it, while it waits)
create or replace function public.request_header_record_check(p_id uuid, p_check jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r public.request_headers;
begin
  if not public.app_is_staff() then raise exception 'Not allowed.' using errcode = 'insufficient_privilege'; end if;
  select * into r from public.request_headers where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.check_at_submit is not null or r.requested_by is distinct from auth.uid() then return; end if;
  update public.request_headers set check_at_submit = p_check where id = p_id;
end $$;
revoke execute on function public.request_header_record_check(uuid, jsonb) from public, anon;
grant execute on function public.request_header_record_check(uuid, jsonb) to authenticated;

-- submit and decide refuse a hard stop (otherwise as before)
create or replace function public.request_header_submit(p_type text, p_employee uuid, p_plan_year integer, p_summary text, p_remarks text,
  p_detail jsonb, p_check jsonb default null, p_source text default null, p_package uuid default null, p_workflow text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_res uuid; v_head boolean; v_workflow text; v_source text; v_start date; v_end date; v_status text;
begin
  if not public.app_is_staff() then
    raise exception 'Only the Section Head or the Manpower Coordinator can make this change.' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_summary, '')), '') is null then raise exception 'Describe the change.' using errcode = 'check_violation'; end if;
  if p_employee is null then raise exception 'Choose the employee.' using errcode = 'check_violation'; end if;
  if p_plan_year is null then raise exception 'The plan year is missing.' using errcode = 'check_violation'; end if;
  perform public.request_check_allows(p_check);
  v_head := public.app_is_section_head();
  v_start := (p_detail->>'start_date')::date;
  v_end := coalesce((p_detail->>'end_date')::date, case when p_detail->>'return_date' is not null then (p_detail->>'return_date')::date - 1 end);
  if v_start is null then raise exception 'Enter the first day.' using errcode = 'check_violation'; end if;
  -- workflow
  if p_workflow is not null then
    v_workflow := p_workflow;
  elsif p_type in ('unscheduled_pv', 'personal_pc', 'absence') then
    select workflow into v_workflow from public.absence_types where code = p_detail->>'absence_type_code';
    if v_workflow is null then
      raise exception 'This leave type is not configured yet (record or approval): it cannot be submitted. Ask the Section Head to set it.' using errcode = 'check_violation';
    end if;
  else
    v_workflow := 'approval';
  end if;
  -- source
  v_source := coalesce(p_source, case when v_head then 'section_head_direct' else 'normal_request' end);
  if v_source not in ('normal_request', 'shutdown', 'section_head_direct', 'system') then raise exception 'Unknown source %.', v_source using errcode = 'check_violation'; end if;
  if v_source = 'section_head_direct' and not v_head then raise exception 'Only the Section Head makes direct changes.' using errcode = 'insufficient_privilege'; end if;
  -- the same request already waiting
  if exists (select 1 from public.request_headers r where r.status = 'submitted' and r.type = p_type and r.employee_id = p_employee
             and daterange(r.start_date, coalesce(r.end_date, 'infinity'::date), '[]') && daterange(v_start, coalesce(v_end, 'infinity'::date), '[]')) then
    raise exception 'A request of this type for this person on these dates is already waiting for the Section Head.' using errcode = 'check_violation';
  end if;
  v_status := case when v_head and v_workflow = 'approval' then 'approved' when v_workflow = 'approval' then 'submitted' else 'recorded' end;
  insert into public.request_headers (type, employee_id, source, workflow, status, plan_year, start_date, end_date, summary, remarks, package_id,
                                      check_at_submit, decided_by, decided_at)
  values (p_type, p_employee, v_source, v_workflow, v_status, p_plan_year, v_start, v_end, btrim(p_summary), nullif(btrim(coalesce(p_remarks, '')), ''),
          p_package, p_check, case when v_status <> 'submitted' then auth.uid() end, case when v_status <> 'submitted' then now() end)
  returning id into v_id;
  perform public.request_detail_insert(v_id, p_type, p_detail);
  if v_status = 'submitted' then
    -- the same checks as the change itself: made, then undone
    begin
      perform public.request_apply(v_id);
      raise exception using errcode = 'P0099', message = 'request dry run';
    exception when sqlstate 'P0099' then null;
    end;
  else
    v_res := public.request_apply(v_id);
    update public.request_headers set result_id = v_res, result_table = public.request_result_table(p_type) where id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'status', v_status, 'result', v_res);
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
