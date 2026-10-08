-- Phase 1 step 4: Oracle history and the PV vs Oracle comparison.
-- oracle_requests keeps every request as Oracle HR holds it (its own dates, status and number), per leave (the root
-- of its version chain). The plan's dates are never changed because Oracle differs: the comparison says what to do.
--   Match                  Oracle approved the plan's current dates
--   Submitted              Oracle has the current dates, waiting
--   Not submitted          nothing in Oracle for the current dates
--   Rejected               Oracle rejected the current dates
--   Oracle update required Oracle still holds an older version of the leave (or leave no longer in the plan)
--   Oracle mismatch        Oracle holds dates that were never part of this leave's approved chain
-- leave_records.oracle_status stays as the quick status of each current record (kept in step by the functions).

create table public.oracle_requests (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees (id),
  leave_root_id     uuid not null references public.leave_records (id),
  leave_record_id   uuid references public.leave_records (id),
  absence_type_code text references public.absence_types (code),
  start_date        date not null,
  end_date          date not null,
  status            text not null check (status in ('submitted', 'approved', 'rejected', 'cancelled')),
  oracle_ref        text,
  source            text not null default 'recorded' check (source in ('recorded', 'assumed_past')),
  note              text,
  recorded_by       uuid default auth.uid(),
  recorded_at       timestamptz not null default now(),
  status_at         timestamptz not null default now(),
  constraint oracle_requests_dates check (end_date >= start_date)
);
create index oracle_requests_root on public.oracle_requests (leave_root_id, recorded_at desc);
create index oracle_requests_record on public.oracle_requests (leave_record_id) where leave_record_id is not null;
alter table public.oracle_requests enable row level security;
create policy oracle_requests_staff_read on public.oracle_requests for select to authenticated using (public.app_is_staff());
revoke insert, update, delete on public.oracle_requests from anon, authenticated;

-- what is known today: statuses a person recorded, and the leave that had already started when tracking began
-- (marked approved then, kept as an assumption). Earlier versions marked only by that assumption are not taken as
-- Oracle requests, so they raise no "update required".
insert into public.oracle_requests (employee_id, leave_root_id, leave_record_id, absence_type_code, start_date, end_date, status, oracle_ref,
                                    source, note, recorded_by, recorded_at, status_at)
select employee_id, root_id, id, absence_type_code, start_date, end_date, oracle_status, oracle_ref,
       case when oracle_updated_at is null then 'assumed_past' else 'recorded' end,
       case when oracle_updated_at is null then 'Assumed approved: the leave had started when Oracle tracking began (25 Sep 2026).' end,
       null, coalesce(oracle_updated_at, '2026-09-25 00:00+03'), coalesce(oracle_updated_at, '2026-09-25 00:00+03')
  from public.leave_records
 where oracle_status <> 'not_submitted' and (oracle_updated_at is not null or in_current_plan);
create trigger oracle_requests_audit after insert or update or delete on public.oracle_requests for each row execute function public.audit_row_change();

-- the comparison for every current leave, and for leave no longer in the plan that Oracle still holds
create view public.oracle_compare_v with (security_invoker = true) as
select l.id as leave_record_id, l.employee_id, l.root_id, l.plan_year, l.absence_type_code, l.start_date, l.end_date, true as in_plan,
       coalesce(x.id, y.id) as oracle_request_id, coalesce(x.start_date, y.start_date) as oracle_start, coalesce(x.end_date, y.end_date) as oracle_end,
       coalesce(x.status, y.status) as oracle_status, coalesce(x.oracle_ref, y.oracle_ref) as oracle_ref, coalesce(x.source, y.source) as oracle_source,
       case
         when x.id is not null then case x.status when 'approved' then 'match' when 'submitted' then 'submitted' else 'rejected' end
         when y.id is null then 'not_submitted'
         when exists (select 1 from public.leave_records v where v.root_id = l.root_id and not v.in_current_plan
                        and v.start_date = y.start_date and v.end_date = y.end_date) then 'update_required'
         else 'mismatch'
       end as compare_status
  from public.leave_records l
  left join lateral (select r.* from public.oracle_requests r
                      where r.leave_root_id = l.root_id and r.status <> 'cancelled' and r.start_date = l.start_date and r.end_date = l.end_date
                      order by r.recorded_at desc limit 1) x on true
  left join lateral (select r.* from public.oracle_requests r
                      where r.leave_root_id = l.root_id and r.status in ('submitted', 'approved')
                        and not exists (select 1 from public.leave_records c where c.root_id = r.leave_root_id and c.in_current_plan
                                          and c.start_date = r.start_date and c.end_date = r.end_date)
                      order by r.recorded_at desc limit 1) y on x.id is null
 where l.in_current_plan and l.status in ('approved', 'planned')
union all
select v.id, v.employee_id, v.root_id, v.plan_year, v.absence_type_code, v.start_date, v.end_date, false,
       r.id, r.start_date, r.end_date, r.status, r.oracle_ref, r.source, 'update_required'
  from public.oracle_requests r
  join lateral (select * from public.leave_records v where v.root_id = r.leave_root_id order by v.version_no desc, v.created_at desc limit 1) v on true
 where r.status in ('submitted', 'approved')
   and not exists (select 1 from public.leave_records c where c.root_id = r.leave_root_id and c.in_current_plan);
grant select on public.oracle_compare_v to authenticated;

-- Record what Oracle holds for a leave: its status (and number); its dates when they differ from the leave's.
-- The same dates again update that request (submitted → approved); other dates are a new request.
create or replace function public.oracle_request_record(p_leave uuid, p_status text, p_ref text default null, p_start date default null,
  p_end date default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leave_records; v_start date; v_end date; v_id uuid; v_ver uuid; v_ref text := nullif(btrim(coalesce(p_ref, '')), '');
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can record Oracle.' using errcode = 'insufficient_privilege'; end if;
  if p_status not in ('submitted', 'approved', 'rejected') then raise exception 'Unknown Oracle status.' using errcode = 'check_violation'; end if;
  select * into l from public.leave_records where id = p_leave;
  if not found then raise exception 'Leave not found.' using errcode = 'no_data_found'; end if;
  v_start := coalesce(p_start, l.start_date); v_end := coalesce(p_end, l.end_date);
  if v_end < v_start then raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation'; end if;
  select id into v_ver from public.leave_records where root_id = l.root_id and start_date = v_start and end_date = v_end
   order by in_current_plan desc, version_no desc limit 1;
  select id into v_id from public.oracle_requests where leave_root_id = l.root_id and status <> 'cancelled' and start_date = v_start and end_date = v_end
   order by recorded_at desc limit 1 for update;
  if v_id is not null then
    update public.oracle_requests set status = p_status, oracle_ref = coalesce(v_ref, oracle_ref), status_at = now(), source = 'recorded',
      note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note), leave_record_id = coalesce(leave_record_id, v_ver)
     where id = v_id;
  else
    insert into public.oracle_requests (employee_id, leave_root_id, leave_record_id, absence_type_code, start_date, end_date, status, oracle_ref, note)
    values (l.employee_id, l.root_id, v_ver, l.absence_type_code, v_start, v_end, p_status, v_ref, nullif(btrim(coalesce(p_note, '')), ''))
    returning id into v_id;
  end if;
  -- the quick status of the current record with these dates
  update public.leave_records set oracle_status = p_status, oracle_ref = coalesce(v_ref, oracle_ref), oracle_updated_at = now()
   where root_id = l.root_id and in_current_plan and start_date = v_start and end_date = v_end;
  return v_id;
end $$;
revoke execute on function public.oracle_request_record(uuid, text, text, date, date, text) from public, anon;
grant execute on function public.oracle_request_record(uuid, text, text, date, date, text) to authenticated;

-- An Oracle request withdrawn or cancelled in Oracle (kept in the history as cancelled).
create or replace function public.oracle_request_cancel(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.oracle_requests;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can record Oracle.' using errcode = 'insufficient_privilege'; end if;
  select * into r from public.oracle_requests where id = p_id for update;
  if not found then raise exception 'Oracle request not found.' using errcode = 'no_data_found'; end if;
  update public.oracle_requests set status = 'cancelled', status_at = now(), note = concat_ws(' | ', note, nullif(btrim(coalesce(p_note, '')), '')) where id = p_id;
  update public.leave_records set oracle_status = 'not_submitted', oracle_ref = null, oracle_updated_at = now()
   where root_id = r.leave_root_id and in_current_plan and start_date = r.start_date and end_date = r.end_date;
end $$;
revoke execute on function public.oracle_request_cancel(uuid, text) from public, anon;
grant execute on function public.oracle_request_cancel(uuid, text) to authenticated;

-- The Oracle HR page's bulk marking (and the reset after a reschedule) now writes the history too: a status for the
-- current dates of each record; Not submitted cancels the request for those exact dates (an older version's request
-- stays, so a moved leave shows "Oracle update required").
create or replace function public.leave_set_oracle(p_records uuid[], p_status text, p_ref text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_ref text := nullif(trim(coalesce(p_ref, '')), '');
  v_n integer := 0;
  l public.leave_records;
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
  for l in select * from public.leave_records where id = any (p_records) and in_current_plan and status in ('approved', 'planned') loop
    if p_status = 'not_submitted' then
      update public.oracle_requests set status = 'cancelled', status_at = now()
       where leave_root_id = l.root_id and status <> 'cancelled' and start_date = l.start_date and end_date = l.end_date;
      if l.oracle_status <> 'not_submitted' then
        update public.leave_records set oracle_status = 'not_submitted', oracle_ref = null, oracle_updated_at = now() where id = l.id;
        v_n := v_n + 1;
      end if;
    elsif l.oracle_status is distinct from p_status or (v_ref is not null and v_ref is distinct from l.oracle_ref) then
      perform public.oracle_request_record(l.id, p_status, v_ref, null, null, null);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
