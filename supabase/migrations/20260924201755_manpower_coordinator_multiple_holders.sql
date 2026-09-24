-- Manpower Coordinator may be held by more than one login (Section Head, 24 Sep 2026): a reviewer gets
-- coordinator access without taking it from the current coordinator. Giving the role no longer removes it
-- from anyone; set_login_role already only does that for one_holder roles.
update public.app_roles set one_holder = false where code = 'manpower_coordinator';
drop index if exists public.user_profiles_one_manpower_coordinator;
