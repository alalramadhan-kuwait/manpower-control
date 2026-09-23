-- Stage E: leave entered or corrected by hand (Section Head / Manpower Coordinator).
-- A hand entry or correction is authoritative: a later workbook import never changes it, never recreates
-- leave on days it covers, and never marks it "not taken". Nothing is deleted: a corrected or cancelled
-- record leaves the current plan and stays in history, linked to its replacement.
--
-- 1. leave_records.hand_corrected: set on every record added, corrected or cancelled by hand.
-- 2. leave_plan_changes: new change kind 'corrected' and a by_hand flag.
-- 3. leave_save(record, employee, type, start, end, note): add (record null) or correct one current record.
--    - a hand-entered record, or a type-only correction, is updated in place (audited);
--    - new dates for an imported record: a new hand-entered record replaces it; the old one becomes
--      'rescheduled' (out of the current plan), linked both ways.
--    leave_cancel(record, reason): the record leaves the current plan as 'cancelled'.
--    Both refuse overlapping current leave for the same person and need a reason for a correction or cancel.
-- 4. commit_import_batch steps 5c / 5d / 5e leave a hand-corrected record alone (review note instead).

alter table public.leave_records add column hand_corrected boolean not null default false;
comment on column public.leave_records.hand_corrected is
  'Added, corrected or cancelled by hand. Imports never change it or recreate leave on its days.';

alter table public.leave_plan_changes drop constraint leave_plan_changes_change_kind_check;
alter table public.leave_plan_changes add constraint leave_plan_changes_change_kind_check
  check (change_kind in ('added', 'rescheduled', 'cancelled', 'source_data_changed', 'baseline_added', 'corrected'));
alter table public.leave_plan_changes add column by_hand boolean not null default false;

create or replace function public.leave_save(p_record uuid, p_employee uuid, p_type text, p_start date, p_end date, p_note text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
  v_old   public.leave_records;
  v_emp   uuid;
  v_clash record;
  v_new   uuid;
  v_what  text;
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

create or replace function public.leave_cancel(p_record uuid, p_reason text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_old    public.leave_records;
begin
  if not public.app_is_staff() then
    raise exception 'Only the Section Head or the Manpower Coordinator can change leave.' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null then raise exception 'Give the reason for cancelling.' using errcode = 'check_violation'; end if;
  select * into v_old from public.leave_records where id = p_record for update;
  if not found then raise exception 'Leave record not found.' using errcode = 'no_data_found'; end if;
  if not (v_old.in_current_plan and v_old.status in ('approved', 'planned')) then
    raise exception 'Only leave in the current plan can be cancelled.' using errcode = 'check_violation';
  end if;
  update public.leave_records set in_current_plan = false, status = 'cancelled', hand_corrected = true,
    note = concat_ws(' | ', note, 'Cancelled by hand: ' || v_reason)
  where id = v_old.id;
  insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, from_start, from_end, note, by_hand)
  values (v_old.employee_id, 'cancelled', v_old.id, v_old.start_date, v_old.end_date, 'Cancelled by hand: ' || v_reason, true);
end $$;

revoke execute on function public.leave_save(uuid, uuid, text, date, date, text) from public, anon;
revoke execute on function public.leave_cancel(uuid, text) from public, anon;
grant execute on function public.leave_save(uuid, uuid, text, date, date, text) to authenticated;
grant execute on function public.leave_cancel(uuid, text) to authenticated;

create or replace function public.commit_import_batch(p_batch_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  r         record;
  v_status  text;
  v_emp     uuid;
  v_section uuid;
  v_pos     uuid;
  v_crew    uuid;
  v_from    date;
  v_counts  jsonb;
  v_orig    record;
  v_new     uuid;
begin
  if not public.app_is_staff() then
    raise exception 'not allowed';
  end if;
  select status into v_status from public.import_batches where id = p_batch_id for update;
  if v_status is null then raise exception 'import batch % not found', p_batch_id; end if;
  if v_status <> 'previewed' then raise exception 'import batch is already %', v_status; end if;

  -- 1. new employees
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'employee' and outcome = 'new' order by seq loop
    select id into v_section from public.sections where code = coalesce(r.payload->>'section_code', 'A4-S1-U12');
    insert into public.employees (
      employee_number, official_name, display_name, short_name, employment_type, employment_type_source, section_id, in_unit12_scope,
      grade, master_position, cost_center, join_date, normalization_date, last_promotion_date, position_start_date,
      education, service_years, years_in_grade, notes, source_batch_id)
    values (
      r.payload->>'employee_number',
      coalesce(r.payload->>'official_name', r.payload->>'short_name'),
      coalesce(r.payload->>'display_name', r.payload->>'short_name', r.payload->>'official_name'),
      r.payload->>'short_name',
      coalesce(r.payload->>'employment_type', 'knpc'),
      coalesce(r.payload->>'employment_type_source', 'inferred'),
      v_section,
      coalesce((r.payload->>'in_unit12_scope')::boolean, true),
      (r.payload->>'grade')::int, r.payload->>'master_position', r.payload->>'cost_center',
      (r.payload->>'join_date')::date, (r.payload->>'normalization_date')::date,
      (r.payload->>'last_promotion_date')::date, (r.payload->>'position_start_date')::date,
      r.payload->>'education', (r.payload->>'service_years')::numeric, (r.payload->>'years_in_grade')::numeric,
      r.payload->>'notes', p_batch_id)
    returning id into v_emp;
    update public.import_rows set applied = true, matched_employee_id = v_emp where id = r.id;
  end loop;

  -- 2. changed employees (only keys present in payload are written)
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'employee' and outcome = 'changed' order by seq loop
    update public.employees e set
      official_name        = case when r.payload ? 'official_name'        then r.payload->>'official_name'                   else e.official_name end,
      display_name         = case when r.payload ? 'display_name'         then r.payload->>'display_name'                    else e.display_name end,
      short_name           = case when r.payload ? 'short_name'           then r.payload->>'short_name'                      else e.short_name end,
      employment_type      = case when r.payload ? 'employment_type'      then r.payload->>'employment_type'                 else e.employment_type end,
      employment_type_source = case when r.payload ? 'employment_type_source' then r.payload->>'employment_type_source'     else e.employment_type_source end,
      grade                = case when r.payload ? 'grade'                then (r.payload->>'grade')::int                    else e.grade end,
      master_position      = case when r.payload ? 'master_position'      then r.payload->>'master_position'                 else e.master_position end,
      cost_center          = case when r.payload ? 'cost_center'          then r.payload->>'cost_center'                     else e.cost_center end,
      join_date            = case when r.payload ? 'join_date'            then (r.payload->>'join_date')::date               else e.join_date end,
      normalization_date   = case when r.payload ? 'normalization_date'   then (r.payload->>'normalization_date')::date      else e.normalization_date end,
      last_promotion_date  = case when r.payload ? 'last_promotion_date'  then (r.payload->>'last_promotion_date')::date     else e.last_promotion_date end,
      position_start_date  = case when r.payload ? 'position_start_date'  then (r.payload->>'position_start_date')::date     else e.position_start_date end,
      education            = case when r.payload ? 'education'            then r.payload->>'education'                       else e.education end,
      service_years        = case when r.payload ? 'service_years'        then (r.payload->>'service_years')::numeric        else e.service_years end,
      years_in_grade       = case when r.payload ? 'years_in_grade'       then (r.payload->>'years_in_grade')::numeric       else e.years_in_grade end,
      in_unit12_scope      = case when r.payload ? 'in_unit12_scope'      then (r.payload->>'in_unit12_scope')::boolean      else e.in_unit12_scope end
    where e.id = r.matched_employee_id;
    update public.import_rows set applied = true where id = r.id;
  end loop;

  -- 3. role assignments (position + home crew)
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'role_assignment' and outcome in ('new','changed') order by seq loop
    v_emp := coalesce(r.matched_employee_id, (select id from public.employees where employee_number = r.employee_number));
    if v_emp is null then
      update public.import_rows set outcome = 'error', message = 'employee not found at commit' where id = r.id; continue;
    end if;
    select id into v_pos from public.positions where code = r.payload->>'position_code';
    v_crew := null;
    if nullif(r.payload->>'crew_code','') is not null then
      select id into v_crew from public.crews where code = r.payload->>'crew_code';
    end if;
    v_from := coalesce((r.payload->>'effective_from')::date, current_date);
    -- a manual current role is kept: the import never deletes or closes it
    if exists (select 1 from public.employee_role_assignments where employee_id = v_emp and effective_to is null and source = 'manual'
                and (position_id is distinct from v_pos or home_crew_id is distinct from v_crew)) then
      update public.import_rows set outcome = 'review', needs_review = true, matched_employee_id = v_emp,
        message = 'Role set by hand kept; the workbook role was not applied' where id = r.id;
      continue;
    end if;
    delete from public.employee_role_assignments
      where employee_id = v_emp and effective_to is null and effective_from >= v_from and source <> 'manual'
        and (position_id is distinct from v_pos or home_crew_id is distinct from v_crew);
    update public.employee_role_assignments set effective_to = v_from - 1
      where employee_id = v_emp and effective_to is null and source <> 'manual'
        and (position_id is distinct from v_pos or home_crew_id is distinct from v_crew);
    insert into public.employee_role_assignments (employee_id, position_id, home_crew_id, effective_from, source, source_ref, source_batch_id)
    select v_emp, v_pos, v_crew, v_from, 'import', r.payload->>'source_ref', p_batch_id
    where not exists (select 1 from public.employee_role_assignments where employee_id = v_emp and effective_to is null);
    update public.import_rows set applied = true, matched_employee_id = v_emp where id = r.id;
  end loop;

  -- 4. qualifications: imported evidence never overrides an existing (manual or earlier) record
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'qualification' and outcome = 'new' order by seq loop
    v_emp := coalesce(r.matched_employee_id, (select id from public.employees where employee_number = r.employee_number));
    if v_emp is null then continue; end if;
    insert into public.employee_qualifications (employee_id, qualification, status, effective_from, source, evidence, source_batch_id)
    select v_emp, r.payload->>'qualification', r.payload->>'status', coalesce((r.payload->>'effective_from')::date, current_date),
           coalesce(r.payload->>'source','import_inference'), r.payload->>'evidence', p_batch_id
    where not exists (select 1 from public.employee_qualifications q where q.employee_id = v_emp and q.qualification = r.payload->>'qualification' and q.effective_to is null);
    update public.import_rows set applied = true, matched_employee_id = v_emp where id = r.id;
  end loop;

  -- 5. new leave records: PV blocks (original and/or current plan) and unresolved grid absences.
  --    payload.change_kind 'added' / 'baseline_added' also writes a history row.
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'leave_record' and outcome in ('new','review') and payload is not null and not (payload ? 'leave_record_id') and not (payload ? 'rescheduled_from_id') order by seq loop
    v_emp := coalesce(r.matched_employee_id, (select id from public.employees where employee_number = r.employee_number));
    if v_emp is null then
      update public.import_rows set outcome = 'error', message = 'employee not found at commit' where id = r.id; continue;
    end if;
    insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref, source_batch_id, review_status, note, in_original_plan, in_current_plan)
    values (v_emp, nullif(r.payload->>'absence_type_code',''), (r.payload->>'start_date')::date, (r.payload->>'end_date')::date,
            r.payload->>'status', r.payload->>'source_kind', r.payload->>'source_ref', p_batch_id,
            coalesce(r.payload->>'review_status','none'), r.payload->>'note',
            coalesce((r.payload->>'in_original_plan')::boolean, false), coalesce((r.payload->>'in_current_plan')::boolean, true))
    returning id into v_new;
    if r.payload->>'change_kind' in ('added','baseline_added') then
      insert into public.leave_plan_changes (employee_id, change_kind, current_record_id, to_start, to_end, evidence, note, source_batch_id)
      values (v_emp, r.payload->>'change_kind', v_new, (r.payload->>'start_date')::date, (r.payload->>'end_date')::date, r.payload->>'evidence', r.payload->>'change_note', p_batch_id);
    end if;
    update public.import_rows set applied = true, matched_employee_id = v_emp where id = r.id;
  end loop;

  -- 5b. unresolved grid absences whose dates moved between workbook versions. Only a record the import still
  --     owns (unresolved, pending review, no type) follows the source; a classified record is left alone.
  --     Always leaves a history row: "source data changed between workbook versions".
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'leave_record' and outcome = 'changed' and payload ? 'leave_record_id' and coalesce(payload->>'change_kind','dates_moved') = 'dates_moved' order by seq loop
    select * into v_orig from public.leave_records where id = (r.payload->>'leave_record_id')::uuid;
    if v_orig.id is not null and v_orig.status = 'unresolved' and v_orig.review_status = 'pending_review' and v_orig.absence_type_code is null then
      update public.leave_records set
        start_date = (r.payload->>'start_date')::date, end_date = (r.payload->>'end_date')::date,
        source_ref = coalesce(r.payload->>'source_ref', source_ref), note = coalesce(r.payload->>'note', note), source_batch_id = p_batch_id
      where id = v_orig.id;
      insert into public.leave_plan_changes (employee_id, change_kind, current_record_id, from_start, from_end, to_start, to_end, evidence, note, source_batch_id)
      values (v_orig.employee_id, 'source_data_changed', v_orig.id, v_orig.start_date, v_orig.end_date, (r.payload->>'start_date')::date, (r.payload->>'end_date')::date,
              r.payload->>'source_ref', coalesce(r.payload->>'change_note', 'Source data changed between workbook versions'), p_batch_id);
      update public.import_rows set applied = true where id = r.id;
    else
      update public.import_rows set outcome = 'review', needs_review = true, message = coalesce(message, '') || ' — record was classified before commit; not updated' where id = r.id;
    end if;
  end loop;

  -- 5c. rescheduled PV blocks: the original record leaves the current plan (status rescheduled, kept in history),
  --     a new current record is created and linked both ways.
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'leave_record' and outcome = 'changed' and payload ? 'rescheduled_from_id' order by seq loop
    select * into v_orig from public.leave_records where id = (r.payload->>'rescheduled_from_id')::uuid;
    -- an original already split by an earlier row of this same batch may receive further pieces
    if v_orig.id is null or v_orig.hand_corrected or (not v_orig.in_current_plan and not (v_orig.status = 'rescheduled' and v_orig.source_batch_id = p_batch_id)) then
      update public.import_rows set outcome = 'review', needs_review = true, message = coalesce(message, '') || ' — original record no longer current (or corrected by hand) at commit; not applied' where id = r.id; continue;
    end if;
    insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref, source_batch_id, review_status, note, in_original_plan, in_current_plan, rescheduled_from)
    values (v_orig.employee_id, coalesce(nullif(r.payload->>'absence_type_code',''), v_orig.absence_type_code), (r.payload->>'start_date')::date, (r.payload->>'end_date')::date,
            coalesce(r.payload->>'status', 'approved'), coalesce(r.payload->>'source_kind', 'pv_schedule'), r.payload->>'source_ref', p_batch_id, 'none', r.payload->>'note', false, true, v_orig.id)
    returning id into v_new;
    if v_orig.in_current_plan then
      update public.leave_records set in_current_plan = false, status = 'rescheduled', superseded_by = v_new, source_batch_id = p_batch_id where id = v_orig.id;
    end if;
    insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, current_record_id, from_start, from_end, to_start, to_end, evidence, note, source_batch_id)
    values (v_orig.employee_id, 'rescheduled', v_orig.id, v_new, v_orig.start_date, v_orig.end_date, (r.payload->>'start_date')::date, (r.payload->>'end_date')::date, r.payload->>'evidence', r.payload->>'change_note', p_batch_id);
    update public.import_rows set applied = true, matched_employee_id = v_orig.employee_id where id = r.id;
  end loop;

  -- 5d. PV blocks no longer in the current plan: cancelled (kept in history; never deleted).
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'leave_record' and outcome = 'changed' and payload ? 'leave_record_id' and payload->>'change_kind' = 'cancelled' order by seq loop
    select * into v_orig from public.leave_records where id = (r.payload->>'leave_record_id')::uuid;
    if v_orig.id is null or not v_orig.in_current_plan or v_orig.hand_corrected then
      update public.import_rows set outcome = 'review', needs_review = true, message = coalesce(message, '') || ' — record no longer current (or corrected by hand) at commit; not applied' where id = r.id; continue;
    end if;
    update public.leave_records set in_current_plan = false, status = 'cancelled', source_batch_id = p_batch_id where id = v_orig.id;
    insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, from_start, from_end, evidence, note, source_batch_id)
    values (v_orig.employee_id, 'cancelled', v_orig.id, v_orig.start_date, v_orig.end_date, r.payload->>'evidence', r.payload->>'change_note', p_batch_id);
    update public.import_rows set applied = true, matched_employee_id = v_orig.employee_id where id = r.id;
  end loop;

  -- 5e. current leave not marked on the monthly sheets: not taken on these dates. Leaves the current plan with
  --     status 'rescheduled' (kept in history, never deleted) and a 'rescheduled' history row without new dates.
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'leave_record' and outcome = 'changed' and payload ? 'leave_record_id' and payload->>'change_kind' = 'not_taken' order by seq loop
    select * into v_orig from public.leave_records where id = (r.payload->>'leave_record_id')::uuid;
    if v_orig.id is null or not v_orig.in_current_plan or v_orig.source_kind = 'manual' or v_orig.hand_corrected then
      update public.import_rows set outcome = 'review', needs_review = true, message = coalesce(message, '') || ' — record no longer current (or entered by hand) at commit; not applied' where id = r.id; continue;
    end if;
    update public.leave_records set in_current_plan = false, status = 'rescheduled', source_batch_id = p_batch_id,
      note = concat_ws(' | ', note, coalesce(r.payload->>'change_note', 'Not marked on the monthly sheets'))
    where id = v_orig.id;
    insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, from_start, from_end, evidence, note, source_batch_id)
    values (v_orig.employee_id, 'rescheduled', v_orig.id, v_orig.start_date, v_orig.end_date, r.payload->>'evidence', coalesce(r.payload->>'change_note', 'Not marked on the monthly sheets'), p_batch_id);
    update public.import_rows set applied = true, matched_employee_id = v_orig.employee_id where id = r.id;
  end loop;

  -- 6. performance (upsert per employee/year)
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'performance' and outcome in ('new','changed') order by seq loop
    v_emp := coalesce(r.matched_employee_id, (select id from public.employees where employee_number = r.employee_number));
    if v_emp is null then continue; end if;
    insert into public.employee_performance (employee_id, year, perf_level, increment_pct, warnings, appreciation_letters, screening_eligibility, reported_as_of, source_batch_id)
    values (v_emp, (r.payload->>'year')::int, (r.payload->>'perf_level')::numeric, (r.payload->>'increment_pct')::numeric,
            (r.payload->>'warnings')::boolean, (r.payload->>'appreciation_letters')::int, r.payload->>'screening_eligibility',
            (r.payload->>'reported_as_of')::date, p_batch_id)
    on conflict (employee_id, year) do update set
      perf_level = excluded.perf_level, increment_pct = excluded.increment_pct, warnings = excluded.warnings,
      appreciation_letters = excluded.appreciation_letters, screening_eligibility = excluded.screening_eligibility,
      reported_as_of = excluded.reported_as_of, source_batch_id = excluded.source_batch_id, updated_at = now();
    update public.import_rows set applied = true, matched_employee_id = v_emp where id = r.id;
  end loop;

  -- 7. sick leave yearly totals (replace, never add)
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'sick_total' and outcome in ('new','changed') order by seq loop
    v_emp := coalesce(r.matched_employee_id, (select id from public.employees where employee_number = r.employee_number));
    if v_emp is null then continue; end if;
    insert into public.sick_leave_totals (employee_id, year, days, reported_as_of, source_batch_id)
    values (v_emp, (r.payload->>'year')::int, (r.payload->>'days')::int, (r.payload->>'reported_as_of')::date, p_batch_id)
    on conflict (employee_id, year) do update set
      days = excluded.days, reported_as_of = excluded.reported_as_of, source_batch_id = excluded.source_batch_id, updated_at = now();
    update public.import_rows set applied = true, matched_employee_id = v_emp where id = r.id;
  end loop;

  -- 8. counts and status
  select jsonb_build_object(
    'read',      count(*),
    'matched',   count(*) filter (where entity_kind = 'employee' and outcome in ('changed','unchanged')),
    'changed',   count(*) filter (where entity_kind = 'employee' and outcome = 'changed'),
    'new',       count(*) filter (where entity_kind = 'employee' and outcome = 'new'),
    'unmatched', count(*) filter (where outcome = 'unmatched'),
    'ignored',   count(*) filter (where outcome = 'ignored_out_of_scope'),
    'error',     count(*) filter (where outcome = 'error'),
    'review',    count(*) filter (where needs_review),
    'applied',   count(*) filter (where applied)
  ) into v_counts from public.import_rows where batch_id = p_batch_id;

  update public.import_batches set
    status = 'committed', committed_at = now(),
    records_read = (v_counts->>'read')::int, records_matched = (v_counts->>'matched')::int,
    records_changed = (v_counts->>'changed')::int, records_new = (v_counts->>'new')::int,
    records_unmatched = (v_counts->>'unmatched')::int, records_ignored = (v_counts->>'ignored')::int,
    records_error = (v_counts->>'error')::int, records_review = (v_counts->>'review')::int,
    summary = summary || v_counts
  where id = p_batch_id;

  return v_counts;
end $$;
