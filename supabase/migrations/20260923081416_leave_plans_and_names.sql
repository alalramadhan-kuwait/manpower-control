-- Leave plans and employee names.
--
-- 1. Two leave plans per employee: the ORIGINAL annual plan ("PV Scheduled", baseline, historical) and the
--    CURRENT approved plan ("PV Scheduled Updated"). A record can belong to both (unchanged block), only to
--    the original (rescheduled or cancelled later), or only to the current (added or rescheduled-to).
--    Manpower, conflicts and availability use the CURRENT plan only (see leave_current_v).
-- 2. leave_plan_changes is the explicit change history: Original plan → Current plan → history.
-- 3. employees.full_name becomes official_name (the Promotion Master name, never shortened) and
--    display_name is added (first + last word for confirmed KNPC staff, workbook name otherwise).

-- ------------------------------------------------------------------ leave plans
alter table public.leave_records
  add column in_original_plan boolean not null default false,
  add column in_current_plan  boolean not null default true,
  add column superseded_by    uuid references public.leave_records(id),
  add column rescheduled_from uuid references public.leave_records(id);
alter table public.leave_records drop constraint leave_records_status_check;
alter table public.leave_records add constraint leave_records_status_check
  check (status in ('planned','approved','unresolved','cancelled','rescheduled'));
-- a rescheduled/cancelled record never counts as current
alter table public.leave_records add constraint leave_records_current_status_check
  check (not in_current_plan or status in ('planned','approved','unresolved'));
comment on column public.leave_records.in_original_plan is 'Block is part of the original annual plan (PV Scheduled baseline). Historical; never reduces current manpower on its own.';
comment on column public.leave_records.in_current_plan  is 'Block is part of the current approved plan (PV Scheduled Updated) or an operational absence. Only these reduce manpower.';

-- Baseline: every PV block loaded so far came from the original sheet and, at that time, the updated sheet was identical.
update public.leave_records set in_original_plan = true where source_kind = 'pv_schedule';

create index leave_records_current_idx on public.leave_records (employee_id, start_date) where in_current_plan;

create table public.leave_plan_changes (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  change_kind        text not null check (change_kind in ('added','rescheduled','cancelled','source_data_changed','baseline_added')),
  original_record_id uuid references public.leave_records(id),
  current_record_id  uuid references public.leave_records(id),
  from_start         date,
  from_end           date,
  to_start           date,
  to_end             date,
  evidence           text,
  note               text,
  source_batch_id    uuid references public.import_batches(id),
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now()
);
create index leave_plan_changes_emp_idx on public.leave_plan_changes (employee_id, created_at);
alter table public.leave_plan_changes enable row level security;
create policy staff_all_leave_changes on public.leave_plan_changes for all to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
grant select, insert, update on public.leave_plan_changes to authenticated;

-- What reduces manpower today.
create or replace view public.leave_current_v with (security_invoker = true) as
select l.* from public.leave_records l
where l.in_current_plan and l.status in ('planned','approved','unresolved');
grant select on public.leave_current_v to authenticated;

-- ------------------------------------------------------------------ names
drop view public.employee_directory_v;
alter table public.employees rename column full_name to official_name;
alter table public.employees add column display_name text;
comment on column public.employees.official_name is 'Full name as listed in the KNPC Promotion Master (contractors: workbook name until an official source exists). Never shortened.';
comment on column public.employees.display_name  is 'Readable name shown on screens: first + last word of official_name for confirmed KNPC staff, workbook short name otherwise.';
update public.employees e set display_name =
  case when e.employment_type = 'knpc' and e.employment_type_source = 'confirmed' and coalesce(trim(e.official_name), '') <> '' then
    initcap(split_part(regexp_replace(trim(e.official_name), '\s+', ' ', 'g'), ' ', 1))
    || case when position(' ' in regexp_replace(trim(e.official_name), '\s+', ' ', 'g')) > 0
            then ' ' || initcap(regexp_replace(regexp_replace(trim(e.official_name), '\s+', ' ', 'g'), '^.* ', ''))
            else '' end
  else coalesce(nullif(trim(e.short_name), ''), e.official_name) end;
alter table public.employees alter column display_name set not null;

create view public.employee_directory_v
with (security_invoker = true) as
select
  e.id, e.employee_number, e.official_name, e.display_name, e.short_name, e.employment_type, e.employment_type_source,
  e.in_unit12_scope, e.is_active, e.grade, e.master_position, e.cost_center, e.join_date,
  e.normalization_date, e.last_promotion_date, e.position_start_date, e.education, e.service_years,
  e.years_in_grade, e.notes, e.created_at, e.updated_at,
  s.code as section_code, s.name as section_name,
  ra.id as role_assignment_id, ra.effective_from as role_effective_from,
  p.code as position_code, p.label as position_label, p.category as position_category,
  c.code as crew_code,
  (select q.status from public.employee_qualifications q where q.employee_id = e.id and q.qualification = 'take_charge'       and q.effective_to is null) as take_charge_status,
  (select q.status from public.employee_qualifications q where q.employee_id = e.id and q.qualification = 'panel_operator'    and q.effective_to is null) as panel_operator_status,
  (select q.status from public.employee_qualifications q where q.employee_id = e.id and q.qualification = 'acting_controller' and q.effective_to is null) as acting_controller_status,
  (select q.status from public.employee_qualifications q where q.employee_id = e.id and q.qualification = 'controller'        and q.effective_to is null) as controller_status,
  (select count(*) from public.leave_records l where l.employee_id = e.id and l.status = 'unresolved') as unresolved_absences
from public.employees e
left join public.sections s on s.id = e.section_id
left join public.employee_role_assignments ra on ra.employee_id = e.id and ra.effective_to is null
left join public.positions p on p.id = ra.position_id
left join public.crews c on c.id = ra.home_crew_id;
grant select on public.employee_directory_v to authenticated;

-- ------------------------------------------------------------------ commit function
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
    if v_orig.id is null or not v_orig.in_current_plan then
      update public.import_rows set outcome = 'review', needs_review = true, message = coalesce(message, '') || ' — original record no longer current at commit; not applied' where id = r.id; continue;
    end if;
    insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref, source_batch_id, review_status, note, in_original_plan, in_current_plan, rescheduled_from)
    values (v_orig.employee_id, coalesce(nullif(r.payload->>'absence_type_code',''), v_orig.absence_type_code), (r.payload->>'start_date')::date, (r.payload->>'end_date')::date,
            coalesce(r.payload->>'status', 'approved'), 'pv_schedule', r.payload->>'source_ref', p_batch_id, 'none', r.payload->>'note', false, true, v_orig.id)
    returning id into v_new;
    update public.leave_records set in_current_plan = false, status = 'rescheduled', superseded_by = v_new, source_batch_id = p_batch_id where id = v_orig.id;
    insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, current_record_id, from_start, from_end, to_start, to_end, evidence, note, source_batch_id)
    values (v_orig.employee_id, 'rescheduled', v_orig.id, v_new, v_orig.start_date, v_orig.end_date, (r.payload->>'start_date')::date, (r.payload->>'end_date')::date, r.payload->>'evidence', r.payload->>'change_note', p_batch_id);
    update public.import_rows set applied = true, matched_employee_id = v_orig.employee_id where id = r.id;
  end loop;

  -- 5d. PV blocks no longer in the current plan: cancelled (kept in history; never deleted).
  for r in select * from public.import_rows where batch_id = p_batch_id and entity_kind = 'leave_record' and outcome = 'changed' and payload ? 'leave_record_id' and payload->>'change_kind' = 'cancelled' order by seq loop
    select * into v_orig from public.leave_records where id = (r.payload->>'leave_record_id')::uuid;
    if v_orig.id is null or not v_orig.in_current_plan then
      update public.import_rows set outcome = 'review', needs_review = true, message = coalesce(message, '') || ' — record no longer current at commit; not applied' where id = r.id; continue;
    end if;
    update public.leave_records set in_current_plan = false, status = 'cancelled', source_batch_id = p_batch_id where id = v_orig.id;
    insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, from_start, from_end, evidence, note, source_batch_id)
    values (v_orig.employee_id, 'cancelled', v_orig.id, v_orig.start_date, v_orig.end_date, r.payload->>'evidence', r.payload->>'change_note', p_batch_id);
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
