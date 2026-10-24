-- The permission matrix was verified (24 Oct 2026, rolled-back checks per level): the Engineer and Controller roles
-- are offered for logins from now on. No login changes role by this migration.
update public.app_roles set is_active = true where code in ('engineer', 'controller');
