-- Approvals: changes the Manpower Coordinator makes wait for the Section Head before they touch the plan.
-- Kinds: unplanned / sick leave added by hand (leave), shift movements (temporary cover, permanent move, day duty),
-- VR placements, task releases and Controller covers. The Section Head's own changes apply at once and are kept here as
-- approved, so every change of these kinds has one history. A request is checked against the same rules when it is
-- made (a dry run of the change, rolled back) and again when it is approved (the change itself).
create table public.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('leave', 'movement', 'vr_placement', 'task_release', 'controller_cover')),
  employee_id   uuid not null references public.employees (id),
  start_date    date not null,
  end_date      date,
  summary       text not null check (length(btrim(summary)) > 0),
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'not_approved', 'withdrawn')),
  requested_by  uuid default auth.uid(),
  requested_at  timestamptz not null default now(),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  result_id     text,
  constraint ar_dates check (end_date is null or end_date >= start_date)
);
create index approval_requests_open on public.approval_requests (requested_at) where status = 'pending';
create index approval_requests_employee on public.approval_requests (employee_id);

alter table public.approval_requests enable row level security;
create policy ar_staff_read on public.approval_requests for select to authenticated using (public.app_is_staff());
revoke insert, update, delete on public.approval_requests from authenticated, anon;
create trigger approval_requests_audit after insert or update or delete on public.approval_requests for each row execute function public.audit_row_change();

-- The change itself, through the same functions and checks as before. Internal: never called by the app directly.
create or replace function public.approval_apply(p_kind text, p_employee uuid, p_start date, p_end date, p_payload jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_kind = 'leave' then
    v_id := public.leave_save(null, p_employee, p_payload->>'type', p_start, p_end, p_payload->>'note');
  elsif p_kind = 'movement' then
    v_id := public.crew_move(p_employee, p_payload->>'kind', p_payload->>'to', p_start, p_end, p_payload->>'reason');
  elsif p_kind = 'vr_placement' then
    v_id := public.vr_place(p_employee, p_payload->>'crew', p_start, p_payload->>'reason');
  elsif p_kind = 'task_release' then
    insert into public.task_releases (employee_id, start_date, end_date, from_time, to_time, task)
    values (p_employee, p_start, p_end, nullif(p_payload->>'from_time', '')::time, nullif(p_payload->>'to_time', '')::time, p_payload->>'task')
    returning id into v_id;
  elsif p_kind = 'controller_cover' then
    insert into public.controller_assignments (kind, employee_id, crew_code, covers_employee_id, start_date, end_date, note)
    values (p_payload->>'kind', p_employee, nullif(p_payload->>'crew_code', ''), nullif(p_payload->>'covers_employee_id', '')::uuid, p_start, p_end, nullif(p_payload->>'note', ''))
    returning id into v_id;
  else
    raise exception 'Unknown request type %.', p_kind using errcode = 'check_violation';
  end if;
  return v_id::text;
end $$;
revoke execute on function public.approval_apply(text, uuid, date, date, jsonb) from public, anon, authenticated;

-- Make a change: the Section Head's applies at once (kept as approved); the Coordinator's is checked, then waits.
create or replace function public.approval_submit(p_kind text, p_employee uuid, p_start date, p_end date, p_summary text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_res text;
begin
  if not public.app_is_staff() then
    raise exception 'Only the Section Head or the Manpower Coordinator can make this change.' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_summary, '')), '') is null then raise exception 'Describe the change.' using errcode = 'check_violation'; end if;
  if public.app_is_section_head() then
    v_res := public.approval_apply(p_kind, p_employee, p_start, p_end, coalesce(p_payload, '{}'::jsonb));
    insert into public.approval_requests (kind, employee_id, start_date, end_date, summary, payload, status, decided_by, decided_at, result_id)
    values (p_kind, p_employee, p_start, p_end, btrim(p_summary), coalesce(p_payload, '{}'::jsonb), 'approved', auth.uid(), now(), v_res)
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'status', 'approved', 'result', v_res);
  end if;
  if exists (select 1 from public.approval_requests r where r.status = 'pending' and r.kind = p_kind and r.employee_id = p_employee
             and daterange(r.start_date, coalesce(r.end_date, 'infinity'::date), '[]') && daterange(p_start, coalesce(p_end, 'infinity'::date), '[]')) then
    raise exception 'A request of this type for this person on these dates is already waiting for the Section Head.' using errcode = 'check_violation';
  end if;
  -- the same checks as the change itself: made, then undone
  begin
    perform public.approval_apply(p_kind, p_employee, p_start, p_end, coalesce(p_payload, '{}'::jsonb));
    raise exception using errcode = 'P0099', message = 'approval dry run';
  exception when sqlstate 'P0099' then null;
  end;
  insert into public.approval_requests (kind, employee_id, start_date, end_date, summary, payload)
  values (p_kind, p_employee, p_start, p_end, btrim(p_summary), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'status', 'pending');
end $$;
revoke execute on function public.approval_submit(text, uuid, date, date, text, jsonb) from public, anon;
grant execute on function public.approval_submit(text, uuid, date, date, text, jsonb) to authenticated;

-- The Section Head decides: approving makes the change (refused, and the request kept waiting, if it no longer fits).
create or replace function public.approval_decide(p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.approval_requests; v_res text;
begin
  if not public.app_is_section_head() then
    raise exception 'Only the Section Head can approve or not approve.' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.approval_requests where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.status <> 'pending' then raise exception 'This request is already %.', replace(r.status, '_', ' ') using errcode = 'check_violation'; end if;
  if p_approve then
    v_res := public.approval_apply(r.kind, r.employee_id, r.start_date, r.end_date, r.payload);
    update public.approval_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''), result_id = v_res where id = p_id;
  else
    update public.approval_requests set status = 'not_approved', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_id;
  end if;
  return jsonb_build_object('id', p_id, 'status', case when p_approve then 'approved' else 'not_approved' end, 'result', v_res);
end $$;
revoke execute on function public.approval_decide(uuid, boolean, text) from public, anon;
grant execute on function public.approval_decide(uuid, boolean, text) to authenticated;

-- Take back a request still waiting (the person who made it, or the Section Head).
create or replace function public.approval_withdraw(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.approval_requests;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can withdraw a request.' using errcode = 'insufficient_privilege'; end if;
  select * into r from public.approval_requests where id = p_id for update;
  if not found then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.status <> 'pending' then raise exception 'Only a request still waiting can be withdrawn.' using errcode = 'check_violation'; end if;
  update public.approval_requests set status = 'withdrawn', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_reason, '')), '') where id = p_id;
end $$;
revoke execute on function public.approval_withdraw(uuid, text) from public, anon;
grant execute on function public.approval_withdraw(uuid, text) to authenticated;
