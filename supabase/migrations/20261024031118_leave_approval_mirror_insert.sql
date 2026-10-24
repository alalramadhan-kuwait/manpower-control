-- The mirror runs before leave_approve_on_insert (trigger order is by name), so on insert it also treats a PV recorded
-- through a request or by hand as approved, as that trigger does.
create or replace function public.leave_approval_mirror() returns trigger
language plpgsql as $$
begin
  new.oracle_status := case when new.approved_at is not null
      or coalesce(new.absence_type_code, '') not in ('annual_leave_planned', 'annual_leave_rescheduled')
      or (tg_op = 'INSERT' and new.origin in ('request', 'manual')) then 'approved' else 'not_submitted' end;
  return new;
end $$;
