-- Three user levels + task assignments (approved 24 Oct 2026): Section Head (L1), Engineer / Assistant Section Head
-- (L2), Controller (L3). Extra rights come from an assignment (first one: Manpower), not a promotion. The Manpower
-- Coordinator role keeps working unchanged. The new Engineer role and the Controller role stay off (not offered for
-- logins) until the matrix is verified; a later migration switches them on.
insert into public.app_roles (code, label, is_active, sort_order, one_holder)
values ('engineer', 'Engineer / Asst. Section Head', false, 15, false) on conflict (code) do nothing;

create table if not exists public.user_assignments (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references public.user_profiles(auth_user_id),
  task text not null check (task in ('manpower')),
  note text,
  granted_by_name text default public.trk_who(),
  granted_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by_name text,
  check (ended_at is null or ended_at >= granted_at)
);
create unique index if not exists user_assignments_one_active on public.user_assignments (auth_user_id, task) where ended_at is null;
alter table public.user_assignments enable row level security;
create policy user_assignments_read on public.user_assignments for select using (public.app_is_section_head() or auth_user_id = auth.uid() or public.app_current_role() in ('manpower_coordinator', 'engineer'));
create policy user_assignments_grant on public.user_assignments for insert with check (public.app_is_section_head() and ended_at is null);
create policy user_assignments_end on public.user_assignments for update using (public.app_is_section_head()) with check (public.app_is_section_head());
revoke delete on public.user_assignments from anon, authenticated;
create trigger user_assignments_audit after insert or update on public.user_assignments for each row execute function public.audit_row_change();

-- the current login's active assignment for a task
create or replace function public.app_has_task(p_task text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.app_current_role() is not null
     and exists (select 1 from public.user_assignments a where a.auth_user_id = auth.uid() and a.task = p_task and a.ended_at is null)
$$;
-- manpower data and actions: Section Head, Manpower Coordinator, Engineer, or a Controller with the Manpower assignment
create or replace function public.app_is_staff() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.app_current_role() in ('section_head', 'manpower_coordinator', 'engineer'), false)
      or (public.app_current_role() = 'controller' and public.app_has_task('manpower'))
$$;
-- Section Head or Engineer: tracker structure (add items, points, field steps, estimates)
create or replace function public.app_is_manager() returns boolean
language sql stable security definer set search_path to 'public' as $$ select coalesce(public.app_current_role() in ('section_head', 'engineer'), false) $$;
grant execute on function public.app_is_manager() to anon, authenticated;

-- tracker updates: the Engineer joins the roles that may update
create or replace function public.trk_can_update(p_tracker uuid) returns boolean
language sql stable as $$
  select coalesce(public.app_current_role() in ('section_head', 'manpower_coordinator', 'engineer', 'controller'), false) or public.trk_access_tracker() = p_tracker
$$;
create or replace function public.trk_can_update() returns boolean
language sql stable as $$
  select coalesce(public.app_current_role() in ('section_head', 'manpower_coordinator', 'engineer', 'controller'), false) or public.trk_access_id() is not null
$$;
do $$
declare r record; q text; c text;
begin
  for r in select tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public' and tablename like 'trk_%' and (coalesce(qual, '') || coalesce(with_check, '')) like '%''controller''::text%' loop
    q := replace(r.qual, '''manpower_coordinator''::text, ''controller''::text', '''manpower_coordinator''::text, ''engineer''::text, ''controller''::text');
    c := replace(r.with_check, '''manpower_coordinator''::text, ''controller''::text', '''manpower_coordinator''::text, ''engineer''::text, ''controller''::text');
    if q is not null and c is not null then execute format('alter policy %I on public.%I using (%s) with check (%s)', r.policyname, r.tablename, q, c);
    elsif q is not null then execute format('alter policy %I on public.%I using (%s)', r.policyname, r.tablename, q);
    else execute format('alter policy %I on public.%I with check (%s)', r.policyname, r.tablename, c); end if;
  end loop;
end $$;
-- tracker structure: Section Head or Engineer (publish, reset, links and tracker settings stay with the Section Head)
alter policy trk_equipment_head on public.trk_equipment with check (public.app_is_manager());
alter policy trk_points_head on public.trk_points with check (public.app_is_manager());
alter policy trk_point_step_head on public.trk_point_step with check (public.app_is_manager());
alter policy trk_qty_estimate_head on public.trk_qty_estimate with check (public.app_is_manager());
alter policy trk_activities_insert on public.trk_activities with check (public.app_is_manager());
alter policy trk_activities_head on public.trk_activities using (public.app_is_manager()) with check (public.app_is_manager());
