-- Tracker security, stage 1 part B: no function runs without a login except what an engineer link needs and the
-- checks the policies use; no hard delete of operational records through the API (drafts and reference lists keep
-- theirs: future-dated role / qualification corrections, request drafts, holidays, the shutdown day grid).
-- Rollback: supabase/rollback/20261024095816_trk_security_b_grants.down.sql
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon;
grant execute on function public.app_current_role(), public.app_is_section_head(), public.app_is_staff(),
  public.trk_access_id(), public.trk_access_tracker(), public.trk_access_me(), public.trk_who(),
  public.trk_can_read(), public.trk_can_update(), public.trk_can_read(uuid), public.trk_can_update(uuid),
  public.trk_set_order(uuid, text, uuid[]), public.trk_sd_team(date), public.app_visit(text, text) to anon;
revoke delete on all tables in schema public from anon;
revoke delete on public.absence_types, public.employee_performance, public.employees, public.import_batches, public.import_rows,
  public.leave_plan_changes, public.leave_records, public.positions, public.sick_leave_totals, public.trk_access, public.trk_link,
  public.trk_measure, public.trk_qty_scope, public.trk_trackers, public.user_profiles from authenticated;
