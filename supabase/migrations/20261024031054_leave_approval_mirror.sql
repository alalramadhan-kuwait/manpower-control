-- The server functions (shift alerts, request checks, shutdown approval) still read oracle_status until they are
-- redeployed. Keep it equal to the Section Head's approval so they count leave the same way as the app: a plan PV is
-- 'approved' once approved, 'not_submitted' while planned; every other type 'approved' (it always counts). The Oracle
-- values written before stay in audit_log.
create or replace function public.leave_approval_mirror() returns trigger
language plpgsql as $$
begin
  new.oracle_status := case when new.approved_at is not null or coalesce(new.absence_type_code, '') not in ('annual_leave_planned', 'annual_leave_rescheduled') then 'approved' else 'not_submitted' end;
  return new;
end $$;
create or replace trigger leave_approval_mirror before insert or update of approved_at, absence_type_code, oracle_status on public.leave_records
  for each row execute function public.leave_approval_mirror();

update public.leave_records l set oracle_status = public.approval_state(l)
 where l.in_current_plan and l.oracle_status is distinct from public.approval_state(l);
