-- Next year's PV as a draft: Draft → Submitted → Approved → Published. The draft lives in its own tables, so until it is
-- published it has no effect on manpower, alerts, the calendar or the Oracle follow-up (they read leave_records only).
-- Publishing copies the draft into leave_records as that year's original plan, once.

create table public.pv_plans (
  id uuid primary key default gen_random_uuid(),
  year integer not null unique check (year between 2000 and 2100),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'published')),
  version integer not null default 1 check (version >= 1),
  note text,
  submitted_at timestamptz, submitted_by uuid,
  decided_at timestamptz, decided_by uuid,
  published_at timestamptz, published_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- one row per leave block; a change never edits a row: the old one is marked removed and a new one added
create table public.pv_plan_blocks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.pv_plans(id),
  employee_id uuid not null references public.employees(id),
  start_date date not null,
  end_date date not null,
  version integer not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid,
  check (end_date >= start_date)
);
create index pv_plan_blocks_live on public.pv_plan_blocks (plan_id, employee_id) where removed_at is null;

create table public.pv_plan_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.pv_plans(id),
  action text not null check (action in ('created', 'submitted', 'returned', 'approved', 'published')),
  version integer not null,
  blocks integer not null default 0,
  note text,
  actor uuid default auth.uid(),
  at timestamptz not null default now()
);

alter table public.pv_plans enable row level security;
alter table public.pv_plan_blocks enable row level security;
alter table public.pv_plan_events enable row level security;
create policy pv_plans_read on public.pv_plans for select to authenticated using (public.app_is_staff());
create policy pv_plan_blocks_read on public.pv_plan_blocks for select to authenticated using (public.app_is_staff());
create policy pv_plan_events_read on public.pv_plan_events for select to authenticated using (public.app_is_staff());
create trigger pv_plans_touch before update on public.pv_plans for each row execute function public.touch_updated_at();

-- 2026: the imported plan in use; 2027: the draft
insert into public.pv_plans (year, status, note, published_at) values
  (2026, 'published', 'The imported 2026 plan (leave_records).', now()),
  (2027, 'draft', null, null);
insert into public.pv_plan_events (plan_id, action, version, note, actor)
  select id, case when year = 2026 then 'published' else 'created' end, 1, case when year = 2026 then 'Imported plan' else null end, null from public.pv_plans;

-- Replace one employee's blocks in the draft (staff, draft only). Returns the number of live blocks.
create or replace function public.pv_draft_set(p_year integer, p_employee uuid, p_blocks jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare pl public.pv_plans; b jsonb; s date; e date; n integer;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can change the PV plan.' using errcode = 'insufficient_privilege'; end if;
  select * into pl from public.pv_plans where year = p_year for update;
  if pl.id is null then raise exception 'There is no PV plan for %.', p_year using errcode = 'check_violation'; end if;
  if pl.status <> 'draft' then raise exception 'PV Plan · % is %: it can only be changed while it is a draft.', p_year, pl.status using errcode = 'check_violation'; end if;
  for b in select * from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) loop
    s := (b->>'start')::date; e := (b->>'end')::date;
    if s is null or e is null or e < s then raise exception 'Each block needs a first and a last day.' using errcode = 'check_violation'; end if;
    if extract(year from s)::integer <> p_year then raise exception 'A % PV block must start in %.', p_year, p_year using errcode = 'check_violation'; end if;
  end loop;
  update public.pv_plan_blocks x set removed_at = now(), removed_by = auth.uid()
   where x.plan_id = pl.id and x.employee_id = p_employee and x.removed_at is null
     and not exists (select 1 from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) j where (j->>'start')::date = x.start_date and (j->>'end')::date = x.end_date);
  insert into public.pv_plan_blocks (plan_id, employee_id, start_date, end_date, version)
  select pl.id, p_employee, (j->>'start')::date, (j->>'end')::date, pl.version from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) j
   where not exists (select 1 from public.pv_plan_blocks x where x.plan_id = pl.id and x.employee_id = p_employee and x.removed_at is null
                       and x.start_date = (j->>'start')::date and x.end_date = (j->>'end')::date);
  update public.pv_plans set updated_at = now() where id = pl.id;
  select count(*) into n from public.pv_plan_blocks where plan_id = pl.id and employee_id = p_employee and removed_at is null;
  return n;
end $$;

-- Draft → Submitted (staff).
create or replace function public.pv_plan_submit(p_year integer, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare pl public.pv_plans; n integer;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can submit the PV plan.' using errcode = 'insufficient_privilege'; end if;
  select * into pl from public.pv_plans where year = p_year for update;
  if pl.id is null or pl.status <> 'draft' then raise exception 'Only a draft can be submitted.' using errcode = 'check_violation'; end if;
  select count(*) into n from public.pv_plan_blocks where plan_id = pl.id and removed_at is null;
  if n = 0 then raise exception 'The draft has no leave yet.' using errcode = 'check_violation'; end if;
  update public.pv_plans set status = 'submitted', submitted_at = now(), submitted_by = auth.uid(), note = nullif(trim(coalesce(p_note, '')), '') where id = pl.id;
  insert into public.pv_plan_events (plan_id, action, version, blocks, note) values (pl.id, 'submitted', pl.version, n, nullif(trim(coalesce(p_note, '')), ''));
end $$;

-- Submitted → Approved, or back to Draft as the next version (Section Head).
create or replace function public.pv_plan_decide(p_year integer, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare pl public.pv_plans; n integer;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head decides the PV plan.' using errcode = 'insufficient_privilege'; end if;
  select * into pl from public.pv_plans where year = p_year for update;
  if pl.id is null or pl.status <> 'submitted' then raise exception 'Only a submitted plan can be decided.' using errcode = 'check_violation'; end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say what to change.' using errcode = 'check_violation'; end if;
  select count(*) into n from public.pv_plan_blocks where plan_id = pl.id and removed_at is null;
  if p_approve then
    update public.pv_plans set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = pl.id;
    insert into public.pv_plan_events (plan_id, action, version, blocks, note) values (pl.id, 'approved', pl.version, n, nullif(trim(coalesce(p_note, '')), ''));
  else
    update public.pv_plans set status = 'draft', version = pl.version + 1, decided_at = now(), decided_by = auth.uid() where id = pl.id;
    insert into public.pv_plan_events (plan_id, action, version, blocks, note) values (pl.id, 'returned', pl.version, n, trim(p_note));
  end if;
end $$;

-- Approved → Published (Section Head): the blocks become that year's original plan in leave_records. Once only.
create or replace function public.pv_plan_publish(p_year integer)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare pl public.pv_plans; n integer;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head publishes the PV plan.' using errcode = 'insufficient_privilege'; end if;
  select * into pl from public.pv_plans where year = p_year for update;
  if pl.id is null or pl.status <> 'approved' then raise exception 'Only an approved plan can be published.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.leave_records where plan_year = p_year and absence_type_code = 'annual_leave_planned' and in_original_plan) then
    raise exception 'PV % is already in the live plan.', p_year using errcode = 'check_violation';
  end if;
  insert into public.leave_records (employee_id, absence_type_code, start_date, end_date, status, source_kind, source_ref, note,
                                    in_original_plan, in_current_plan, plan_year, origin, oracle_status)
  select employee_id, 'annual_leave_planned', start_date, end_date, 'approved', 'pv_schedule', 'pv_plan:' || pl.id || ':v' || pl.version,
         'PV ' || p_year || ' · published', true, true, p_year, 'system', 'not_submitted'
    from public.pv_plan_blocks where plan_id = pl.id and removed_at is null order by start_date;
  get diagnostics n = row_count;
  update public.pv_plans set status = 'published', published_at = now(), published_by = auth.uid() where id = pl.id;
  insert into public.pv_plan_events (plan_id, action, version, blocks) values (pl.id, 'published', pl.version, n);
  return n;
end $$;

revoke all on function public.pv_draft_set(integer, uuid, jsonb), public.pv_plan_submit(integer, text), public.pv_plan_decide(integer, boolean, text), public.pv_plan_publish(integer) from public, anon;
grant execute on function public.pv_draft_set(integer, uuid, jsonb), public.pv_plan_submit(integer, text), public.pv_plan_decide(integer, boolean, text), public.pv_plan_publish(integer) to authenticated;
