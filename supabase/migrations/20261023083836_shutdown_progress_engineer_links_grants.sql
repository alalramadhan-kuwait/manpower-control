-- An engineer link calls the API without an app login: the role checks the tracker's policies use must run for it
-- (they answer null / false without a login, so nothing else opens).
grant execute on function public.app_current_role() to anon;
grant execute on function public.app_is_section_head() to anon;
