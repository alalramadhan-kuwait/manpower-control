-- Only a PV of the plan (planned or rescheduled) waits for the Section Head's approval; unplanned leave (UL) and every
-- other type always count.
create or replace function public.approval_state(l public.leave_records) returns text
language sql stable as $$
  select case when l.approved_at is not null or coalesce(l.absence_type_code, '') not in ('annual_leave_planned', 'annual_leave_rescheduled') then 'approved' else 'not_submitted' end
$$;
