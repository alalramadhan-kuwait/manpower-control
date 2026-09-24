-- Stage G: shift movements.
-- - Permanent move: the home crew changes from a date. The current role row is closed the day before and a new
--   (manual) row with the same position and the new crew starts on that date, so history stays dated and a
--   workbook import never moves the person back. A crew_movements row records the move.
-- - Temporary cover: the person works with another crew for a period (open-ended = until further notice). Only
--   one active temporary movement per person at a time. The manpower engine counts them in the covering crew
--   on those dates.
-- All changes go through crew_move / crew_move_end / crew_move_cancel (staff only). Nothing is deleted:
-- cancelled movements stay as history and are locked. Audited.

create table public.crew_movements (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id),
  kind           text not null check (kind in ('temporary', 'permanent')),
  from_crew      text check (from_crew in ('A', 'B', 'C', 'D')),
  to_crew        text not null check (to_crew in ('A', 'B', 'C', 'D')),
  start_date     date not null,
  end_date       date,
  reason         text,
  status         text not null default 'active' check (status in ('active', 'cancelled')),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  cancelled_by   uuid,
  cancelled_at   timestamptz,
  cancel_reason  text,
  constraint cm_dates check (end_date is null or end_date >= start_date),
  constraint cm_permanent_open check (kind <> 'permanent' or end_date is null),
  constraint cm_one_temporary_at_a_time exclude using gist (employee_id with =, daterange(start_date, end_date, '[]') with &&)
    where (status = 'active' and kind = 'temporary')
);
comment on table public.crew_movements is 'Shift movements (Stage G). Temporary covers are applied by date by the manpower engine; permanent moves are applied through employee_role_assignments and recorded here.';
create index crew_movements_employee on public.crew_movements (employee_id, start_date);

create or replace function public.crew_movement_lock()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'cancelled' then raise exception 'A cancelled movement is kept as history and cannot be changed.' using errcode = 'check_violation'; end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then new.cancelled_at := now(); new.cancelled_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.crew_movement_lock() from public, anon, authenticated;
create trigger crew_movements_lock before update on public.crew_movements for each row execute function public.crew_movement_lock();
create trigger crew_movements_audit after insert or update or delete on public.crew_movements for each row execute function public.audit_row_change();

alter table public.crew_movements enable row level security;
create policy cm_staff_read on public.crew_movements for select to authenticated using (public.app_is_staff());
create policy cm_staff_insert on public.crew_movements for insert to authenticated with check (public.app_is_staff());
create policy cm_staff_update on public.crew_movements for update to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
-- no delete policy: movements are history

create or replace function public.crew_move(p_employee uuid, p_kind text, p_to_crew text, p_start date, p_end date, p_reason text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_ra     public.employee_role_assignments;
  v_crew   text;
  v_to     uuid;
  v_id     uuid;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can record shift movements.' using errcode = 'insufficient_privilege'; end if;
  if p_kind not in ('temporary', 'permanent') then raise exception 'Choose a temporary cover or a permanent move.' using errcode = 'check_violation'; end if;
  if p_to_crew not in ('A', 'B', 'C', 'D') then raise exception 'Choose the crew.' using errcode = 'check_violation'; end if;
  if p_start is null then raise exception 'Enter the first day.' using errcode = 'check_violation'; end if;
  if p_end is not null and p_end < p_start then raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation'; end if;
  if p_kind = 'permanent' and p_end is not null then raise exception 'A permanent move has no last day.' using errcode = 'check_violation'; end if;
  if v_reason is null then raise exception 'Give the reason.' using errcode = 'check_violation'; end if;

  select * into v_ra from public.employee_role_assignments
   where employee_id = p_employee and effective_from <= p_start and (effective_to is null or effective_to >= p_start)
   order by effective_from desc limit 1;
  if not found then raise exception 'No role is recorded for this employee on %.', to_char(p_start, 'FMDD Mon YYYY') using errcode = 'check_violation'; end if;
  select code into v_crew from public.crews where id = v_ra.home_crew_id;
  if v_crew is null then raise exception 'Only crew members move between shifts (VR, Morning Controller and day staff have no crew).' using errcode = 'check_violation'; end if;
  if v_crew = p_to_crew then raise exception 'Already in % Shift on %.', p_to_crew, to_char(p_start, 'FMDD Mon YYYY') using errcode = 'check_violation'; end if;
  select id into v_to from public.crews where code = p_to_crew;

  if p_kind = 'permanent' then
    if v_ra.effective_to is not null or exists (select 1 from public.employee_role_assignments where employee_id = p_employee and effective_from > p_start) then
      raise exception 'A later role or crew change is already recorded. Correct it on the profile first.' using errcode = 'check_violation';
    end if;
    if v_ra.effective_from = p_start then
      update public.employee_role_assignments set home_crew_id = v_to, source = 'manual', note = 'Shift movement (permanent): ' || v_reason where id = v_ra.id;
    else
      update public.employee_role_assignments set effective_to = p_start - 1 where id = v_ra.id;
      insert into public.employee_role_assignments (employee_id, position_id, home_crew_id, effective_from, source, note)
      values (p_employee, v_ra.position_id, v_to, p_start, 'manual', 'Shift movement (permanent): ' || v_reason);
    end if;
  end if;

  insert into public.crew_movements (employee_id, kind, from_crew, to_crew, start_date, end_date, reason)
  values (p_employee, p_kind, v_crew, p_to_crew, p_start, p_end, v_reason)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.crew_move_end(p_id uuid, p_end date, p_note text)
returns void language plpgsql security invoker set search_path = public as $$
declare m public.crew_movements;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can change shift movements.' using errcode = 'insufficient_privilege'; end if;
  select * into m from public.crew_movements where id = p_id for update;
  if m.id is null then raise exception 'Movement not found.' using errcode = 'no_data_found'; end if;
  if m.kind <> 'temporary' or m.status <> 'active' then raise exception 'Only an active temporary cover can be ended.' using errcode = 'check_violation'; end if;
  if p_end is null or p_end < m.start_date then raise exception 'The last day cannot be before the first day (%).', to_char(m.start_date, 'FMDD Mon YYYY') using errcode = 'check_violation'; end if;
  if m.end_date is not null and p_end >= m.end_date then raise exception 'Choose a day before the current last day (%).', to_char(m.end_date, 'FMDD Mon YYYY') using errcode = 'check_violation'; end if;
  update public.crew_movements set end_date = p_end, reason = concat_ws(' | ', reason, 'Ended ' || to_char(p_end, 'FMDD Mon YYYY') || coalesce(': ' || nullif(trim(p_note), ''), '')) where id = p_id;
end $$;

create or replace function public.crew_move_cancel(p_id uuid, p_reason text)
returns void language plpgsql security invoker set search_path = public as $$
declare m public.crew_movements;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can change shift movements.' using errcode = 'insufficient_privilege'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Give the reason for cancelling.' using errcode = 'check_violation'; end if;
  select * into m from public.crew_movements where id = p_id for update;
  if m.id is null then raise exception 'Movement not found.' using errcode = 'no_data_found'; end if;
  if m.kind <> 'temporary' or m.status <> 'active' then raise exception 'Only an active temporary cover can be cancelled. A permanent move is corrected on the profile (Correct role / crew).' using errcode = 'check_violation'; end if;
  update public.crew_movements set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_id;
end $$;

revoke execute on function public.crew_move(uuid, text, text, date, date, text) from public, anon;
revoke execute on function public.crew_move_end(uuid, date, text) from public, anon;
revoke execute on function public.crew_move_cancel(uuid, text) from public, anon;
grant execute on function public.crew_move(uuid, text, text, date, date, text) to authenticated;
grant execute on function public.crew_move_end(uuid, date, text) to authenticated;
grant execute on function public.crew_move_cancel(uuid, text) to authenticated;
