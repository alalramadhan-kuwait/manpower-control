-- Annual vacation planning (owner, 27 Oct 2026): the next year's manpower allocation as an isolated, versioned planning
-- snapshot (never the employee directory), vacation periods with their source (manual / form / system), the Day
-- Supervisor rotation, uploaded forms (private storage), the rolling 12-month sick-leave Excel import matched by a
-- one-way hash of the Civil ID (the ID itself is never stored), and the Section Head approvals that need a fresh
-- server check (edge function vacation-plan, the app's own engine): manpower allocation, and the annual plan, which
-- is approved and published to the leave records in one transaction. 2026 records are not touched.

-- ── tables ──────────────────────────────────────────────────────────────────────────────────────────────────────
create table public.pv_allocs (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2000 and 2100),
  version integer not null default 1 check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  snapshot jsonb,
  approved_at timestamptz, approved_by uuid, approved_by_name text,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (year, version)
);
create unique index pv_allocs_one_live on public.pv_allocs (year) where status <> 'superseded';

create table public.pv_alloc_rows (
  id uuid primary key default gen_random_uuid(),
  alloc_id uuid not null references public.pv_allocs(id),
  employee_id uuid not null references public.employees(id),
  grp text not null check (grp in ('controller', 'panel', 'field', 'relief', 'excluded')),
  crew text check (crew in ('A', 'B', 'C', 'D')),
  relief text check (relief in ('vr', 'day_supervisor', 'float_panel', 'day_duty')),
  cycle_crew text check (cycle_crew in ('A', 'B', 'C', 'D')),
  acting text not null default 'auto' check (acting in ('auto', 'yes', 'no')),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (alloc_id, employee_id)
);

create table public.pv_alloc_events (
  id uuid primary key default gen_random_uuid(),
  alloc_id uuid not null references public.pv_allocs(id),
  action text not null check (action in ('init', 'set', 'switch', 'undo', 'approved', 'reopened')),
  employee_ids uuid[] not null default '{}',
  before jsonb, after jsonb, note text,
  actor uuid default auth.uid(), actor_name text,
  at timestamptz not null default now(),
  undone_at timestamptz
);
create index pv_alloc_events_alloc on public.pv_alloc_events (alloc_id, at desc);

create table public.pv_day_rotation (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.pv_plans(id),
  employee_id uuid references public.employees(id),
  start_date date not null, end_date date not null check (end_date >= start_date),
  source text not null default 'agreed' check (source in ('agreed', 'proposed')),
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  removed_at timestamptz, removed_by uuid
);

create table public.pv_server_checks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('alloc', 'plan')),
  year integer not null,
  fingerprint text not null,
  ok boolean not null,
  result jsonb not null default '{}'::jsonb,
  created_for uuid not null,
  created_at timestamptz not null default now()
);

create table public.pv_form_uploads (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.pv_plans(id),
  path text not null,
  file_name text not null,
  mime text,
  form_code text,
  status text not null default 'uploaded' check (status in ('uploaded', 'read', 'committed', 'discarded')),
  result jsonb,
  uploaded_by uuid default auth.uid(), uploaded_at timestamptz not null default now(),
  decided_by uuid, decided_at timestamptz
);

create table public.sick_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null, file_hash text,
  period_start date not null, period_end date not null check (period_end >= period_start),
  rows_read integer not null default 0, matched integer not null default 0, linked integer not null default 0,
  unmatched integer not null default 0, changed integer not null default 0,
  summary jsonb,
  imported_by uuid default auth.uid(), imported_by_name text,
  imported_at timestamptz not null default now()
);

-- the Civil ID is kept only as a one-way hash (and its last 4 digits to recognise it): enough to match the next file
create table public.employee_civil_ids (
  employee_id uuid primary key references public.employees(id),
  civil_hash text not null unique check (civil_hash ~ '^[0-9a-f]{64}$'),
  last4 text check (last4 ~ '^[0-9]{4}$'),
  linked_by uuid default auth.uid(), linked_at timestamptz not null default now(),
  import_id uuid references public.sick_imports(id)
);

alter table public.sick_checks add column import_id uuid references public.sick_imports(id);
alter table public.pv_plan_blocks add column source text not null default 'manual' check (source in ('manual', 'form', 'system'));
alter table public.pv_plan_blocks add column upload_id uuid references public.pv_form_uploads(id);
alter table public.pv_plans add column alloc_version integer;

-- ── access: read for the manpower staff, writes only through the functions below ───────────────────────────────
alter table public.pv_allocs enable row level security;
alter table public.pv_alloc_rows enable row level security;
alter table public.pv_alloc_events enable row level security;
alter table public.pv_day_rotation enable row level security;
alter table public.pv_server_checks enable row level security;
alter table public.pv_form_uploads enable row level security;
alter table public.sick_imports enable row level security;
alter table public.employee_civil_ids enable row level security;
create policy pv_allocs_read on public.pv_allocs for select to authenticated using (public.app_is_staff());
create policy pv_alloc_rows_read on public.pv_alloc_rows for select to authenticated using (public.app_is_staff());
create policy pv_alloc_events_read on public.pv_alloc_events for select to authenticated using (public.app_is_staff());
create policy pv_day_rotation_read on public.pv_day_rotation for select to authenticated using (public.app_is_staff());
create policy pv_form_uploads_read on public.pv_form_uploads for select to authenticated using (public.app_is_staff());
create policy sick_imports_read on public.sick_imports for select to authenticated using (public.app_is_staff());
create policy employee_civil_ids_read on public.employee_civil_ids for select to authenticated using (public.app_is_staff());
-- pv_server_checks: no policy (written by the vacation-plan function with the service key, read by the approvals only)
revoke all on public.pv_allocs, public.pv_alloc_rows, public.pv_alloc_events, public.pv_day_rotation, public.pv_server_checks,
  public.pv_form_uploads, public.sick_imports, public.employee_civil_ids from anon;
revoke insert, update, delete, truncate, references, trigger on public.pv_allocs, public.pv_alloc_rows, public.pv_alloc_events,
  public.pv_day_rotation, public.pv_server_checks, public.pv_form_uploads, public.sick_imports, public.employee_civil_ids from authenticated;
revoke select on public.pv_server_checks from authenticated;
create trigger pv_allocs_touch before update on public.pv_allocs for each row execute function public.touch_updated_at();
create trigger pv_allocs_audit after insert or update or delete on public.pv_allocs for each row execute function public.audit_row_change();
create trigger employee_civil_ids_audit after insert or update or delete on public.employee_civil_ids for each row execute function public.audit_row_change();
create trigger sick_imports_audit after insert or update or delete on public.sick_imports for each row execute function public.audit_row_change();

-- uploaded vacation forms: a private bucket, the manpower staff only
insert into storage.buckets (id, name, public) values ('pv-forms', 'pv-forms', false) on conflict (id) do nothing;
create policy pv_forms_read on storage.objects for select to authenticated using (bucket_id = 'pv-forms' and public.app_is_staff());
create policy pv_forms_insert on storage.objects for insert to authenticated with check (bucket_id = 'pv-forms' and public.app_is_staff());

-- ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- A crew's first Morning day of a cycle (the roster: 8-day cycle, 2 Mar 2026 = B M1, Morning order B, C, A, D)
create or replace function public.pv_is_m1(p_crew text, p_day date) returns boolean language sql immutable set search_path to 'public' as $$
  select ((((p_day - date '2026-03-02') - case p_crew when 'B' then 0 when 'C' then 2 when 'A' then 4 when 'D' then 6 end) % 8) + 8) % 8 = 0
$$;

create or replace function public.pv_actor_name() returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce((select display_name from public.user_profiles where auth_user_id = auth.uid() limit 1), 'Staff')
$$;

-- the live allocation of a year (draft or approved), locked for the caller
create or replace function public.pv_alloc_live(p_year integer) returns public.pv_allocs language sql stable security definer set search_path to 'public' as $$
  select * from public.pv_allocs where year = p_year and status <> 'superseded'
$$;

create or replace function public.pv_row_json(r public.pv_alloc_rows) returns jsonb language sql immutable as $$
  select jsonb_build_object('employee_id', r.employee_id, 'grp', r.grp, 'crew', r.crew, 'relief', r.relief, 'cycle_crew', r.cycle_crew, 'acting', r.acting, 'note', r.note)
$$;

-- Fingerprints: what an approval was checked on. Any change in between makes the check stale.
create or replace function public.pv_alloc_fingerprint(p_year integer) returns text language sql stable security definer set search_path to 'public' as $$
  select md5(coalesce((select a.id::text || ':' || a.version::text || ':' || a.status from public.pv_allocs a where a.year = p_year and a.status <> 'superseded'), 'none')
    || '|' || coalesce((select string_agg(public.pv_row_json(r)::text, ',' order by r.employee_id)
                          from public.pv_alloc_rows r join public.pv_allocs a on a.id = r.alloc_id where a.year = p_year and a.status <> 'superseded'), '')
    || '|' || coalesce((select max(entered_at)::text from public.sick_checks), '') || '|' || coalesce((select max(imported_at)::text from public.oracle_stat_snapshots), '')
    || '|' || coalesce((select string_agg(e.id::text || coalesce(e.grade::text, '-') || coalesce(e.employment_type, '') || e.is_active::text, ',' order by e.id) from public.employees e where e.in_unit12_scope), ''))
$$;

create or replace function public.pv_plan_fingerprint(p_year integer) returns text language sql stable security definer set search_path to 'public' as $$
  select md5(public.pv_alloc_fingerprint(p_year)
    || '|' || coalesce((select string_agg(b.employee_id::text || b.start_date::text || b.end_date::text || b.source, ',' order by b.employee_id, b.start_date)
                          from public.pv_plan_blocks b join public.pv_plans p on p.id = b.plan_id where p.year = p_year and b.removed_at is null), '')
    || '|' || coalesce((select string_agg(l.id::text || l.start_date::text || coalesce(l.end_date::text, '') || l.status || l.in_current_plan::text || l.updated_at::text, ',' order by l.id)
                          from public.leave_records l where l.start_date <= make_date(p_year + 1, 1, 31) and coalesce(l.end_date, date '9999-12-31') >= make_date(p_year, 1, 1)), '')
    || '|' || coalesce((select string_agg(t.id::text || t.start_date::text || t.end_date::text || t.status, ',' order by t.id) from public.task_releases t
                          where t.start_date <= make_date(p_year + 1, 1, 31) and t.end_date >= make_date(p_year, 1, 1)), '')
    || '|' || coalesce((select string_agg(m.id::text || m.start_date::text || m.end_date::text || m.status, ',' order by m.id) from public.sd_members m join public.sd_plans s on s.id = m.plan_id
                          where s.status = 'active' and m.start_date <= make_date(p_year + 1, 1, 31) and m.end_date >= make_date(p_year, 1, 1)), ''))
$$;

-- ── manpower allocation ─────────────────────────────────────────────────────────────────────────────────────────
-- Start the year's allocation from where everyone stands (the app sends the rows); a no-op when one exists.
create or replace function public.pv_alloc_init(p_year integer, p_rows jsonb) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare a public.pv_allocs; r jsonb;
begin
  if not public.app_is_staff() then raise exception 'Only the manpower staff can prepare the vacation plan.' using errcode = 'insufficient_privilege'; end if;
  insert into public.pv_plans (year, status) values (p_year, 'draft') on conflict (year) do nothing;
  select * into a from public.pv_allocs where year = p_year and status <> 'superseded' for update;
  if a.id is not null then return a.id; end if;
  insert into public.pv_allocs (year) values (p_year) returning * into a;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into public.pv_alloc_rows (alloc_id, employee_id, grp, crew, relief, cycle_crew, acting, note)
    values (a.id, (r->>'employee_id')::uuid, r->>'grp', r->>'crew', r->>'relief', r->>'cycle_crew', coalesce(r->>'acting', 'auto'), r->>'note')
    on conflict (alloc_id, employee_id) do nothing;
  end loop;
  insert into public.pv_alloc_events (alloc_id, action, note, actor_name) values (a.id, 'init', 'Started from the current assignments', public.pv_actor_name());
  return a.id;
end $$;

create or replace function public.pv_alloc_draft(p_year integer) returns public.pv_allocs language plpgsql security definer set search_path to 'public' as $$
declare a public.pv_allocs;
begin
  if not public.app_is_staff() then raise exception 'Only the manpower staff can change the vacation plan.' using errcode = 'insufficient_privilege'; end if;
  select * into a from public.pv_allocs where year = p_year and status <> 'superseded' for update;
  if a.id is null then raise exception 'Start the % manpower allocation first.', p_year using errcode = 'check_violation'; end if;
  if a.status <> 'draft' then raise exception 'The % manpower allocation is approved: the Section Head reopens it for changes.', p_year using errcode = 'check_violation'; end if;
  return a;
end $$;

-- One person's planning place (the allocation only; the directory is never changed). Returns the event id (for Undo).
create or replace function public.pv_alloc_set(p_year integer, p_employee uuid, p_grp text, p_crew text, p_relief text, p_cycle_crew text, p_acting text, p_note text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare a public.pv_allocs; old public.pv_alloc_rows; new_row public.pv_alloc_rows; ev uuid;
begin
  a := public.pv_alloc_draft(p_year);
  if p_grp in ('controller', 'panel', 'field') and p_crew is null then raise exception 'Choose a shift.' using errcode = 'check_violation'; end if;
  if p_grp = 'relief' and p_relief is null then raise exception 'Choose the relief role.' using errcode = 'check_violation'; end if;
  select * into old from public.pv_alloc_rows where alloc_id = a.id and employee_id = p_employee for update;
  insert into public.pv_alloc_rows (alloc_id, employee_id, grp, crew, relief, cycle_crew, acting, note, updated_at, updated_by)
  values (a.id, p_employee, p_grp, case when p_grp in ('controller', 'panel', 'field') then p_crew end, case when p_grp = 'relief' then p_relief end,
          case when p_grp = 'relief' then p_cycle_crew end, coalesce(p_acting, 'auto'), p_note, now(), auth.uid())
  on conflict (alloc_id, employee_id) do update set grp = excluded.grp, crew = excluded.crew, relief = excluded.relief, cycle_crew = excluded.cycle_crew,
    acting = excluded.acting, note = excluded.note, updated_at = now(), updated_by = auth.uid()
  returning * into new_row;
  insert into public.pv_alloc_events (alloc_id, action, employee_ids, before, after, actor_name)
  values (a.id, 'set', array[p_employee], case when old.id is null then null else jsonb_build_array(public.pv_row_json(old)) end, jsonb_build_array(public.pv_row_json(new_row)), public.pv_actor_name())
  returning id into ev;
  update public.pv_allocs set updated_at = now(), updated_by = auth.uid() where id = a.id;
  return ev;
end $$;

-- Swap two people's planning places in one step.
create or replace function public.pv_alloc_switch(p_year integer, p_a uuid, p_b uuid) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare a public.pv_allocs; ra public.pv_alloc_rows; rb public.pv_alloc_rows; na public.pv_alloc_rows; nb public.pv_alloc_rows; ev uuid;
begin
  a := public.pv_alloc_draft(p_year);
  select * into ra from public.pv_alloc_rows where alloc_id = a.id and employee_id = p_a for update;
  select * into rb from public.pv_alloc_rows where alloc_id = a.id and employee_id = p_b for update;
  if ra.id is null or rb.id is null or p_a = p_b then raise exception 'Choose two people in the plan.' using errcode = 'check_violation'; end if;
  update public.pv_alloc_rows set grp = rb.grp, crew = rb.crew, relief = rb.relief, cycle_crew = rb.cycle_crew, updated_at = now(), updated_by = auth.uid() where id = ra.id returning * into na;
  update public.pv_alloc_rows set grp = ra.grp, crew = ra.crew, relief = ra.relief, cycle_crew = ra.cycle_crew, updated_at = now(), updated_by = auth.uid() where id = rb.id returning * into nb;
  insert into public.pv_alloc_events (alloc_id, action, employee_ids, before, after, actor_name)
  values (a.id, 'switch', array[p_a, p_b], jsonb_build_array(public.pv_row_json(ra), public.pv_row_json(rb)), jsonb_build_array(public.pv_row_json(na), public.pv_row_json(nb)), public.pv_actor_name())
  returning id into ev;
  update public.pv_allocs set updated_at = now(), updated_by = auth.uid() where id = a.id;
  return ev;
end $$;

-- Undo the latest change of the draft (or the given one, when it is still the latest not undone).
create or replace function public.pv_alloc_undo(p_year integer, p_event uuid default null) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare a public.pv_allocs; e public.pv_alloc_events; r jsonb;
begin
  a := public.pv_alloc_draft(p_year);
  select * into e from public.pv_alloc_events where alloc_id = a.id and action in ('set', 'switch') and undone_at is null order by at desc limit 1 for update;
  if e.id is null then raise exception 'Nothing to undo.' using errcode = 'check_violation'; end if;
  if p_event is not null and e.id <> p_event then raise exception 'A later change was made: undo that one first.' using errcode = 'check_violation'; end if;
  if e.before is null then
    update public.pv_alloc_rows set grp = 'excluded', crew = null, relief = null, cycle_crew = null, updated_at = now(), updated_by = auth.uid()
     where alloc_id = a.id and employee_id = any (e.employee_ids);
  else
    for r in select * from jsonb_array_elements(e.before) loop
      update public.pv_alloc_rows set grp = r->>'grp', crew = r->>'crew', relief = r->>'relief', cycle_crew = r->>'cycle_crew', acting = r->>'acting', note = r->>'note',
             updated_at = now(), updated_by = auth.uid()
       where alloc_id = a.id and employee_id = (r->>'employee_id')::uuid;
    end loop;
  end if;
  update public.pv_alloc_events set undone_at = now() where id = e.id;
  insert into public.pv_alloc_events (alloc_id, action, employee_ids, before, after, note, actor_name) values (a.id, 'undo', e.employee_ids, e.after, e.before, 'Undo', public.pv_actor_name());
  update public.pv_allocs set updated_at = now(), updated_by = auth.uid() where id = a.id;
  return e.id;
end $$;

-- Section Head: approve the allocation on a fresh, passing server check of exactly this allocation.
create or replace function public.pv_alloc_approve_checked(p_check uuid) returns integer language plpgsql security definer set search_path to 'public' as $$
declare c public.pv_server_checks; a public.pv_allocs;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head approves the manpower allocation.' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.pv_server_checks where id = p_check;
  if c.id is null or c.kind <> 'alloc' or c.created_for <> auth.uid() or c.created_at < now() - interval '15 minutes' then raise exception 'STALE_CHECK: run the check again.' using errcode = 'check_violation'; end if;
  select * into a from public.pv_allocs where year = c.year and status <> 'superseded' for update;
  if a.id is null or a.status <> 'draft' then raise exception 'There is no draft allocation to approve.' using errcode = 'check_violation'; end if;
  if c.fingerprint <> public.pv_alloc_fingerprint(c.year) then raise exception 'STALE_CHECK: the allocation changed after the check.' using errcode = 'check_violation'; end if;
  if not c.ok then raise exception 'Blocking issues remain: %', coalesce(c.result->>'reason', 'see the check') using errcode = 'check_violation'; end if;
  update public.pv_allocs set status = 'approved', snapshot = c.result->'snapshot', approved_at = now(), approved_by = auth.uid(), approved_by_name = public.pv_actor_name() where id = a.id;
  insert into public.pv_plans (year, status) values (c.year, 'draft') on conflict (year) do nothing;
  update public.pv_plans set alloc_version = a.version, updated_at = now() where year = c.year and status <> 'published';
  insert into public.pv_alloc_events (alloc_id, action, note, actor_name) values (a.id, 'approved', 'Manpower allocation approved', public.pv_actor_name());
  return a.version;
end $$;

-- Section Head: reopen an approved allocation as the next draft version (the approved one is kept, superseded).
create or replace function public.pv_alloc_reopen(p_year integer, p_reason text) returns integer language plpgsql security definer set search_path to 'public' as $$
declare a public.pv_allocs; n public.pv_allocs;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head reopens the manpower allocation.' using errcode = 'insufficient_privilege'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Say why it is reopened.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.pv_plans where year = p_year and status = 'published') then
    raise exception 'The % plan is published: change vacations in the Calendar.', p_year using errcode = 'check_violation'; end if;
  select * into a from public.pv_allocs where year = p_year and status = 'approved' for update;
  if a.id is null then raise exception 'There is no approved allocation to reopen.' using errcode = 'check_violation'; end if;
  update public.pv_allocs set status = 'superseded' where id = a.id;
  insert into public.pv_allocs (year, version, reopen_reason) values (p_year, a.version + 1, trim(p_reason)) returning * into n;
  insert into public.pv_alloc_rows (alloc_id, employee_id, grp, crew, relief, cycle_crew, acting, note)
    select n.id, employee_id, grp, crew, relief, cycle_crew, acting, note from public.pv_alloc_rows where alloc_id = a.id;
  insert into public.pv_alloc_events (alloc_id, action, note, actor_name) values (n.id, 'reopened', trim(p_reason), public.pv_actor_name());
  update public.pv_plans set status = 'draft', updated_at = now() where year = p_year and status in ('submitted', 'approved');
  return n.version;
end $$;

-- ── vacation periods ────────────────────────────────────────────────────────────────────────────────────────────
-- Replace one person's vacation blocks in the draft. Whole cycles of their rota only, inside the plan year, at most
-- five periods, no overlap; the person must be in the approved allocation. Staffing (slots, Controllers, minimums)
-- is checked by the app as you go and again on the server before approval.
create or replace function public.pv_draft_set(p_year integer, p_employee uuid, p_blocks jsonb) returns integer language plpgsql security definer set search_path to 'public' as $$
declare pl public.pv_plans; a public.pv_allocs; r public.pv_alloc_rows; crew text; b jsonb; s date; e date; n integer; prev_e date; periods integer := 0; src text;
begin
  if not public.app_is_staff() then raise exception 'Only the manpower staff can change the vacation plan.' using errcode = 'insufficient_privilege'; end if;
  select * into pl from public.pv_plans where year = p_year for update;
  if pl.id is null then raise exception 'There is no vacation plan for %.', p_year using errcode = 'check_violation'; end if;
  if pl.status not in ('draft') then raise exception 'Vacation Plan % is %: it can only be changed while it is a draft.', p_year, pl.status using errcode = 'check_violation'; end if;
  select * into a from public.pv_allocs where year = p_year and status = 'approved';
  if a.id is null then raise exception 'Approve the % manpower allocation first.', p_year using errcode = 'check_violation'; end if;
  select * into r from public.pv_alloc_rows where alloc_id = a.id and employee_id = p_employee;
  if r.id is null or r.grp = 'excluded' then raise exception 'This person is not in the approved manpower allocation.' using errcode = 'check_violation'; end if;
  crew := case when r.grp = 'relief' then r.cycle_crew else r.crew end;
  if crew is null then raise exception 'This person has no shift rota in the allocation.' using errcode = 'check_violation'; end if;
  for b in select * from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) order by (value->>'start')::date loop
    s := (b->>'start')::date; e := (b->>'end')::date; src := coalesce(b->>'source', 'manual');
    if s is null or e is null or e < s then raise exception 'Each vacation needs a first and a last day.' using errcode = 'check_violation'; end if;
    if extract(year from s)::integer <> p_year then raise exception 'A % vacation must start in %.', p_year, p_year using errcode = 'check_violation'; end if;
    if not public.pv_is_m1(crew, s) or (e - s + 1) % 8 <> 0 then raise exception 'Whole cycles only: % to % is not whole cycles of the % Shift rota.', s, e, crew using errcode = 'check_violation'; end if;
    if src not in ('manual', 'form', 'system') then raise exception 'Unknown source %.', src using errcode = 'check_violation'; end if;
    if prev_e is not null and s <= prev_e then raise exception 'Two vacations overlap on %.', s using errcode = 'check_violation'; end if;
    if prev_e is null or s > prev_e + 1 then periods := periods + 1; end if;
    prev_e := e;
  end loop;
  if periods > 5 then raise exception '% vacation periods: five at most.', periods using errcode = 'check_violation'; end if;
  update public.pv_plan_blocks x set removed_at = now(), removed_by = auth.uid()
   where x.plan_id = pl.id and x.employee_id = p_employee and x.removed_at is null
     and not exists (select 1 from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) j where (j->>'start')::date = x.start_date and (j->>'end')::date = x.end_date
                       and coalesce(j->>'source', 'manual') = x.source);
  insert into public.pv_plan_blocks (plan_id, employee_id, start_date, end_date, version, source, upload_id)
  select pl.id, p_employee, (j->>'start')::date, (j->>'end')::date, pl.version, coalesce(j->>'source', 'manual'), nullif(j->>'upload_id', '')::uuid
    from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) j
   where not exists (select 1 from public.pv_plan_blocks x where x.plan_id = pl.id and x.employee_id = p_employee and x.removed_at is null
                       and x.start_date = (j->>'start')::date and x.end_date = (j->>'end')::date and x.source = coalesce(j->>'source', 'manual'));
  update public.pv_plans set updated_at = now() where id = pl.id;
  select count(*) into n from public.pv_plan_blocks where plan_id = pl.id and employee_id = p_employee and removed_at is null;
  return n;
end $$;

-- Draft → Needs review (staff). The complete check runs again at approval.
create or replace function public.pv_plan_submit(p_year integer, p_note text default null) returns void language plpgsql security definer set search_path to 'public' as $$
declare pl public.pv_plans; n integer;
begin
  if not public.app_is_staff() then raise exception 'Only the manpower staff can send the vacation plan for approval.' using errcode = 'insufficient_privilege'; end if;
  select * into pl from public.pv_plans where year = p_year for update;
  if pl.id is null or pl.status <> 'draft' then raise exception 'Only a draft can be sent for approval.' using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.pv_allocs where year = p_year and status = 'approved') then raise exception 'Approve the manpower allocation first.' using errcode = 'check_violation'; end if;
  select count(*) into n from public.pv_plan_blocks where plan_id = pl.id and removed_at is null;
  if n = 0 then raise exception 'The draft has no vacation yet.' using errcode = 'check_violation'; end if;
  update public.pv_plans set status = 'submitted', submitted_at = now(), submitted_by = auth.uid(), note = nullif(trim(coalesce(p_note, '')), '') where id = pl.id;
  insert into public.pv_plan_events (plan_id, action, version, blocks, note) values (pl.id, 'submitted', pl.version, n, nullif(trim(coalesce(p_note, '')), ''));
end $$;

-- Section Head: approve the annual plan and publish it to the leave records in one transaction, on a fresh passing
-- server check of exactly this plan (allocation, vacations, other leave, task releases, shutdown teams). Run twice: the
-- second call changes nothing and returns the same count.
create or replace function public.pv_plan_approve_checked(p_check uuid) returns integer language plpgsql security definer set search_path to 'public' as $$
declare c public.pv_server_checks; pl public.pv_plans; a public.pv_allocs; n integer; who text;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head approves the vacation plan.' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.pv_server_checks where id = p_check;
  if c.id is null or c.kind <> 'plan' or c.created_for <> auth.uid() or c.created_at < now() - interval '15 minutes' then raise exception 'STALE_CHECK: run the check again.' using errcode = 'check_violation'; end if;
  select * into pl from public.pv_plans where year = c.year for update;
  if pl.id is null then raise exception 'There is no vacation plan for %.', c.year using errcode = 'check_violation'; end if;
  if pl.status = 'published' then
    select count(*) into n from public.leave_records where plan_year = c.year and source_ref like 'pv_plan:' || pl.id || ':%' and in_original_plan;
    return n;
  end if;
  if pl.status not in ('draft', 'submitted', 'approved') then raise exception 'Vacation Plan % is %.', c.year, pl.status using errcode = 'check_violation'; end if;
  select * into a from public.pv_allocs where year = c.year and status = 'approved';
  if a.id is null then raise exception 'Approve the manpower allocation first.' using errcode = 'check_violation'; end if;
  if c.fingerprint <> public.pv_plan_fingerprint(c.year) then raise exception 'STALE_CHECK: the plan or the leave changed after the check.' using errcode = 'check_violation'; end if;
  if not c.ok then raise exception 'Blocking issues remain: %', coalesce(c.result->>'reason', 'see the check') using errcode = 'check_violation'; end if;
  if exists (select 1 from public.leave_records where plan_year = c.year and absence_type_code = 'annual_leave_planned' and in_original_plan) then
    raise exception 'PV % is already in the live plan.', c.year using errcode = 'check_violation'; end if;
  who := public.pv_actor_name();
  insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref, note,
                                    in_original_plan, in_current_plan, plan_year, origin, approved_at, approved_by, approved_by_name)
  select b.employee_id, 'annual_leave_planned', b.start_date, b.end_date, 'approved', 'pv_schedule', 'pv_plan:' || pl.id || ':v' || pl.version || ':' || b.source,
         'Annual plan ' || c.year || ' v' || pl.version || case b.source when 'system' then ' · system assigned' when 'form' then ' · from the form' else '' end,
         true, true, c.year, 'system', now(), auth.uid(), who
    from public.pv_plan_blocks b where b.plan_id = pl.id and b.removed_at is null order by b.start_date, b.employee_id;
  get diagnostics n = row_count;
  update public.pv_plans set status = 'published', decided_at = now(), decided_by = auth.uid(), published_at = now(), published_by = auth.uid(), alloc_version = a.version where id = pl.id;
  insert into public.pv_plan_events (plan_id, action, version, blocks, note) values (pl.id, 'approved', pl.version, n, 'Approved on the server check');
  insert into public.pv_plan_events (plan_id, action, version, blocks) values (pl.id, 'published', pl.version, n);
  return n;
end $$;

-- Section Head: send a plan waiting for approval back to the draft (next version), with what to change.
create or replace function public.pv_plan_return(p_year integer, p_note text) returns void language plpgsql security definer set search_path to 'public' as $$
declare pl public.pv_plans; n integer;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head returns the vacation plan.' using errcode = 'insufficient_privilege'; end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say what to change.' using errcode = 'check_violation'; end if;
  select * into pl from public.pv_plans where year = p_year for update;
  if pl.id is null or pl.status not in ('submitted', 'approved') then raise exception 'Only a plan waiting for approval can be returned.' using errcode = 'check_violation'; end if;
  select count(*) into n from public.pv_plan_blocks where plan_id = pl.id and removed_at is null;
  update public.pv_plans set status = 'draft', version = pl.version + 1, decided_at = now(), decided_by = auth.uid() where id = pl.id;
  insert into public.pv_plan_events (plan_id, action, version, blocks, note) values (pl.id, 'returned', pl.version, n, trim(p_note));
end $$;

-- Day Supervisor rotation of the plan year (agreed by the Controllers, or proposed): replaced as a whole, old rows kept.
create or replace function public.pv_day_rotation_set(p_year integer, p_rows jsonb) returns integer language plpgsql security definer set search_path to 'public' as $$
declare pl public.pv_plans; n integer;
begin
  if not public.app_is_staff() then raise exception 'Only the manpower staff can change the vacation plan.' using errcode = 'insufficient_privilege'; end if;
  select * into pl from public.pv_plans where year = p_year for update;
  if pl.id is null or pl.status = 'published' then raise exception 'The % plan cannot be changed here.', p_year using errcode = 'check_violation'; end if;
  update public.pv_day_rotation set removed_at = now(), removed_by = auth.uid() where plan_id = pl.id and removed_at is null;
  insert into public.pv_day_rotation (plan_id, employee_id, start_date, end_date, source)
  select pl.id, nullif(j->>'employee_id', '')::uuid, (j->>'start')::date, (j->>'end')::date, coalesce(j->>'source', 'agreed') from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) j;
  get diagnostics n = row_count;
  return n;
end $$;

-- Uploaded forms: recorded on upload, then read (the marks found), committed or discarded.
create or replace function public.pv_form_upload_add(p_year integer, p_path text, p_file_name text, p_mime text) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare pl public.pv_plans; id uuid;
begin
  if not public.app_is_staff() then raise exception 'Only the manpower staff can upload vacation forms.' using errcode = 'insufficient_privilege'; end if;
  select * into pl from public.pv_plans where year = p_year;
  if pl.id is null then raise exception 'There is no vacation plan for %.', p_year using errcode = 'check_violation'; end if;
  if p_path not like p_year || '/%' then raise exception 'Wrong upload folder.' using errcode = 'check_violation'; end if;
  insert into public.pv_form_uploads (plan_id, path, file_name, mime) values (pl.id, p_path, p_file_name, p_mime) returning pv_form_uploads.id into id;
  return id;
end $$;

create or replace function public.pv_form_upload_update(p_id uuid, p_status text, p_form_code text, p_result jsonb) returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.app_is_staff() then raise exception 'Only the manpower staff can read vacation forms.' using errcode = 'insufficient_privilege'; end if;
  update public.pv_form_uploads set status = p_status, form_code = coalesce(p_form_code, form_code), result = coalesce(p_result, result),
         decided_by = case when p_status in ('committed', 'discarded') then auth.uid() else decided_by end,
         decided_at = case when p_status in ('committed', 'discarded') then now() else decided_at end
   where id = p_id;
  if not found then raise exception 'Upload not found.' using errcode = 'check_violation'; end if;
end $$;

-- ── sick leave, rolling 12 months, from the Excel file (name, Civil ID, days) ─────────────────────────────────────
-- Each matched row adds a new sick-leave check (the old ones are kept); `link` stores the Civil ID hash the first
-- time a person is matched by name and confirmed. A hash already linked to someone else is refused.
create or replace function public.sick_import_commit(p_file_name text, p_file_hash text, p_period_start date, p_period_end date, p_rows jsonb, p_summary jsonb default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare imp uuid; r jsonb; emp uuid; h text; prev integer; n_match integer := 0; n_link integer := 0; n_changed integer := 0;
begin
  if not public.app_is_staff() then raise exception 'Only the manpower staff can import sick leave.' using errcode = 'insufficient_privilege'; end if;
  if p_period_end < p_period_start or p_period_end > current_date + 1 then raise exception 'Check the report period.' using errcode = 'check_violation'; end if;
  insert into public.sick_imports (file_name, file_hash, period_start, period_end, rows_read, summary, imported_by_name)
  values (p_file_name, p_file_hash, p_period_start, p_period_end, coalesce((p_summary->>'rows')::integer, jsonb_array_length(p_rows)), p_summary, public.pv_actor_name()) returning id into imp;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    emp := (r->>'employee_id')::uuid; h := r->>'civil_hash';
    if (r->>'days')::integer is null or (r->>'days')::integer < 0 then raise exception 'Sick days must be 0 or more.' using errcode = 'check_violation'; end if;
    if coalesce((r->>'link')::boolean, false) then
      if exists (select 1 from public.employee_civil_ids where civil_hash = h and employee_id <> emp) then
        raise exception 'This Civil ID is already linked to another employee.' using errcode = 'check_violation'; end if;
      insert into public.employee_civil_ids (employee_id, civil_hash, last4, import_id) values (emp, h, r->>'last4', imp)
      on conflict (employee_id) do update set civil_hash = excluded.civil_hash, last4 = excluded.last4, import_id = excluded.import_id, linked_at = now(), linked_by = auth.uid();
      n_link := n_link + 1;
    elsif not exists (select 1 from public.employee_civil_ids where employee_id = emp and civil_hash = h) then
      raise exception 'A row is not matched by its Civil ID.' using errcode = 'check_violation';
    end if;
    select days into prev from public.sick_checks where employee_id = emp order by entered_at desc limit 1;
    insert into public.sick_checks (employee_id, as_of, days, source, note, import_id)
    values (emp, p_period_end, (r->>'days')::integer, 'Sick leave Excel (rolling 12 months)', p_file_name || ' · ' || p_period_start || ' – ' || p_period_end, imp);
    n_match := n_match + 1;
    if prev is distinct from (r->>'days')::integer then n_changed := n_changed + 1; end if;
  end loop;
  update public.sick_imports set matched = n_match, linked = n_link, changed = n_changed, unmatched = coalesce((p_summary->>'unmatched')::integer, 0) where id = imp;
  return imp;
end $$;

revoke execute on function public.pv_is_m1(text, date), public.pv_actor_name(), public.pv_alloc_live(integer), public.pv_row_json(public.pv_alloc_rows),
  public.pv_alloc_fingerprint(integer), public.pv_plan_fingerprint(integer), public.pv_alloc_init(integer, jsonb), public.pv_alloc_draft(integer),
  public.pv_alloc_set(integer, uuid, text, text, text, text, text, text), public.pv_alloc_switch(integer, uuid, uuid), public.pv_alloc_undo(integer, uuid),
  public.pv_alloc_approve_checked(uuid), public.pv_alloc_reopen(integer, text), public.pv_draft_set(integer, uuid, jsonb), public.pv_plan_submit(integer, text),
  public.pv_plan_approve_checked(uuid), public.pv_plan_return(integer, text), public.pv_day_rotation_set(integer, jsonb), public.pv_form_upload_add(integer, text, text, text),
  public.pv_form_upload_update(uuid, text, text, jsonb), public.sick_import_commit(text, text, date, date, jsonb, jsonb) from public, anon;
grant execute on function public.pv_alloc_init(integer, jsonb), public.pv_alloc_set(integer, uuid, text, text, text, text, text, text), public.pv_alloc_switch(integer, uuid, uuid),
  public.pv_alloc_undo(integer, uuid), public.pv_alloc_approve_checked(uuid), public.pv_alloc_reopen(integer, text), public.pv_draft_set(integer, uuid, jsonb),
  public.pv_plan_submit(integer, text), public.pv_plan_approve_checked(uuid), public.pv_plan_return(integer, text), public.pv_day_rotation_set(integer, jsonb), public.pv_form_upload_add(integer, text, text, text),
  public.pv_form_upload_update(uuid, text, text, jsonb), public.sick_import_commit(text, text, date, date, jsonb, jsonb), public.pv_is_m1(text, date) to authenticated;
-- the fingerprints and helpers are for the server (service key) and the functions above only
revoke execute on function public.pv_alloc_fingerprint(integer), public.pv_plan_fingerprint(integer), public.pv_alloc_draft(integer), public.pv_alloc_live(integer) from authenticated;
-- the old publish step is replaced by the checked approval (one transaction); kept, but not callable from the app
revoke execute on function public.pv_plan_publish(integer), public.pv_plan_decide(integer, boolean, text) from authenticated;
grant execute on function public.pv_alloc_fingerprint(integer), public.pv_plan_fingerprint(integer) to service_role;
