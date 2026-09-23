-- Import Center: an unresolved absence already in the register may move when a newer workbook is imported.
-- The planner stages such a row as outcome 'changed' with payload.leave_record_id; the commit applies it in
-- step 5b below. The rest of the function is unchanged from the Stage A foundation.
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
      employee_number, full_name, short_name, employment_type, employment_type_source, section_id, in_unit12_scope,
      grade, master_position, cost_center, join_date, normalization_date, last_promotion_date, position_start_date,
      education, service_years, years_in_grade, notes, source_batch_id)
    values (
      r.payload->>'employee_number',
      coalesce(r.payload->>'full_name', r.payload->>'short_name'),
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
      full_name            = case when r.payload ? 'full_name'            then r.payload->>'full_name'                       else e.full_name end,
      short_name           = case when r.payload ? 'short_name'           then r.payload->>'short_name'                      else e.short_name end,
      employment_type      = case when r.payload ? 'employment_type'      then r.payload->>'employment_type'                 else e.employment_type end,
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
    -- close (or drop) a differing current assignment
    delete from public.employee_role_assignments
      where employee_id = v_emp and effective_to is null and effective_from >= v_from
        and (position_id is distinct from v_pos or home_crew_id is distinct from v_crew);
    update public.employee_role_assignments set effective_to = v_from - 1
      where employee_id = v_emp and effective_to is null
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

  -- 5. leave records (planned annual leave from the PV sheet, or unresolved grid absences)
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'leave_record' and outcome in ('new','review') and payload is not null order by seq loop
    v_emp := coalesce(r.matched_employee_id, (select id from public.employees where employee_number = r.employee_number));
    if v_emp is null then
      update public.import_rows set outcome = 'error', message = 'employee not found at commit' where id = r.id; continue;
    end if;
    insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref, source_batch_id, review_status, note)
    values (v_emp, nullif(r.payload->>'absence_type_code',''), (r.payload->>'start_date')::date, (r.payload->>'end_date')::date,
            r.payload->>'status', r.payload->>'source_kind', r.payload->>'source_ref', p_batch_id,
            coalesce(r.payload->>'review_status','none'), r.payload->>'note');
    update public.import_rows set applied = true, matched_employee_id = v_emp where id = r.id;
  end loop;

  -- 5b. unresolved grid absences whose dates moved in a newer workbook. Only a record the import still owns
  --     (unresolved, pending review, no type) follows the source; anything classified by a person is left alone.
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'leave_record' and outcome = 'changed' and payload ? 'leave_record_id' order by seq loop
    update public.leave_records l set
      start_date = (r.payload->>'start_date')::date,
      end_date   = (r.payload->>'end_date')::date,
      source_ref = coalesce(r.payload->>'source_ref', l.source_ref),
      note       = coalesce(r.payload->>'note', l.note),
      source_batch_id = p_batch_id
    where l.id = (r.payload->>'leave_record_id')::uuid
      and l.status = 'unresolved' and l.review_status = 'pending_review' and l.absence_type_code is null;
    if found then
      update public.import_rows set applied = true where id = r.id;
    else
      update public.import_rows set outcome = 'review', needs_review = true, message = coalesce(message, '') || ' — record was classified before commit; not updated' where id = r.id;
    end if;
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
