-- Phase 1 step 2: leave versioning, origin and an explicit plan year.
-- * A leave's dates are never changed in place, whatever its origin: a date change is a new version (linked by
--   rescheduled_from / superseded_by, same root_id, version_no + 1) and the old version stays in the history. A guard
--   trigger refuses any in-place change of employee, dates, plan year or version links.
-- * origin: how the version came to be (import / manual / request / oracle_correction / system); request_header_id: the
--   request that produced it; change_reason: why.
-- * plan_year: the plan the leave belongs to (a 2026 PV moved into January 2027 stays in plan 2026); inherited by every
--   later version. plan_years says which year is the Active Plan; next year's PV is planned in the PV plan, never
--   added to the active plan by hand.
-- * The backfill of the new columns is metadata, not an operational change: it runs inside a migration window in
--   which touch_updated_at and audit_row_change skip their work (only while app.migration =
--   'leave_versioning_backfill', set for this transaction), then both functions are restored exactly. The migration
--   stops if any leave date, status, plan flag, updated_at or the audit log changed.

-- migration window: the shared trigger functions skip their work for this backfill only
create or replace function public.touch_updated_at()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if current_setting('app.migration', true) = 'leave_versioning_backfill' then return new; end if;
  new.updated_at := now(); return new;
end $function$;
create or replace function public.audit_row_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_emp uuid;
  v_id  uuid;
begin
  if current_setting('app.migration', true) = 'leave_versioning_backfill' then return coalesce(new, old); end if;
  if tg_table_name = 'employees' then
    v_emp := (v_row->>'id')::uuid;
  else
    v_emp := nullif(v_row->>'employee_id','')::uuid;
  end if;
  if (v_row->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := (v_row->>'id')::uuid;
  end if;
  insert into public.audit_log (actor_id, entity_table, entity_id, action, previous, next, related_employee_id, batch_id)
  values (
    auth.uid(), tg_table_name, v_id, lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    v_emp,
    nullif(v_row->>'source_batch_id','')::uuid
  );
  return coalesce(new, old);
end $function$;
select set_config('app.leave_fingerprint', (select md5(string_agg(id::text || employee_id || coalesce(absence_type_code, '') || start_date || end_date || status || in_current_plan || in_original_plan
  || coalesce(superseded_by::text, '') || coalesce(rescheduled_from::text, '') || updated_at, ',' order by id)) from public.leave_records), true);
select set_config('app.audit_count', (select count(*)::text from public.audit_log), true);
select set_config('app.migration', 'leave_versioning_backfill', true);

create table public.plan_years (
  year        integer primary key check (year between 2000 and 2100),
  status      text not null check (status in ('active', 'planning', 'closed')),
  note        text,
  updated_at  timestamptz not null default now()
);
create unique index plan_years_one_active on public.plan_years (status) where status = 'active';
alter table public.plan_years enable row level security;
create policy plan_years_staff_read on public.plan_years for select to authenticated using (public.app_is_staff());
revoke insert, update, delete on public.plan_years from anon, authenticated;
create trigger plan_years_audit after insert or update or delete on public.plan_years for each row execute function public.audit_row_change();
insert into public.plan_years (year, status, note) values
  (2026, 'active', 'The plan in use: manpower, alerts, calendar and Oracle follow-up read it.'),
  (2027, 'planning', 'PV plan being prepared; not used until it is published.');

alter table public.leave_records
  add column plan_year         integer check (plan_year between 2000 and 2100),
  add column origin            text check (origin in ('import', 'manual', 'request', 'oracle_correction', 'system')),
  add column request_header_id uuid references public.request_headers (id),
  add column root_id           uuid references public.leave_records (id),
  add column version_no        integer check (version_no >= 1),
  add column change_reason     text;

-- backfill of the new columns (inside the window)
-- versions follow rescheduled_from from the first record of each chain
with recursive chain as (
  select id, id as root, 1 as v from public.leave_records where rescheduled_from is null
  union all
  select l.id, c.root, c.v + 1 from public.leave_records l join chain c on l.rescheduled_from = c.id
)
update public.leave_records l set root_id = c.root, version_no = c.v from chain c where c.id = l.id;
update public.leave_records l set plan_year = extract(year from r.start_date)::integer from public.leave_records r where r.id = l.root_id;
update public.leave_records set origin = case when source_kind = 'manual' then 'manual' else 'import' end where origin is null;
-- versions made when a reschedule request or a leave form was approved (created in the same transaction as the decision)
update public.leave_records l set origin = 'request', request_header_id = h.id, change_reason = c.remark
  from public.leave_change_requests c join public.request_headers h on h.legacy_table = 'leave_change_requests' and h.legacy_id = c.id
 where c.status = 'approved' and l.created_at = c.decided_at and (l.id = c.result_record_id or l.rescheduled_from = any (c.record_ids));
update public.leave_records l set origin = 'request', request_header_id = h.id
  from public.leave_requests f join public.request_headers h on h.legacy_table = 'leave_requests' and h.legacy_id = f.id
 where f.status = 'approved' and l.id = f.leave_record_id and l.created_at = f.decided_at;
select set_config('app.migration', '', true);
do $$
begin
  if (select md5(string_agg(id::text || employee_id || coalesce(absence_type_code, '') || start_date || end_date || status || in_current_plan || in_original_plan
        || coalesce(superseded_by::text, '') || coalesce(rescheduled_from::text, '') || updated_at, ',' order by id)) from public.leave_records)
     is distinct from current_setting('app.leave_fingerprint') then
    raise exception 'The backfill changed operational leave data: nothing applied.';
  end if;
  if (select count(*)::text from public.audit_log) is distinct from current_setting('app.audit_count') then
    raise exception 'The backfill wrote to the audit log: nothing applied.';
  end if;
end $$;
-- end of the window: both functions exactly as before
create or replace function public.touch_updated_at()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin new.updated_at := now(); return new; end $function$;
create or replace function public.audit_row_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_emp uuid;
  v_id  uuid;
begin
  if tg_table_name = 'employees' then
    v_emp := (v_row->>'id')::uuid;
  else
    v_emp := nullif(v_row->>'employee_id','')::uuid;
  end if;
  if (v_row->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := (v_row->>'id')::uuid;
  end if;
  insert into public.audit_log (actor_id, entity_table, entity_id, action, previous, next, related_employee_id, batch_id)
  values (
    auth.uid(), tg_table_name, v_id, lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    v_emp,
    nullif(v_row->>'source_batch_id','')::uuid
  );
  return coalesce(new, old);
end $function$;
do $$
begin
  if (select md5(prosrc) from pg_proc where oid = 'public.touch_updated_at()'::regprocedure) <> 'b3eadeda82f2c43bf8e450434ea42a7a'
     or (select md5(prosrc) from pg_proc where oid = 'public.audit_row_change()'::regprocedure) <> 'cd33666e30a3728322f5e2eca6e5045f' then
    raise exception 'The trigger functions were not restored exactly: nothing applied.';
  end if;
end $$;

alter table public.leave_records alter column plan_year set not null, alter column origin set not null,
  alter column root_id set not null, alter column version_no set not null;
create index leave_records_root on public.leave_records (root_id, version_no);
create index leave_records_plan_year on public.leave_records (plan_year) where in_current_plan;

-- a new record: its place in the chain, plan year and origin
create or replace function public.leave_records_version_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.leave_records; v_active integer;
begin
  if new.rescheduled_from is not null then select * into p from public.leave_records where id = new.rescheduled_from; end if;
  new.root_id := coalesce(new.root_id, p.root_id, new.id);
  new.version_no := coalesce(new.version_no, p.version_no + 1, 1);
  new.plan_year := coalesce(new.plan_year, p.plan_year, nullif(current_setting('app.plan_year', true), '')::integer, extract(year from new.start_date)::integer);
  new.origin := coalesce(new.origin, case when new.source_kind = 'manual' then 'manual' else 'import' end);
  -- next year's PV is planned in the PV plan, not added to the active plan by hand
  select year into v_active from public.plan_years where status = 'active';
  if p.id is null and new.origin = 'manual' and new.absence_type_code = 'annual_leave_planned' and new.plan_year > v_active then
    raise exception 'PV for % is planned in the PV plan (draft), not in the Active Plan · %.', new.plan_year, v_active using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger leave_records_version_defaults before insert on public.leave_records for each row execute function public.leave_records_version_defaults();

-- an existing record: dates and version links never change in place
create or replace function public.leave_records_no_date_edit() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.employee_id, new.start_date, new.end_date, new.plan_year, new.root_id, new.version_no, new.rescheduled_from)
     is distinct from (old.employee_id, old.start_date, old.end_date, old.plan_year, old.root_id, old.version_no, old.rescheduled_from) then
    raise exception 'Leave dates are never changed in place: the change is saved as a new version and the old one stays in the history.' using errcode = 'check_violation';
  end if;
  if old.request_header_id is not null and new.request_header_id is distinct from old.request_header_id then
    raise exception 'The request that made this leave cannot be changed.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger leave_records_no_date_edit before update on public.leave_records for each row execute function public.leave_records_no_date_edit();

-- a request that produced leave: the new versions made in the same transaction are marked with it
create or replace function public.request_link_leave() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.result_table = 'leave_records' and new.result_id is not null then
    update public.leave_records l set origin = 'request', request_header_id = new.id, change_reason = coalesce(l.change_reason, new.remarks, new.summary)
     where l.request_header_id is null and l.created_at = now()
       and (l.id = new.result_id or l.rescheduled_from = any (coalesce((select d.replaces_record_ids from public.request_leave d where d.header_id = new.id), '{}')));
  end if;
  return null;
end $$;
create trigger request_headers_link_leave after insert or update of result_id on public.request_headers for each row execute function public.request_link_leave();

-- leave_save: add, correct the type in place, or save new dates as a new version (any origin)
create or replace function public.leave_save(p_record uuid, p_employee uuid, p_type text, p_start date, p_end date, p_note text)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
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

  -- only the type changes: corrected on the same record (the dates stay)
  if v_old.start_date = p_start and v_old.end_date = p_end then
    update public.leave_records set absence_type_code = p_type, hand_corrected = true,
      note = concat_ws(' | ', note, 'Corrected by hand: ' || v_note)
    where id = v_old.id;
    insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, current_record_id, from_start, from_end, to_start, to_end, note, by_hand)
    values (v_emp, 'corrected', v_old.id, v_old.id, v_old.start_date, v_old.end_date, p_start, p_end, format('Corrected by hand (%s): %s', v_what, v_note), true);
    return v_old.id;
  end if;

  -- new dates (any origin): a new version; the old one leaves the plan and stays in the history
  insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref,
                                    review_status, note, in_original_plan, in_current_plan, rescheduled_from, hand_corrected, change_reason)
  values (v_emp, p_type, p_start, p_end, 'approved', 'manual', 'Corrected by hand', 'none', v_note, false, true, v_old.id, true, v_note)
  returning id into v_new;
  update public.leave_records set in_current_plan = false, status = 'rescheduled', superseded_by = v_new, hand_corrected = true,
    note = concat_ws(' | ', note, 'Replaced by a new version: ' || v_note)
  where id = v_old.id;
  insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, current_record_id, from_start, from_end, to_start, to_end, note, by_hand)
  values (v_emp, 'corrected', v_old.id, v_new, v_old.start_date, v_old.end_date, p_start, p_end, format('Corrected by hand (%s): %s', v_what, v_note), true);
  return v_new;
end $function$;

-- request_apply: leave made by a request belongs to the request's plan year
-- Make the change a request asks for, through the same functions and checks as a direct change (internal).
-- Returns the record it created; the detail row keeps the link.
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
