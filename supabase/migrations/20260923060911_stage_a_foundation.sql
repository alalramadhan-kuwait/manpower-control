-- =============================================================================
-- Area 4 Manpower Control — Stage A foundation
-- Project: area4-manpower-control (fhnqaurtryfmmomvzrpl). Standalone; no relation
-- to any Time Keeper database.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- roles/users
create table public.app_roles (
  code        text primary key,
  label       text not null,
  is_active   boolean not null default true,
  sort_order  int  not null default 100
);

create table public.user_profiles (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  role_code     text not null references public.app_roles(code),
  display_name  text not null,
  employee_id   uuid,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Role helpers. SECURITY DEFINER so RLS policies can call them without recursion.
create or replace function public.app_current_role()
returns text language sql stable security definer set search_path = public as $$
  select role_code from public.user_profiles
  where auth_user_id = auth.uid() and is_active
  limit 1
$$;

create or replace function public.app_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() in ('section_head','manpower_coordinator'), false)
$$;

create or replace function public.app_is_section_head()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_current_role() = 'section_head', false)
$$;

-- --------------------------------------------------------------- organisation
create table public.areas (
  id    uuid primary key default gen_random_uuid(),
  code  text not null unique,
  name  text not null
);

create table public.sections (
  id       uuid primary key default gen_random_uuid(),
  area_id  uuid not null references public.areas(id),
  code     text not null unique,
  name     text not null
);

create table public.crews (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code in ('A','B','C','D')),
  name        text not null,
  sort_order  int not null
);

-- category drives the manpower engine later: controller / panel / field / other
create table public.positions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  label       text not null,
  category    text not null check (category in ('controller','panel','field','other')),
  sort_order  int not null default 100
);

-- ------------------------------------------------------------------ employees
create table public.employees (
  id                    uuid primary key default gen_random_uuid(),
  employee_number       text not null unique,
  full_name             text not null,
  short_name            text,
  employment_type       text not null default 'knpc' check (employment_type in ('knpc','contractor')),
  employment_type_source text not null default 'inferred' check (employment_type_source in ('inferred','confirmed')),
  section_id            uuid references public.sections(id),
  in_unit12_scope       boolean not null default true,
  grade                 int,
  master_position       text,
  cost_center           text,
  join_date             date,
  normalization_date    date,
  last_promotion_date   date,
  position_start_date   date,
  education             text,
  service_years         numeric,
  years_in_grade        numeric,
  is_active             boolean not null default true,
  notes                 text,
  source_batch_id       uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index employees_scope_idx on public.employees (in_unit12_scope, is_active);

-- Operating role and permanent (home) crew, time-bounded so permanent moves keep history.
create table public.employee_role_assignments (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.employees(id) on delete cascade,
  position_id      uuid not null references public.positions(id),
  home_crew_id     uuid references public.crews(id),
  effective_from   date not null,
  effective_to     date,
  source           text not null default 'manual' check (source in ('manual','import')),
  source_ref       text,
  source_batch_id  uuid,
  note             text,
  created_at       timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index employee_role_current_uq on public.employee_role_assignments (employee_id) where effective_to is null;
create index employee_role_emp_idx on public.employee_role_assignments (employee_id, effective_from);

-- Qualifications are their own records; never derived permanently from a job title.
create table public.employee_qualifications (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.employees(id) on delete cascade,
  qualification    text not null check (qualification in ('take_charge','panel_operator','acting_controller','controller')),
  status           text not null check (status in ('yes','no','not_yet_confirmed')),
  effective_from   date not null default current_date,
  effective_to     date,
  source           text not null default 'manual' check (source in ('manual','import_inference')),
  evidence         text,
  source_batch_id  uuid,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index employee_qual_current_uq on public.employee_qualifications (employee_id, qualification) where effective_to is null;

create table public.employee_performance (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references public.employees(id) on delete cascade,
  year                   int not null,
  perf_level             numeric,
  increment_pct          numeric,
  warnings               boolean,
  appreciation_letters   int,
  screening_eligibility  text,
  reported_as_of         date,
  source_batch_id        uuid,
  updated_at             timestamptz not null default now(),
  unique (employee_id, year)
);

-- Yearly totals as reported by the promotion master. Re-imports REPLACE the value for
-- the same employee/year; they never add to it (rule 35).
create table public.sick_leave_totals (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.employees(id) on delete cascade,
  year             int not null,
  days             int not null,
  reported_as_of   date,
  source_batch_id  uuid,
  updated_at       timestamptz not null default now(),
  unique (employee_id, year)
);

-- ------------------------------------------------------------------- absences
create table public.absence_types (
  code               text primary key,
  label              text not null,
  reduces_manpower   boolean not null default true,
  requires_approval  boolean not null default true,
  is_active          boolean not null default true,
  sort_order         int not null default 100
);

-- Approved / current operational absences. Requests (Stage F) live in separate tables.
-- absence_type_code NULL + status 'unresolved' = imported from source without a provable type.
create table public.leave_records (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees(id) on delete cascade,
  absence_type_code  text references public.absence_types(code),
  start_date         date not null,
  end_date           date not null,
  status             text not null check (status in ('planned','approved','unresolved','cancelled')),
  source_kind        text not null check (source_kind in ('pv_schedule','monthly_grid','manual')),
  source_ref         text,
  source_batch_id    uuid,
  review_status      text not null default 'none' check (review_status in ('none','pending_review','resolved')),
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (end_date >= start_date),
  check (status <> 'unresolved' or absence_type_code is null)
);
create index leave_records_emp_idx on public.leave_records (employee_id, start_date);
create index leave_records_dates_idx on public.leave_records (start_date, end_date);

-- -------------------------------------------------------------------- imports
create table public.import_batches (
  id                  uuid primary key default gen_random_uuid(),
  import_type         text not null check (import_type in ('u12_manpower_workbook','promotion_master','contractors')),
  file_name           text not null,
  file_hash           text,
  imported_by         uuid,
  imported_by_label   text,
  source_as_of_date   date,
  period_start        date,
  period_end          date,
  records_read        int not null default 0,
  records_matched     int not null default 0,
  records_changed     int not null default 0,
  records_new         int not null default 0,
  records_unmatched   int not null default 0,
  records_ignored     int not null default 0,
  records_error       int not null default 0,
  records_review      int not null default 0,
  errors              jsonb not null default '[]'::jsonb,
  summary             jsonb not null default '{}'::jsonb,
  status              text not null default 'previewed' check (status in ('previewed','committed','aborted')),
  created_at          timestamptz not null default now(),
  committed_at        timestamptz
);

create table public.import_rows (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             uuid not null references public.import_batches(id) on delete cascade,
  seq                  int not null,
  sheet                text,
  row_ref              text,
  entity_kind          text not null check (entity_kind in ('employee','role_assignment','qualification','leave_record','performance','sick_total','note')),
  employee_number      text,
  matched_employee_id  uuid references public.employees(id),
  outcome              text not null check (outcome in ('new','changed','unchanged','unmatched','ignored_out_of_scope','review','error')),
  needs_review         boolean not null default false,
  raw                  jsonb,
  payload              jsonb,
  diff                 jsonb,
  message              text,
  applied              boolean not null default false
);
create index import_rows_batch_idx on public.import_rows (batch_id, outcome);

-- ---------------------------------------------------------------------- audit
create table public.audit_log (
  id                    uuid primary key default gen_random_uuid(),
  actor_id              uuid,
  entity_table          text not null,
  entity_id             uuid,
  action                text not null,
  previous              jsonb,
  next                  jsonb,
  reason                text,
  related_employee_id   uuid,
  batch_id              uuid,
  occurred_at           timestamptz not null default now()
);
create index audit_log_entity_idx on public.audit_log (entity_table, entity_id);
create index audit_log_employee_idx on public.audit_log (related_employee_id, occurred_at desc);

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_emp uuid;
begin
  if tg_table_name = 'employees' then
    v_emp := (v_row->>'id')::uuid;
  else
    v_emp := nullif(v_row->>'employee_id','')::uuid;
  end if;
  insert into public.audit_log (actor_id, entity_table, entity_id, action, previous, next, related_employee_id, batch_id)
  values (
    auth.uid(), tg_table_name, (v_row->>'id')::uuid, lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    v_emp,
    nullif(v_row->>'source_batch_id','')::uuid
  );
  return coalesce(new, old);
end $$;

create trigger employees_audit after insert or update or delete on public.employees
  for each row execute function public.audit_row_change();
create trigger employee_role_assignments_audit after insert or update or delete on public.employee_role_assignments
  for each row execute function public.audit_row_change();
create trigger employee_qualifications_audit after insert or update or delete on public.employee_qualifications
  for each row execute function public.audit_row_change();
create trigger leave_records_audit after insert or update or delete on public.leave_records
  for each row execute function public.audit_row_change();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger employees_touch before update on public.employees for each row execute function public.touch_updated_at();
create trigger leave_records_touch before update on public.leave_records for each row execute function public.touch_updated_at();
create trigger user_profiles_touch before update on public.user_profiles for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------ commit function
-- Applies a previewed batch in one transaction. The client stages rows with a fully
-- resolved payload; nothing is written to operational tables until this runs.
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

-- ------------------------------------------------------------------- RLS
alter table public.app_roles                 enable row level security;
alter table public.user_profiles             enable row level security;
alter table public.areas                     enable row level security;
alter table public.sections                  enable row level security;
alter table public.crews                     enable row level security;
alter table public.positions                 enable row level security;
alter table public.employees                 enable row level security;
alter table public.employee_role_assignments enable row level security;
alter table public.employee_qualifications   enable row level security;
alter table public.employee_performance      enable row level security;
alter table public.sick_leave_totals         enable row level security;
alter table public.absence_types             enable row level security;
alter table public.leave_records             enable row level security;
alter table public.import_batches            enable row level security;
alter table public.import_rows               enable row level security;
alter table public.audit_log                 enable row level security;

-- reference data: any signed-in user may read; only the Section Head may change
create policy ref_read_roles      on public.app_roles     for select to authenticated using (true);
create policy ref_read_areas      on public.areas         for select to authenticated using (true);
create policy ref_read_sections   on public.sections      for select to authenticated using (true);
create policy ref_read_crews      on public.crews         for select to authenticated using (true);
create policy ref_read_positions  on public.positions     for select to authenticated using (true);
create policy ref_read_abs_types  on public.absence_types for select to authenticated using (true);
create policy ref_write_abs_types on public.absence_types for all to authenticated using (public.app_is_section_head()) with check (public.app_is_section_head());
create policy ref_write_positions on public.positions     for all to authenticated using (public.app_is_section_head()) with check (public.app_is_section_head());

-- user profiles: read own row; staff read all; Section Head manages
create policy profiles_read_own   on public.user_profiles for select to authenticated using (auth_user_id = auth.uid() or public.app_is_staff());
create policy profiles_manage     on public.user_profiles for all to authenticated using (public.app_is_section_head()) with check (public.app_is_section_head());

-- operational data: staff (Section Head + Manpower Coordinator) read and write
create policy staff_all_employees   on public.employees                 for all to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
create policy staff_all_roles       on public.employee_role_assignments for all to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
create policy staff_all_quals       on public.employee_qualifications   for all to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
create policy staff_all_perf        on public.employee_performance      for all to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
create policy staff_all_sick        on public.sick_leave_totals         for all to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
create policy staff_all_leave       on public.leave_records             for all to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
create policy staff_all_batches     on public.import_batches            for all to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
create policy staff_all_import_rows on public.import_rows               for all to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
create policy staff_read_audit      on public.audit_log                 for select to authenticated using (public.app_is_staff());

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
revoke execute on function public.commit_import_batch(uuid) from public, anon;
grant execute on function public.commit_import_batch(uuid) to authenticated;

-- ---------------------------------------------------------------------- seed
insert into public.app_roles (code, label, is_active, sort_order) values
  ('section_head',         'Section Head',          true,  10),
  ('manpower_coordinator', 'Manpower Coordinator',  true,  20),
  ('controller',           'Controller',            false, 30),
  ('employee',             'Employee / Operator',   false, 40);

insert into public.areas (code, name) values ('A4', 'Operations Area 4 (MAB)');
insert into public.sections (area_id, code, name)
  select id, 'A4-S1-U12', 'Section 1 — Unit 12 (ARDS)' from public.areas where code = 'A4';

insert into public.crews (code, name, sort_order) values
  ('A','A Shift',1), ('B','B Shift',2), ('C','C Shift',3), ('D','D Shift',4);

insert into public.positions (code, label, category, sort_order) values
  ('controller',            'Controller',                   'controller', 10),
  ('vr_controller',         'Vacation Relief Controller',   'controller', 11),
  ('morning_controller',    'Morning Controller',           'controller', 12),
  ('panel_operator',        'Panel Operator',               'panel',      20),
  ('field_operator',        'Field Operator',               'field',      30),
  ('section_head',          'Section Head',                 'other',      90),
  ('operating_engineer',    'Operating Engineer',           'other',      91),
  ('trainee',               'Trainee',                      'other',      92);

insert into public.absence_types (code, label, reduces_manpower, requires_approval, is_active, sort_order) values
  ('annual_leave_planned',   'Planned Annual Leave',             true,  true,  true, 10),
  ('annual_leave_rescheduled','Rescheduled Leave',               true,  true,  true, 11),
  ('annual_leave_unscheduled','Unscheduled Leave',               true,  true,  true, 12),
  ('leave_extension',        'Leave Extension',                  true,  true,  true, 13),
  ('personal_qb',            'Personal QB',                      true,  true,  true, 20),
  ('short_leave',            'Short Leave',                      true,  true,  true, 21),
  ('sick_leave',             'Sick Leave',                       true,  false, true, 30),
  ('long_sick',              'Long Sick Leave',                  true,  false, true, 31),
  ('medical_absence',        'Expected Surgery / Medical Absence', true, false, true, 32),
  ('hajj_leave',             'Hajj Leave',                       true,  true,  true, 40),
  ('study_leave',            'Study Leave',                      true,  true,  true, 41),
  ('course',                 'Course',                           true,  true,  true, 42),
  ('long_course',            'Long Course',                      true,  true,  true, 43),
  ('special_leave',          'Special Leave',                    true,  true,  true, 44),
  ('other_known_absence',    'Other Known Absence',              true,  true,  true, 90);
