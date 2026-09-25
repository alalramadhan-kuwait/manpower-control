-- Oracle HR tracking: where each leave stands in Oracle HR, separate from the manpower plan.
-- 1. leave_records.oracle_status: not_submitted | submitted | approved | rejected (default not_submitted),
--    oracle_ref (the Oracle request number, optional) and oracle_updated_at.
--    Leave that has already started or been taken is approved in Oracle by definition (backfilled without
--    audit rows or updated_at changes: a one-off baseline, not a user change).
-- 2. New dates on future leave need a new Oracle request: when the dates change and the same update does not
--    set the Oracle status itself, the status goes back to not_submitted (ref cleared).
-- 3. leave_set_oracle(records, status, ref): Section Head / Manpower Coordinator mark one or many current-plan
--    records; returns how many changed. Every change is audited by the existing trigger.

alter table public.leave_records
  add column oracle_status text not null default 'not_submitted'
    constraint leave_records_oracle_status_check check (oracle_status in ('not_submitted', 'submitted', 'approved', 'rejected')),
  add column oracle_ref text,
  add column oracle_updated_at timestamptz;
comment on column public.leave_records.oracle_status is 'Where the leave stands in Oracle HR: not_submitted, submitted, approved or rejected.';
comment on column public.leave_records.oracle_ref is 'Oracle HR request number (optional).';

alter table public.leave_records disable trigger leave_records_audit;
alter table public.leave_records disable trigger leave_records_touch;
update public.leave_records set oracle_status = 'approved' where start_date <= current_date;
alter table public.leave_records enable trigger leave_records_audit;
alter table public.leave_records enable trigger leave_records_touch;

create index leave_records_oracle_open on public.leave_records (start_date)
  where in_current_plan and oracle_status <> 'approved';

create or replace function public.leave_oracle_on_date_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date)
     and new.oracle_status is not distinct from old.oracle_status
     and new.oracle_status <> 'not_submitted'
     and new.start_date > current_date then
    new.oracle_status := 'not_submitted';
    new.oracle_ref := null;
    new.oracle_updated_at := now();
  end if;
  return new;
end $$;

create trigger leave_records_oracle_dates before update of start_date, end_date on public.leave_records
  for each row execute function public.leave_oracle_on_date_change();

create or replace function public.leave_set_oracle(p_records uuid[], p_status text, p_ref text default null)
returns integer language plpgsql set search_path = public as $$
declare
  v_ref text := nullif(trim(coalesce(p_ref, '')), '');
  v_n integer;
begin
  if not public.app_is_staff() then
    raise exception 'Only the Section Head or the Manpower Coordinator can change the Oracle status.' using errcode = 'insufficient_privilege';
  end if;
  if p_status is null or p_status not in ('not_submitted', 'submitted', 'approved', 'rejected') then
    raise exception 'Unknown Oracle status.' using errcode = 'check_violation';
  end if;
  if coalesce(array_length(p_records, 1), 0) = 0 then
    raise exception 'Choose at least one leave.' using errcode = 'check_violation';
  end if;
  update public.leave_records
     set oracle_status = p_status,
         oracle_ref = case when p_status = 'not_submitted' then null else coalesce(v_ref, oracle_ref) end,
         oracle_updated_at = now()
   where id = any (p_records) and in_current_plan and status in ('approved', 'planned')
     and (oracle_status is distinct from p_status or (v_ref is not null and v_ref is distinct from oracle_ref));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.leave_set_oracle(uuid[], text, text) from public, anon;
grant execute on function public.leave_set_oracle(uuid[], text, text) to authenticated;
revoke all on function public.leave_oracle_on_date_change() from public, anon, authenticated;
