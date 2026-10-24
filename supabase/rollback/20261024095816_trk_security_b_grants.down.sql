-- ROLLBACK of trk_security_b_grants: function execution and delete rights as they were before part B.
grant execute on all functions in schema public to public, anon;
alter default privileges in schema public grant execute on functions to public, anon;
grant delete on all tables in schema public to anon;
grant delete on public.absence_types, public.employee_performance, public.employees, public.import_batches, public.import_rows,
  public.leave_plan_changes, public.leave_records, public.positions, public.sick_leave_totals, public.trk_access, public.trk_link,
  public.trk_measure, public.trk_qty_scope, public.trk_trackers, public.user_profiles to authenticated;
