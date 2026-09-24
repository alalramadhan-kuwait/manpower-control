-- Logins linked to staff members; access follows the role, and a one-holder role moves with the person.
-- 1. user_profiles.employee_id references the employee register; one login per staff member.
-- 2. app_roles.one_holder: a role only one login holds at a time (Manpower Coordinator). Giving it to another
--    login takes it away from the previous holder, who keeps a login with no app access ('employee').
--    A unique index backs this up in the database.
-- 3. The 'employee' role is offered on the Users screen as "Staff (no app access yet)".
-- 4. set_login_role(profile, role): moves or sets a role in one step and returns the logins that lost it
--    (for the audit history). Called only by the manage-users Edge Function (service role).
-- 5. app_current_role(): a login linked to a staff member who is no longer active has no access.

alter table public.user_profiles add constraint user_profiles_employee_id_fkey
  foreign key (employee_id) references public.employees(id) on delete set null;
create unique index user_profiles_one_login_per_employee on public.user_profiles (employee_id) where employee_id is not null;

alter table public.app_roles add column one_holder boolean not null default false;
comment on column public.app_roles.one_holder is 'Only one login holds this role at a time; giving it to another login removes it from the previous holder.';
update public.app_roles set one_holder = true where code = 'manpower_coordinator';
update public.app_roles set is_active = true, label = 'Staff (no app access yet)' where code = 'employee';
create unique index user_profiles_one_manpower_coordinator on public.user_profiles (role_code) where role_code = 'manpower_coordinator';

create or replace function public.set_login_role(p_profile uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_one  boolean;
  v_lost jsonb := '[]'::jsonb;
begin
  select one_holder into v_one from public.app_roles where code = p_role;
  if v_one is null then raise exception 'Unknown role %', p_role using errcode = 'check_violation'; end if;
  if not exists (select 1 from public.user_profiles where id = p_profile) then
    raise exception 'Login not found' using errcode = 'no_data_found';
  end if;
  if v_one then
    select coalesce(jsonb_agg(jsonb_build_object('profile_id', id, 'auth_user_id', auth_user_id, 'display_name', display_name, 'employee_id', employee_id)), '[]'::jsonb)
      into v_lost from public.user_profiles where role_code = p_role and id <> p_profile;
    update public.user_profiles set role_code = 'employee' where role_code = p_role and id <> p_profile;
  end if;
  update public.user_profiles set role_code = p_role where id = p_profile;
  return v_lost;
end $$;
revoke execute on function public.set_login_role(uuid, text) from public, anon, authenticated;
grant execute on function public.set_login_role(uuid, text) to service_role;

create or replace function public.app_current_role()
returns text language sql stable security definer set search_path = public as $$
  select p.role_code from public.user_profiles p
    left join public.employees e on e.id = p.employee_id
   where p.auth_user_id = auth.uid() and p.is_active and (p.employee_id is null or e.is_active)
   limit 1
$$;
