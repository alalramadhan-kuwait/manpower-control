-- Phase 1 · Step 1: the request / history foundation.
-- One request header for every kind of manpower change (who, what type, where it came from, its workflow and status,
-- who asked and decided, the checks seen at submission and at the decision, the warnings accepted), and one detail
-- table per kind. Grouped requests (a shutdown's adjustments) share a package. Additive: nothing is dropped.
-- - The yesterday approval functions (approval_submit / approval_decide / approval_withdraw) keep their signatures and
--   now write here; approval_requests is left in place, read-only (legacy).
-- - Leave forms (leave_requests) and reschedule requests (leave_change_requests) keep their own functions for now and
--   are mirrored here by triggers, so every request is in one history. The existing rows are mirrored once.

create table public.request_packages (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('shutdown')),
  sd_plan_id  uuid references public.sd_plans (id),
  title       text not null check (length(btrim(title)) > 0),
  plan_year   integer not null check (plan_year between 2000 and 2100),
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create table public.request_headers (
  id                 uuid primary key default gen_random_uuid(),
  type               text not null check (type in ('pv_reschedule', 'unscheduled_pv', 'personal_pc', 'absence', 'leave_form', 'shift_change',
                                                   'vr_placement', 'controller_cover', 'task_release', 'shutdown_adjustment')),
  employee_id        uuid not null references public.employees (id),
  source             text not null check (source in ('normal_request', 'shutdown', 'section_head_direct', 'system')),
  workflow           text not null check (workflow in ('approval', 'record', 'record_notify')),
  status             text not null default 'submitted' check (status in ('submitted', 'approved', 'not_approved', 'withdrawn', 'recorded')),
  plan_year          integer not null check (plan_year between 2000 and 2100),
  start_date         date not null,
  end_date           date,
  summary            text not null check (length(btrim(summary)) > 0),
  remarks            text,
  package_id         uuid references public.request_packages (id),
  requested_by       uuid default auth.uid(),
  requested_at       timestamptz not null default now(),
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  check_at_submit    jsonb,
  check_at_decision  jsonb,
  accepted_findings  jsonb not null default '[]'::jsonb,
  result_table       text,
  result_id          uuid,
  legacy_table       text,
  legacy_id          uuid,
  constraint rh_dates check (end_date is null or end_date >= start_date),
  constraint rh_legacy unique (legacy_table, legacy_id)
);
create index request_headers_open on public.request_headers (requested_at) where status = 'submitted';
create index request_headers_employee on public.request_headers (employee_id, start_date);
create index request_headers_package on public.request_headers (package_id) where package_id is not null;

-- leave: unscheduled PV, Personal PC, absences, PV reschedules and (mirrored) leave forms
create table public.request_leave (
  header_id           uuid primary key references public.request_headers (id),
  absence_type_code   text references public.absence_types (code),
  start_date          date not null,
  end_date            date not null,
  estimated           boolean not null default false,
  replaces_record_ids uuid[] not null default '{}',
  old_start           date,
  old_end             date,
  created_record_id   uuid,
  constraint rl_dates check (end_date >= start_date)
);

-- normal shift change: temporary (back on the return date), permanent, day duty
create table public.request_shift (
  header_id    uuid primary key references public.request_headers (id),
  kind         text not null check (kind in ('temporary', 'permanent', 'day_duty')),
  from_crew    text check (from_crew in ('A', 'B', 'C', 'D')),
  to_crew      text check (to_crew in ('A', 'B', 'C', 'D')),
  start_date   date not null,
  return_date  date,
  reason       text,
  movement_id  uuid,
  constraint rs_return check (return_date is null or return_date > start_date),
  constraint rs_permanent check (kind <> 'permanent' or return_date is null),
  constraint rs_crew check (kind = 'day_duty' or to_crew is not null)
);

-- VR placement, Controller cover, task release
create table public.request_assignment (
  header_id           uuid primary key references public.request_headers (id),
  kind                text not null check (kind in ('vr_placement', 'controller_cover', 'task_release')),
  crew_code           text check (crew_code in ('A', 'B', 'C', 'D')),
  cover_kind          text check (cover_kind in ('shift_cover', 'morning_rotation')),
  covers_employee_id  uuid references public.employees (id),
  start_date          date not null,
  end_date            date,
  from_time           time,
  to_time             time,
  task                text,
  reason              text,
  result_id           uuid
);

-- shutdown adjustments: joining (follow another crew before / on the team) and return (rest, then the own rota)
create table public.request_shutdown (
  header_id     uuid primary key references public.request_headers (id),
  sd_plan_id    uuid not null references public.sd_plans (id),
  sd_member_id  uuid references public.sd_members (id),
  phase         text not null check (phase in ('join', 'return')),
  follow_crew   text check (follow_crew in ('A', 'B', 'C', 'D')),
  start_date    date not null,
  end_date      date,
  rest_days     integer check (rest_days >= 0),
  rejoin_date   date,
  movement_id   uuid
);

alter table public.request_packages enable row level security;
alter table public.request_headers enable row level security;
alter table public.request_leave enable row level security;
alter table public.request_shift enable row level security;
alter table public.request_assignment enable row level security;
alter table public.request_shutdown enable row level security;
create policy rp_staff_read on public.request_packages for select to authenticated using (public.app_is_staff());
create policy rh_staff_read on public.request_headers for select to authenticated using (public.app_is_staff());
create policy rl_staff_read on public.request_leave for select to authenticated using (public.app_is_staff());
create policy rs_staff_read on public.request_shift for select to authenticated using (public.app_is_staff());
create policy ra_staff_read on public.request_assignment for select to authenticated using (public.app_is_staff());
create policy rsd_staff_read on public.request_shutdown for select to authenticated using (public.app_is_staff());
revoke insert, update, delete on public.request_packages, public.request_headers, public.request_leave, public.request_shift,
  public.request_assignment, public.request_shutdown from authenticated, anon;
create trigger request_packages_audit after insert or update or delete on public.request_packages for each row execute function public.audit_row_change();
create trigger request_headers_audit after insert or update or delete on public.request_headers for each row execute function public.audit_row_change();
create trigger request_leave_audit after insert or update or delete on public.request_leave for each row execute function public.audit_row_change();
create trigger request_shift_audit after insert or update or delete on public.request_shift for each row execute function public.audit_row_change();
create trigger request_assignment_audit after insert or update or delete on public.request_assignment for each row execute function public.audit_row_change();
create trigger request_shutdown_audit after insert or update or delete on public.request_shutdown for each row execute function public.audit_row_change();

-- Absence types: how a type is entered. Left empty (unconfigured) on purpose: an unconfigured type cannot be submitted
-- through the new entry until the Section Head sets it.
alter table public.absence_types add column workflow text check (workflow in ('approval', 'record', 'record_notify'));
insert into public.absence_types (code, label, short_code, reduces_manpower, requires_approval, is_active, sort_order)
values ('injury', 'Injury', 'INJ', true, false, true, 31)
on conflict (code) do nothing;

-- the detail rows of a request, from its JSON form (internal)
create or replace function public.request_detail_insert(p_header uuid, p_type text, d jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_type in ('pv_reschedule', 'unscheduled_pv', 'personal_pc', 'absence') then
    insert into public.request_leave (header_id, absence_type_code, start_date, end_date, estimated, replaces_record_ids, old_start, old_end)
    values (p_header, d->>'absence_type_code', (d->>'start_date')::date, (d->>'end_date')::date, coalesce((d->>'estimated')::boolean, false),
            coalesce(array(select jsonb_array_elements_text(d->'replaces_record_ids'))::uuid[], '{}'), (d->>'old_start')::date, (d->>'old_end')::date);
  elsif p_type = 'shift_change' then
    insert into public.request_shift (header_id, kind, from_crew, to_crew, start_date, return_date, reason)
    values (p_header, d->>'kind', nullif(d->>'from_crew', ''), nullif(d->>'to_crew', ''), (d->>'start_date')::date, (d->>'return_date')::date, nullif(d->>'reason', ''));
  elsif p_type in ('vr_placement', 'controller_cover', 'task_release') then
    insert into public.request_assignment (header_id, kind, crew_code, cover_kind, covers_employee_id, start_date, end_date, from_time, to_time, task, reason)
    values (p_header, p_type, nullif(d->>'crew_code', ''), nullif(d->>'cover_kind', ''), nullif(d->>'covers_employee_id', '')::uuid,
            (d->>'start_date')::date, (d->>'end_date')::date, nullif(d->>'from_time', '')::time, nullif(d->>'to_time', '')::time, nullif(d->>'task', ''), nullif(d->>'reason', ''));
  elsif p_type = 'shutdown_adjustment' then
    insert into public.request_shutdown (header_id, sd_plan_id, sd_member_id, phase, follow_crew, start_date, end_date, rest_days, rejoin_date)
    values (p_header, (d->>'sd_plan_id')::uuid, nullif(d->>'sd_member_id', '')::uuid, d->>'phase', nullif(d->>'follow_crew', ''),
            (d->>'start_date')::date, (d->>'end_date')::date, (d->>'rest_days')::integer, (d->>'rejoin_date')::date);
  else
    raise exception 'This request type (%) is not entered here.', p_type using errcode = 'check_violation';
  end if;
end $$;
revoke execute on function public.request_detail_insert(uuid, text, jsonb) from public, anon, authenticated;

-- Make the change a request asks for, through the same functions and checks as a direct change (internal).
-- Returns the record it created; the detail row keeps the link.
create or replace function public.request_apply(p_header uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare h public.request_headers; l public.request_leave; s public.request_shift; a public.request_assignment; sd public.request_shutdown;
        v_id uuid; v_type text; v_note text;
begin
  select * into h from public.request_headers where id = p_header;
  v_note := coalesce(nullif(btrim(coalesce(h.remarks, '')), ''), h.summary);
  if h.type in ('unscheduled_pv', 'personal_pc', 'absence') then
    select * into l from public.request_leave where header_id = p_header;
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
  return v_id;
end $$;
revoke execute on function public.request_apply(uuid) from public, anon, authenticated;

-- Make a request. The Section Head's own change applies at once (source section_head_direct, status approved); a record
-- applies at once (status recorded); an approval request is checked by a dry run of the change, then waits.
-- p_workflow is only for the legacy entry points: the new entry takes the workflow from the absence type (an
-- unconfigured type cannot be submitted).
create or replace function public.request_submit(p_type text, p_employee uuid, p_plan_year integer, p_summary text, p_remarks text,
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

create or replace function public.request_result_table(p_type text)
returns text language sql immutable set search_path = public as $$
  select case when p_type in ('pv_reschedule', 'unscheduled_pv', 'personal_pc', 'absence', 'leave_form') then 'leave_records'
              when p_type in ('shift_change', 'vr_placement', 'shutdown_adjustment') then 'crew_movements'
              when p_type = 'controller_cover' then 'controller_assignments'
              when p_type = 'task_release' then 'task_releases' end
$$;

-- The Section Head decides: approving re-applies every check through the change itself. The checks seen at the
-- decision and the warnings accepted are kept with the request.
create or replace function public.request_decide(p_id uuid, p_approve boolean, p_note text, p_check jsonb default null, p_accepted jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.request_headers; v_res uuid;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can approve or not approve.' using errcode = 'insufficient_privilege'; end if;
  if p_approve is null then raise exception 'Choose Approve or Not approve.' using errcode = 'check_violation'; end if;
  select * into r from public.request_headers where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.legacy_table is not null then raise exception 'Decide this request on its own page.' using errcode = 'check_violation'; end if;
  if r.status <> 'submitted' then raise exception 'This request is already %.', replace(r.status, '_', ' ') using errcode = 'check_violation'; end if;
  if p_approve then v_res := public.request_apply(p_id); end if;
  update public.request_headers set status = case when p_approve then 'approved' else 'not_approved' end, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_note, '')), ''), check_at_decision = p_check, accepted_findings = coalesce(p_accepted, '[]'::jsonb),
    result_id = v_res, result_table = case when p_approve then public.request_result_table(r.type) end
  where id = p_id;
  return jsonb_build_object('id', p_id, 'status', case when p_approve then 'approved' else 'not_approved' end, 'result', v_res);
end $$;

create or replace function public.request_withdraw(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.request_headers;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can withdraw a request.' using errcode = 'insufficient_privilege'; end if;
  select * into r from public.request_headers where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.legacy_table is not null then raise exception 'Withdraw this request on its own page.' using errcode = 'check_violation'; end if;
  if r.status <> 'submitted' then raise exception 'Only a request still waiting can be withdrawn.' using errcode = 'check_violation'; end if;
  update public.request_headers set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_reason, '')), '') where id = p_id;
end $$;

revoke execute on function public.request_submit(text, uuid, integer, text, text, jsonb, jsonb, text, uuid, text) from public, anon;
revoke execute on function public.request_decide(uuid, boolean, text, jsonb, jsonb) from public, anon;
revoke execute on function public.request_withdraw(uuid, text) from public, anon;
grant execute on function public.request_submit(text, uuid, integer, text, text, jsonb, jsonb, text, uuid, text) to authenticated;
grant execute on function public.request_decide(uuid, boolean, text, jsonb, jsonb) to authenticated;
grant execute on function public.request_withdraw(uuid, text) to authenticated;

-- The approval functions the app calls today keep their signatures and now write the new tables (approval_requests is
-- no longer written: legacy, read-only). Same behaviour as before: these kinds wait for the Section Head.
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
  r := public.request_submit(v_type, p_employee, extract(year from p_start)::integer, p_summary, case when p_kind = 'leave' then p->>'note' end, v_detail, null, null, null, 'approval');
  return jsonb_build_object('id', r->>'id', 'status', case when r->>'status' = 'submitted' then 'pending' else 'approved' end, 'result', r->>'result');
end $$;

create or replace function public.approval_decide(p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public.request_decide(p_id, p_approve, p_note, null, '[]'::jsonb);
end $$;

create or replace function public.approval_withdraw(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.request_withdraw(p_id, p_reason);
end $$;

-- Mirrors: leave forms and reschedule requests stay on their own pages for now; every change to them is copied to the
-- request history (header + leave detail), keyed by the legacy row.
create or replace function public.request_mirror_change_row(c public.leave_change_requests) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type text;
begin
  select coalesce(absence_type_code, 'annual_leave_planned') into v_type from public.leave_records where id = c.record_ids[1];
  insert into public.request_headers (type, employee_id, source, workflow, status, plan_year, start_date, end_date, summary, remarks,
    requested_by, requested_at, decided_by, decided_at, decision_note, result_table, result_id, legacy_table, legacy_id)
  values ('pv_reschedule', c.employee_id, 'normal_request', 'approval',
    case c.status when 'requested' then 'submitted' else c.status end,
    extract(year from c.old_start)::integer, c.new_start, c.new_end,
    format('PV %s – %s → %s – %s', to_char(c.old_start, 'FMDD Mon'), to_char(c.old_end, 'FMDD Mon'), to_char(c.new_start, 'FMDD Mon'), to_char(c.new_end, 'FMDD Mon YYYY')),
    c.remark, c.requested_by, c.requested_at, c.decided_by, c.decided_at, coalesce(c.decision_remarks, c.withdraw_reason),
    case when c.result_record_id is not null then 'leave_records' end, c.result_record_id, 'leave_change_requests', c.id)
  on conflict (legacy_table, legacy_id) do update set status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at,
    decision_note = excluded.decision_note, result_table = excluded.result_table, result_id = excluded.result_id, start_date = excluded.start_date,
    end_date = excluded.end_date, summary = excluded.summary, remarks = excluded.remarks
  returning id into v_id;
  insert into public.request_leave (header_id, absence_type_code, start_date, end_date, replaces_record_ids, old_start, old_end, created_record_id)
  values (v_id, v_type, c.new_start, c.new_end, c.record_ids, c.old_start, c.old_end, c.result_record_id)
  on conflict (header_id) do update set start_date = excluded.start_date, end_date = excluded.end_date, created_record_id = excluded.created_record_id;
end $$;
revoke execute on function public.request_mirror_change_row(public.leave_change_requests) from public, anon, authenticated;
create or replace function public.request_mirror_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.request_mirror_change_row(new);
  return new;
end $$;
create trigger leave_change_requests_mirror after insert or update on public.leave_change_requests for each row execute function public.request_mirror_change();

create or replace function public.request_mirror_form_row(f public.leave_requests) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.request_headers (type, employee_id, source, workflow, status, plan_year, start_date, end_date, summary, remarks,
    requested_by, requested_at, decided_by, decided_at, decision_note, result_table, result_id, legacy_table, legacy_id)
  values ('leave_form', f.employee_id, 'normal_request', 'approval',
    case when f.status in ('submitted', 'reviewed') then 'submitted' else f.status end,
    extract(year from f.start_date)::integer, f.start_date, f.end_date,
    format('Leave form (%s) %s – %s', f.request_type, to_char(f.start_date, 'FMDD Mon'), to_char(f.end_date, 'FMDD Mon YYYY')),
    f.reason, f.entered_by, f.created_at, f.decided_by, f.decided_at, coalesce(f.decision_remarks, f.withdraw_reason),
    case when f.leave_record_id is not null then 'leave_records' end, f.leave_record_id, 'leave_requests', f.id)
  on conflict (legacy_table, legacy_id) do update set status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at,
    decision_note = excluded.decision_note, result_table = excluded.result_table, result_id = excluded.result_id, start_date = excluded.start_date,
    end_date = excluded.end_date, summary = excluded.summary, remarks = excluded.remarks, plan_year = excluded.plan_year
  returning id into v_id;
  insert into public.request_leave (header_id, absence_type_code, start_date, end_date, created_record_id)
  values (v_id, public.request_type_code(f.request_type), f.start_date, f.end_date, f.leave_record_id)
  on conflict (header_id) do update set absence_type_code = excluded.absence_type_code, start_date = excluded.start_date, end_date = excluded.end_date,
    created_record_id = excluded.created_record_id;
end $$;
revoke execute on function public.request_mirror_form_row(public.leave_requests) from public, anon, authenticated;
create or replace function public.request_mirror_form() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.request_mirror_form_row(new);
  return new;
end $$;
create trigger leave_requests_mirror after insert or update on public.leave_requests for each row execute function public.request_mirror_form();

-- the existing rows, once (read only: the legacy rows themselves are not touched)
select public.request_mirror_change_row(c) from public.leave_change_requests c order by c.requested_at;
select public.request_mirror_form_row(f) from public.leave_requests f order by f.created_at;
