-- Security hardening from the Supabase advisor run after the initial load.
-- Role helpers stay SECURITY DEFINER (RLS policies need them) but anonymous callers may not execute them,
-- and the audit trigger function is not callable through the API at all.
alter function public.touch_updated_at() set search_path = public;
revoke execute on function public.app_current_role() from public, anon;
revoke execute on function public.app_is_staff() from public, anon;
revoke execute on function public.app_is_section_head() from public, anon;
revoke execute on function public.audit_row_change() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
grant execute on function public.app_current_role() to authenticated;
grant execute on function public.app_is_staff() to authenticated;
grant execute on function public.app_is_section_head() to authenticated;
