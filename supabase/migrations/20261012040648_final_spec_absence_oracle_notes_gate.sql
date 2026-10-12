-- Final consolidated specification (Section Head, 12 Oct 2026). Additive and backward compatible: nothing existing is
-- deleted or rewritten. A copy of the tables it touches is kept in schema backup_20261012.
--  1. absence_types: entry_mode (pv / fixed / tracked / statistics / retired), oracle_code, review_days.
--     Sick Leave and Escort Leave become statistics only (no new Entry cases); Injury, Surgery / Medical and Long Sick
--     are tracked operational absences (open end allowed); Leave Extension is retired as a new type (old rows readable).
--  2. Oracle code dictionary (only the codes the Section Head defined; others are shown as Unmapped).
--  3. Oracle absence statistics: snapshots (source, period, extracted, who) and per-person values; re-import of the
--     same snapshot is refused; a different value for the same person, code and period is a conflict the Section Head
--     confirms; the older value is kept as superseded.
--  4. Open-ended operational absences: leave_records.end_date may be NULL (unknown return) for tracked types only,
--     with estimated return and next review as labelled provisional fields; Extend and Confirm Return make a new
--     version of the same absence; overlap checks treat an open end as infinite.
--  5. Employee notes (author, time, own-only edit for the Coordinator, any for the Section Head, audited, no delete).
--  6. Request drafts (owner only; never counted, never in Approvals).
--  7. One store of issues (alerts): one row per key, updated in place, resolved and archived automatically.
--  8. Server check: a manpower version counter bumped by every change that affects staffing; submit and approve need
--     a check computed on the server (edge function request-gate) on the current version, taken under a row lock.
--  9. audit_log cannot be updated or deleted.

-- 0. backup ---------------------------------------------------------------------------------------------------------
create schema if not exists backup_20261012;
create table backup_20261012.leave_records as table public.leave_records;
create table backup_20261012.request_headers as table public.request_headers;
create table backup_20261012.request_leave as table public.request_leave;
create table backup_20261012.absence_types as table public.absence_types;
create table backup_20261012.sick_leave_totals as table public.sick_leave_totals;
create table backup_20261012.sick_checks as table public.sick_checks;
revoke all on schema backup_20261012 from public, anon, authenticated;

-- 1. absence types ---------------------------------------------------------------------------------------------------
alter table public.absence_types
  add column entry_mode text not null default 'fixed' check (entry_mode in ('pv', 'fixed', 'tracked', 'statistics', 'retired')),
  add column oracle_code text,
  add column review_days integer check (review_days is null or review_days between 1 and 90);
update public.absence_types set entry_mode = 'pv' where code in ('annual_leave_planned', 'annual_leave_rescheduled');
update public.absence_types set entry_mode = 'statistics' where code in ('sick_leave', 'escort_leave');
update public.absence_types set entry_mode = 'tracked', review_days = 14, workflow = 'record_notify' where code in ('injury', 'medical_absence', 'long_sick');
update public.absence_types set entry_mode = 'retired' where code = 'leave_extension';
update public.absence_types set oracle_code = x.oc from (values ('sick_leave', 'SK'), ('medical_absence', 'SS'), ('injury', 'SW'),
  ('escort_leave', 'PE'), ('special_leave', 'SP')) x(c, oc) where code = x.c;

-- 2. Oracle code dictionary ----------------------------------------------------------------------------------------------
create table public.oracle_absence_codes (
  code          text primary key check (code ~ '^[A-Z0-9]{1,6}$'),
  label         text not null,
  counts_as_sick boolean not null default false,
  app_type_code text references public.absence_types (code),
  verified      boolean not null default false,
  source        text not null,
  note          text
);
insert into public.oracle_absence_codes (code, label, counts_as_sick, app_type_code, verified, source, note) values
  ('SH', 'Chronic sickness', true, null, true, 'Section Head, final instructions 12 Oct 2026', null),
  ('SK', 'Sick leave', true, 'sick_leave', true, 'Section Head, final instructions 12 Oct 2026', null),
  ('SS', 'Surgery sick leave', true, 'medical_absence', true, 'Section Head, final instructions 12 Oct 2026', 'Long recovery is also tracked as an operational absence; the statistic is not added to it'),
  ('SW', 'Work-accident sick leave', true, 'injury', true, 'Section Head, final instructions 12 Oct 2026', 'Long absence is also tracked as an operational absence; the statistic is not added to it'),
  ('SD', 'Sickness during leave', true, null, true, 'Section Head, final instructions 12 Oct 2026', 'The person was already on leave: counted as sick days, never as a second absence'),
  ('PE', 'Patient escort', false, 'escort_leave', true, 'Section Head, final instructions 12 Oct 2026', null),
  ('AB', 'Absence without reason', false, null, true, 'Section Head, final instructions 12 Oct 2026', 'Statistics only'),
  ('SP', 'Special leave', false, 'special_leave', true, 'Section Head, final instructions 12 Oct 2026', null);
alter table public.oracle_absence_codes enable row level security;
create policy oac_staff_read on public.oracle_absence_codes for select to authenticated using (public.app_is_staff());

-- 3. Oracle absence statistics -----------------------------------------------------------------------------------------
create table public.oracle_stat_snapshots (
  id            uuid primary key default gen_random_uuid(),
  source_report text not null check (length(btrim(source_report)) > 0),
  period_start  date not null,
  period_end    date not null check (period_end >= period_start),
  extracted_on  date not null,
  codes         text[] not null check (cardinality(codes) > 0),   -- codes the report covers: a missing value is 0
  employees     uuid[] not null default '{}',                     -- people the report covers: anyone else is unknown
  import_batch_id uuid references public.import_batches (id),
  imported_by   uuid default auth.uid(),
  imported_at   timestamptz not null default now(),
  note          text,
  unique (source_report, period_start, period_end, extracted_on)
);
create table public.oracle_stat_values (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid not null references public.oracle_stat_snapshots (id),
  employee_id   uuid not null references public.employees (id),
  code          text not null check (code ~ '^[A-Z0-9]{1,6}$'),
  days          numeric(6,1) not null check (days >= 0),
  occurrences   integer check (occurrences >= 0),
  status        text not null default 'active' check (status in ('active', 'superseded')),
  superseded_by uuid references public.oracle_stat_values (id),
  unique (snapshot_id, employee_id, code)
);
create index oracle_stat_values_emp on public.oracle_stat_values (employee_id, code) where status = 'active';
alter table public.oracle_stat_snapshots enable row level security;
alter table public.oracle_stat_values enable row level security;
create policy oss_staff_read on public.oracle_stat_snapshots for select to authenticated using (public.app_is_staff());
create policy osv_staff_read on public.oracle_stat_values for select to authenticated using (public.app_is_staff());
create trigger oracle_stat_snapshots_audit after insert or update or delete on public.oracle_stat_snapshots for each row execute function public.audit_row_change();
create trigger oracle_stat_values_audit after insert or update or delete on public.oracle_stat_values for each row execute function public.audit_row_change();

-- p_snapshot: {source_report, period_start, period_end, extracted_on, codes[], note, import_batch_id}
-- p_values: [{employee_id, code, days, occurrences}]. Returns {snapshot, inserted, unchanged, conflicts[]}.
-- A conflict (same person, code and period, other days) is only replaced when p_replace and the Section Head.
create or replace function public.oracle_stats_import(p_snapshot jsonb, p_values jsonb, p_replace boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_snap uuid; v_ps date; v_pe date; v jsonb; o record; v_new uuid; n_ins int := 0; n_same int := 0;
        v_conf jsonb := '[]'::jsonb; v_emps uuid[];
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can import Oracle figures.' using errcode = 'insufficient_privilege'; end if;
  v_ps := (p_snapshot->>'period_start')::date; v_pe := (p_snapshot->>'period_end')::date;
  if v_ps is null or v_pe is null or v_pe < v_ps then raise exception 'Give the period the report covers.' using errcode = 'check_violation'; end if;
  if (p_snapshot->>'extracted_on')::date is null then raise exception 'Give the date the report was taken from Oracle.' using errcode = 'check_violation'; end if;
  if (p_snapshot->>'extracted_on')::date > current_date + 1 then raise exception 'The report date is in the future.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.oracle_stat_snapshots s where s.source_report = btrim(p_snapshot->>'source_report') and s.period_start = v_ps
             and s.period_end = v_pe and s.extracted_on = (p_snapshot->>'extracted_on')::date) then
    raise exception 'This report (same source, period and date) is already imported: nothing was counted twice.' using errcode = 'unique_violation';
  end if;
  select array_agg(distinct (x->>'employee_id')::uuid) into v_emps from jsonb_array_elements(coalesce(p_values, '[]'::jsonb)) x;
  -- conflicts first: nothing is written while one is not confirmed
  for v in select * from jsonb_array_elements(coalesce(p_values, '[]'::jsonb)) loop
    select ov.id, ov.days into o from public.oracle_stat_values ov join public.oracle_stat_snapshots s on s.id = ov.snapshot_id
     where ov.employee_id = (v->>'employee_id')::uuid and ov.code = v->>'code' and ov.status = 'active'
       and s.period_start = v_ps and s.period_end = v_pe limit 1;
    if found and o.days <> (v->>'days')::numeric then
      v_conf := v_conf || jsonb_build_object('employee_id', v->>'employee_id', 'code', v->>'code', 'existing', o.days, 'new', (v->>'days')::numeric);
    end if;
  end loop;
  if jsonb_array_length(v_conf) > 0 and not (coalesce(p_replace, false) and public.app_is_section_head()) then
    return jsonb_build_object('snapshot', null, 'inserted', 0, 'unchanged', 0, 'conflicts', v_conf,
      'message', case when coalesce(p_replace, false) then 'Only the Section Head can replace figures already recorded.' else 'Some figures differ from what is recorded: confirm to replace them.' end);
  end if;
  insert into public.oracle_stat_snapshots (source_report, period_start, period_end, extracted_on, codes, employees, import_batch_id, note)
  values (btrim(p_snapshot->>'source_report'), v_ps, v_pe, (p_snapshot->>'extracted_on')::date,
          array(select jsonb_array_elements_text(p_snapshot->'codes')), coalesce(v_emps, '{}'), nullif(p_snapshot->>'import_batch_id', '')::uuid, nullif(btrim(coalesce(p_snapshot->>'note', '')), ''))
  returning id into v_snap;
  for v in select * from jsonb_array_elements(coalesce(p_values, '[]'::jsonb)) loop
    select ov.id, ov.days into o from public.oracle_stat_values ov join public.oracle_stat_snapshots s on s.id = ov.snapshot_id
     where ov.employee_id = (v->>'employee_id')::uuid and ov.code = v->>'code' and ov.status = 'active' and s.id <> v_snap
       and s.period_start = v_ps and s.period_end = v_pe limit 1;
    if found and o.days = (v->>'days')::numeric then n_same := n_same + 1; end if;
    insert into public.oracle_stat_values (snapshot_id, employee_id, code, days, occurrences)
    values (v_snap, (v->>'employee_id')::uuid, v->>'code', (v->>'days')::numeric, nullif(v->>'occurrences', '')::integer) returning id into v_new;
    if found and o.id is not null then update public.oracle_stat_values set status = 'superseded', superseded_by = v_new where id = o.id; end if;
    o := null;
    n_ins := n_ins + 1;
  end loop;
  return jsonb_build_object('snapshot', v_snap, 'inserted', n_ins, 'unchanged', n_same, 'conflicts', '[]'::jsonb, 'replaced', jsonb_array_length(v_conf));
end $$;
revoke execute on function public.oracle_stats_import(jsonb, jsonb, boolean) from public, anon;

-- 4. open-ended operational absences ------------------------------------------------------------------------------------
alter table public.leave_records alter column end_date drop not null;
alter table public.leave_records
  add column estimated_return date,
  add column next_review date,
  add column return_confirmed_at timestamptz,
  add column return_confirmed_by uuid;
-- only a tracked absence may have an unknown end; everything else keeps its dates
create or replace function public.leave_records_open_end_check() returns trigger language plpgsql set search_path = public as $$
begin
  if new.end_date is null and coalesce((select entry_mode from public.absence_types where code = new.absence_type_code), '') <> 'tracked' then
    raise exception 'Only an operational absence (injury, surgery / medical, long sick) can be open-ended.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger leave_records_open_end before insert or update on public.leave_records for each row execute function public.leave_records_open_end_check();
alter table public.request_leave alter column end_date drop not null;
alter table public.request_leave
  add column action text not null default 'new' check (action in ('new', 'extend', 'return', 'cancel')),
  add column target_record_id uuid references public.leave_records (id),
  add column estimated_return date,
  add column next_review date;
-- leave_save: an open-ended absence overlaps everything after its start
create or replace function public.leave_save(p_record uuid, p_employee uuid, p_type text, p_start date, p_end date, p_note text)
 returns uuid language plpgsql set search_path to 'public' as $function$
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
  if p_record is null and exists (select 1 from public.absence_types where code = p_type and entry_mode in ('statistics', 'retired')) then
    raise exception 'This type is not entered as a leave: % comes from Oracle statistics (or is no longer used for new entries).',
      (select label from public.absence_types where code = p_type) using errcode = 'check_violation';
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
     and l.id is distinct from p_record and l.start_date <= p_end and coalesce(l.end_date, 'infinity'::date) >= p_start
   order by l.start_date limit 1;
  if found then
    raise exception 'Overlaps leave already recorded (% – %). Correct or cancel that record instead.',
      to_char(v_clash.start_date, 'FMDD Mon YYYY'), coalesce(to_char(v_clash.end_date, 'FMDD Mon YYYY'), 'return not confirmed') using errcode = 'check_violation';
  end if;

  if p_record is null then
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

  if v_old.start_date = p_start and v_old.end_date = p_end then
    update public.leave_records set absence_type_code = p_type, hand_corrected = true,
      note = concat_ws(' | ', note, 'Corrected by hand: ' || v_note)
    where id = v_old.id;
    insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, current_record_id, from_start, from_end, to_start, to_end, note, by_hand)
    values (v_emp, 'corrected', v_old.id, v_old.id, v_old.start_date, v_old.end_date, p_start, p_end, format('Corrected by hand (%s): %s', v_what, v_note), true);
    return v_old.id;
  end if;

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

-- A new operational (tracked) absence: end known or unknown (NULL), provisional estimated return and next review.
create or replace function public.absence_case_open(p_employee uuid, p_type text, p_start date, p_end date, p_estimated date, p_review date, p_note text)
returns uuid language plpgsql set search_path = public as $$
declare v_clash record; v_new uuid; v_t public.absence_types;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can record an absence.' using errcode = 'insufficient_privilege'; end if;
  select * into v_t from public.absence_types where code = p_type and is_active;
  if not found or v_t.entry_mode <> 'tracked' then raise exception 'Choose an operational absence type (injury, surgery / medical, long sick).' using errcode = 'check_violation'; end if;
  if p_start is null then raise exception 'Enter the first day.' using errcode = 'check_violation'; end if;
  if p_end is not null and p_end < p_start then raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation'; end if;
  if p_estimated is not null and p_estimated <= p_start then raise exception 'The estimated return must be after the first day.' using errcode = 'check_violation'; end if;
  select l.start_date, l.end_date, t.label into v_clash from public.leave_records l left join public.absence_types t on t.code = l.absence_type_code
   where l.employee_id = p_employee and l.in_current_plan and l.status in ('approved', 'planned', 'unresolved')
     and l.start_date <= coalesce(p_end, 'infinity'::date) and coalesce(l.end_date, 'infinity'::date) >= p_start
   order by l.start_date limit 1;
  if found then
    raise exception 'Overlaps % already recorded (% – %). Extend or confirm the return on that one, or correct it first.', coalesce(v_clash.label, 'an absence'),
      to_char(v_clash.start_date, 'FMDD Mon YYYY'), coalesce(to_char(v_clash.end_date, 'FMDD Mon YYYY'), 'return not confirmed') using errcode = 'check_violation';
  end if;
  insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref, review_status, note,
                                    in_original_plan, in_current_plan, hand_corrected, origin, estimated_return, next_review)
  values (p_employee, p_type, p_start, p_end, 'approved', 'manual', 'Operational absence', 'none', nullif(btrim(coalesce(p_note, '')), ''),
          false, true, true, 'request', p_estimated, coalesce(p_review, case when p_end is null then current_date + coalesce(v_t.review_days, 14) end))
  returning id into v_new;
  insert into public.leave_plan_changes (employee_id, change_kind, current_record_id, to_start, to_end, note, by_hand)
  values (p_employee, 'added', v_new, p_start, p_end, coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Operational absence'), true);
  return v_new;
end $$;

-- Extend (new end, or still unknown) or Confirm return (back at work on p_back: the absence ends the day before). A new
-- version of the same absence (same root); the old version stays in the history.
create or replace function public.absence_case_version(p_record uuid, p_kind text, p_end date, p_back date, p_estimated date, p_review date, p_note text)
returns uuid language plpgsql set search_path = public as $$
declare o public.leave_records; v_end date; v_new uuid; v_clash record; v_t public.absence_types; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can change an absence.' using errcode = 'insufficient_privilege'; end if;
  select * into o from public.leave_records where id = p_record for update;
  if not found then raise exception 'Absence not found.' using errcode = 'no_data_found'; end if;
  if not (o.in_current_plan and o.status = 'approved') then raise exception 'This version is no longer current: open the latest one.' using errcode = 'check_violation'; end if;
  select * into v_t from public.absence_types where code = o.absence_type_code;
  if coalesce(v_t.entry_mode, '') <> 'tracked' then raise exception 'Extend and Confirm return are for operational absences (injury, surgery / medical, long sick).' using errcode = 'check_violation'; end if;
  if p_kind = 'return' then
    if p_back is null then raise exception 'Enter the day back at work.' using errcode = 'check_violation'; end if;
    if p_back <= o.start_date then raise exception 'The day back must be after the first day of the absence (% ).', to_char(o.start_date, 'FMDD Mon YYYY') using errcode = 'check_violation'; end if;
    if p_back > current_date + 1 then raise exception 'A return is confirmed once it has happened (or for tomorrow at the latest).' using errcode = 'check_violation'; end if;
    v_end := p_back - 1;
  elsif p_kind = 'extend' then
    v_end := p_end;  -- NULL: still unknown
    if v_end is not null and v_end < o.start_date then raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation'; end if;
    if v_end is not null and o.end_date is not null and v_end <= o.end_date then raise exception 'An extension ends later than now (%). To shorten it, confirm the return.', to_char(o.end_date, 'FMDD Mon YYYY') using errcode = 'check_violation'; end if;
    if v_end is null and o.end_date is null and p_estimated is not distinct from o.estimated_return and p_review is not distinct from o.next_review then
      raise exception 'Nothing changed.' using errcode = 'check_violation';
    end if;
  else
    raise exception 'Unknown change %.', p_kind using errcode = 'check_violation';
  end if;
  select l.start_date, l.end_date into v_clash from public.leave_records l
   where l.employee_id = o.employee_id and l.in_current_plan and l.status in ('approved', 'planned', 'unresolved') and l.root_id <> o.root_id
     and l.start_date <= coalesce(v_end, 'infinity'::date) and coalesce(l.end_date, 'infinity'::date) >= o.start_date
   order by l.start_date limit 1;
  if found then
    raise exception 'The new dates overlap other leave (% – %). Correct that one first.', to_char(v_clash.start_date, 'FMDD Mon YYYY'),
      coalesce(to_char(v_clash.end_date, 'FMDD Mon YYYY'), 'open') using errcode = 'check_violation';
  end if;
  insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref, review_status, note,
                                    in_original_plan, in_current_plan, rescheduled_from, hand_corrected, change_reason, origin, oracle_status, oracle_ref,
                                    estimated_return, next_review, return_confirmed_at, return_confirmed_by)
  values (o.employee_id, o.absence_type_code, o.start_date, v_end, 'approved', 'manual', 'Operational absence', 'none', o.note,
          false, true, o.id, true, coalesce(v_note, case when p_kind = 'return' then 'Return confirmed' else 'Extended' end), 'request', o.oracle_status, o.oracle_ref,
          case when p_kind = 'return' then null else coalesce(p_estimated, o.estimated_return) end,
          case when p_kind = 'return' or v_end is not null then null else coalesce(p_review, current_date + coalesce(v_t.review_days, 14)) end,
          case when p_kind = 'return' then now() end, case when p_kind = 'return' then auth.uid() end)
  returning id into v_new;
  update public.leave_records set in_current_plan = false, status = 'rescheduled', superseded_by = v_new,
    note = concat_ws(' | ', note, case when p_kind = 'return' then 'Return confirmed: back ' || to_char(p_back, 'FMDD Mon YYYY') else 'Extended' end)
  where id = o.id;
  insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, current_record_id, from_start, from_end, to_start, to_end, note, by_hand)
  values (o.employee_id, 'corrected', o.id, v_new, o.start_date, o.end_date, o.start_date, v_end,
          concat_ws(': ', case when p_kind = 'return' then 'Return confirmed' else 'Extended' end, v_note), true);
  return v_new;
end $$;

-- request detail and apply: the leave actions
create or replace function public.request_detail_insert(p_header uuid, p_type text, d jsonb)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_type in ('pv_reschedule', 'unscheduled_pv', 'personal_pc', 'absence') then
    insert into public.request_leave (header_id, absence_type_code, start_date, end_date, estimated, replaces_record_ids, old_start, old_end,
                                      action, target_record_id, estimated_return, next_review)
    values (p_header, d->>'absence_type_code', (d->>'start_date')::date, (d->>'end_date')::date, coalesce((d->>'estimated')::boolean, false),
            coalesce(array(select jsonb_array_elements_text(d->'replaces_record_ids'))::uuid[], '{}'), (d->>'old_start')::date, (d->>'old_end')::date,
            coalesce(d->>'action', 'new'), nullif(d->>'target_record_id', '')::uuid, (d->>'estimated_return')::date, (d->>'next_review')::date);
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
end $function$;

create or replace function public.request_apply(p_header uuid)
 returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare h public.request_headers; l public.request_leave; s public.request_shift; a public.request_assignment; sd public.request_shutdown;
        v_id uuid; v_type text; v_note text; v_mode text;
begin
  select * into h from public.request_headers where id = p_header;
  perform set_config('app.plan_year', h.plan_year::text, true);
  v_note := coalesce(nullif(btrim(coalesce(h.remarks, '')), ''), h.summary);
  if h.type in ('unscheduled_pv', 'personal_pc', 'absence') then
    select * into l from public.request_leave where header_id = p_header;
    if l.action = 'extend' or l.action = 'return' then
      v_id := public.absence_case_version(l.target_record_id, l.action, l.end_date, case when l.action = 'return' then l.end_date + 1 end, l.estimated_return, l.next_review, v_note);
    elsif l.action = 'cancel' then
      perform public.leave_cancel(l.target_record_id, v_note);
      v_id := l.target_record_id;
    else
      select entry_mode into v_mode from public.absence_types where code = l.absence_type_code;
      if v_mode = 'tracked' then
        v_id := public.absence_case_open(h.employee_id, l.absence_type_code, l.start_date, l.end_date, l.estimated_return, l.next_review, v_note);
      else
        if jsonb_path_exists(coalesce(h.accepted_findings, '[]'::jsonb) || coalesce(h.check_at_submit->'findings', '[]'::jsonb),
             '$[*] ? (@.rule == "leave_overlap")') then
          perform public.leave_make_room(h.employee_id, l.start_date, l.end_date, p_header, format('Days taken by %s', coalesce((select label from public.absence_types where code = l.absence_type_code), 'other leave')));
        end if;
        v_id := public.leave_save(null, h.employee_id, l.absence_type_code, l.start_date, l.end_date, v_note);
        if l.estimated then perform public.leave_set_estimated(v_id, true); end if;
      end if;
    end if;
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
end $function$;

-- 8. manpower version and server checks -------------------------------------------------------------------------------
create table public.manpower_version (id integer primary key check (id = 1), v bigint not null, at timestamptz not null default now());
insert into public.manpower_version values (1, 1, now());
alter table public.manpower_version enable row level security;
create policy mv_staff_read on public.manpower_version for select to authenticated using (public.app_is_staff());
create or replace function public.manpower_bump() returns trigger language plpgsql security definer set search_path = public as $$
begin update public.manpower_version set v = v + 1, at = now() where id = 1; return null; end $$;
revoke execute on function public.manpower_bump() from public, anon, authenticated;
do $$ declare t text; begin
  foreach t in array array['leave_records', 'crew_movements', 'controller_assignments', 'task_releases', 'operation_periods', 'operating_modes',
                           'sd_plans', 'sd_teams', 'sd_members', 'sd_days', 'employee_role_assignments', 'employee_qualifications', 'employees'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each statement execute function public.manpower_bump()', t || '_mp_bump', t);
  end loop;
end $$;

create table public.server_checks (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_for uuid not null,                       -- the signed-in user the check was made for
  stamp       bigint not null,                      -- manpower_version.v when the check started
  request_id  uuid,                                 -- a decision: the request; a submit: null
  employee_id uuid not null,
  type        text not null,
  start_date  date not null,
  end_date    date,
  allowed     boolean not null,
  factual     boolean not null default false,
  reason      text,
  check_body  jsonb not null
);
alter table public.server_checks enable row level security;
create policy sc_staff_read on public.server_checks for select to authenticated using (public.app_is_staff());
-- no insert/update policy: only the edge function (service role) writes checks

create or replace function public.server_check_use(p_check uuid, p_request uuid, p_employee uuid, p_type text, p_start date, p_end date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.server_checks; v bigint;
begin
  if p_check is null then raise exception 'This change must be checked on the server first. Reload the app and try again.' using errcode = 'check_violation'; end if;
  -- one decision at a time: the version row is locked until the transaction ends
  select mv.v into v from public.manpower_version mv where id = 1 for update;
  select * into c from public.server_checks where id = p_check;
  if not found or c.created_for <> auth.uid() or c.created_at < now() - interval '10 minutes' then
    raise exception 'The server check has expired. Check again.' using errcode = 'check_violation';
  end if;
  if c.stamp <> v then raise exception 'STALE_CHECK: the plan changed while this was being checked.' using errcode = 'serialization_failure'; end if;
  if c.request_id is distinct from p_request or c.employee_id <> p_employee or c.type <> p_type or c.start_date <> p_start or c.end_date is distinct from p_end then
    raise exception 'The server check is for another change.' using errcode = 'check_violation';
  end if;
  if not c.allowed then raise exception '%', coalesce(c.reason, 'Not allowed by the server check.') using errcode = 'check_violation'; end if;
  return c.check_body;
end $$;
revoke execute on function public.server_check_use(uuid, uuid, uuid, text, date, date) from public, anon;

create or replace function public.request_header_submit_checked(p_server_check uuid, p_type text, p_employee uuid, p_plan_year integer, p_summary text, p_remarks text,
  p_detail jsonb, p_workflow text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_check jsonb; v_end date;
begin
  v_end := coalesce((p_detail->>'end_date')::date, case when p_detail->>'return_date' is not null then (p_detail->>'return_date')::date - 1 end);
  v_check := public.server_check_use(p_server_check, null, p_employee, p_type, (p_detail->>'start_date')::date, v_end);
  return public.request_header_submit(p_type, p_employee, p_plan_year, p_summary, p_remarks, p_detail, v_check, null, null, p_workflow);
end $$;

create or replace function public.request_header_decide_checked(p_server_check uuid, p_id uuid, p_approve boolean, p_note text, p_accepted jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.request_headers; v_check jsonb;
begin
  select * into r from public.request_headers where id = p_id;
  if not found then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if p_approve then
    v_check := public.server_check_use(p_server_check, p_id, r.employee_id, r.type, r.start_date, r.end_date);
  end if;
  return public.request_header_decide(p_id, p_approve, p_note, v_check, p_accepted);
end $$;
-- the unchecked paths stay for the shutdown package and legacy mirrors; the app's routine paths use the checked ones
-- request_header_decide is still called by request_header_decide_checked (security definer, owner) and by the service role

-- a pending request may be corrected: withdraw and send again is done by the app; withdraw keeps both in the history

-- 5. employee notes ----------------------------------------------------------------------------------------------------
create table public.employee_notes (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id),
  body        text not null check (length(btrim(body)) between 1 and 2000),
  author      uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  edited_by   uuid,
  archived    boolean not null default false
);
create index employee_notes_emp on public.employee_notes (employee_id, created_at desc);
alter table public.employee_notes enable row level security;
create policy en_staff_read on public.employee_notes for select to authenticated using (public.app_is_staff());
create policy en_staff_add on public.employee_notes for insert to authenticated with check (public.app_is_staff() and author = auth.uid());
create policy en_edit on public.employee_notes for update to authenticated
  using (public.app_is_section_head() or (public.app_is_staff() and author = auth.uid()))
  with check (public.app_is_section_head() or (public.app_is_staff() and author = auth.uid()));
create or replace function public.employee_notes_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.author <> old.author or new.created_at <> old.created_at or new.employee_id <> old.employee_id then
    raise exception 'The author, time and person of a note do not change.' using errcode = 'check_violation';
  end if;
  new.edited_at := now(); new.edited_by := auth.uid();
  return new;
end $$;
create trigger employee_notes_guard before update on public.employee_notes for each row execute function public.employee_notes_guard();
create trigger employee_notes_audit after insert or update or delete on public.employee_notes for each row execute function public.audit_row_change();

-- 6. drafts ---------------------------------------------------------------------------------------------------------
create table public.request_drafts (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid(),
  kind        text not null,
  employee_id uuid references public.employees (id),
  title       text not null,
  payload     jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.request_drafts enable row level security;
create policy rd_own on public.request_drafts for all to authenticated using (owner = auth.uid() and public.app_is_staff()) with check (owner = auth.uid() and public.app_is_staff());

-- 7. issues -----------------------------------------------------------------------------------------------------------
create table public.issues (
  key         text primary key,
  level       text not null check (level in ('critical', 'warning', 'info')),
  area        text not null,
  title       text not null,
  detail      text not null,
  target      text not null,
  first_date  date,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  opened_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.issues enable row level security;
create policy is_staff_read on public.issues for select to authenticated using (public.app_is_staff());
-- p_items: the issues the app works out now [{key, level, area, title, detail, target, first_date}]. New keys open, changed
-- ones are updated in place, open keys no longer present are resolved (kept as history). Returns counts.
create or replace function public.issues_sync(p_items jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare n_new int; n_res int;
begin
  if not public.app_is_staff() then raise exception 'Staff only.' using errcode = 'insufficient_privilege'; end if;
  with x as (select * from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as t(key text, level text, area text, title text, detail text, target text, first_date date)),
  up as (
    insert into public.issues as i (key, level, area, title, detail, target, first_date)
    select key, level, area, title, detail, target, first_date from x
    on conflict (key) do update set level = excluded.level, area = excluded.area, title = excluded.title, detail = excluded.detail, target = excluded.target,
      first_date = excluded.first_date, status = 'open', resolved_at = null,
      opened_at = case when i.status = 'resolved' then now() else i.opened_at end,
      updated_at = case when (i.level, i.title, i.detail, i.status) is distinct from (excluded.level, excluded.title, excluded.detail, 'open') then now() else i.updated_at end
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into n_new from up;
  update public.issues set status = 'resolved', resolved_at = now(), updated_at = now()
   where status = 'open' and key not in (select x->>'key' from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x);
  get diagnostics n_res = row_count;
  return jsonb_build_object('new', n_new, 'resolved', n_res);
end $$;

-- 9. audit is immutable --------------------------------------------------------------------------------------------------
create or replace function public.audit_log_immutable() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'The audit history cannot be changed.' using errcode = 'insufficient_privilege'; end $$;
create trigger audit_log_immutable before update or delete on public.audit_log for each row execute function public.audit_log_immutable();

revoke execute on function public.leave_records_open_end_check() from public, anon, authenticated;
revoke execute on function public.employee_notes_guard() from public, anon, authenticated;
revoke execute on function public.audit_log_immutable() from public, anon, authenticated;
