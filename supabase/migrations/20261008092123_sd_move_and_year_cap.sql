-- Section Head, 8 Oct 2026:
-- 1. Shutdown dates change: instead of a lock, sd_plan_move moves a shutdown with everything on it: the plan, its
--    people's dates (those on the whole shutdown keep covering it; others move by the same number of days, kept
--    inside), the phases, the "follow X shift" instructions before joining, and the calendar event. The app then
--    rebuilds the days and hours for the new dates. Changing the dates of a shutdown with people any other way is
--    refused, so nothing is left on the old dates.
-- 2. Yearly overtime cap: 380 h per person per calendar year. overtime_year_taken holds the hours each person already
--    took in the year (typed by the Section Head / Coordinator, with the date it is as of); a shutdown's overtime is
--    planned within what is left.

create or replace function public.sd_plans_dates_locked() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date)
     and coalesce(current_setting('app.sd_moving', true), '') <> old.id::text
     and exists (select 1 from public.sd_members m where m.plan_id = old.id and m.status = 'active') then
    raise exception 'Move a shutdown with people on it with "Move the shutdown" (its people, instructions and phases move with it).'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.sd_plan_move(p_plan uuid, p_start date, p_end date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.sd_plans; mv public.crew_movements; d integer; n_mem integer := 0; n_ph integer := 0; n_ins integer := 0; n_leave integer := 0;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can move a shutdown.' using errcode = 'insufficient_privilege'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation'; end if;
  select * into p from public.sd_plans where id = p_plan for update;
  if not found then raise exception 'Shutdown not found.' using errcode = 'no_data_found'; end if;
  if (p.start_date, p.end_date) = (p_start, p_end) then raise exception 'The dates are the same.' using errcode = 'check_violation'; end if;
  d := p_start - p.start_date;
  -- the instructions before joining (they end the day before the member joins) move with the member: the old
  -- movement is cancelled (kept as history) and the same instruction is made on the new dates
  for mv in select x.* from public.crew_movements x
             join public.sd_members m on m.employee_id = x.employee_id and m.plan_id = p.id and m.status = 'active'
            where x.status = 'active' and x.kind = 'temporary' and x.reason like 'Shutdown instruction%' and x.end_date = m.start_date - 1 loop
    perform public.crew_move_cancel(mv.id, 'Shutdown moved');
    perform public.crew_move(mv.employee_id, 'temporary', mv.to_crew, mv.start_date + d, mv.end_date + d, mv.reason);
    n_ins := n_ins + 1;
  end loop;
  perform set_config('app.sd_moving', p.id::text, true);
  update public.sd_plans set start_date = p_start, end_date = p_end where id = p.id;
  perform set_config('app.sd_moving', '', true);
  -- people: on the whole shutdown → the whole new shutdown; otherwise the same days moved, kept inside
  update public.sd_members m set
    start_date = case when m.start_date = p.start_date then p_start else greatest(m.start_date + d, p_start) end,
    end_date = greatest(case when m.start_date = p.start_date then p_start else greatest(m.start_date + d, p_start) end,
                        case when m.end_date = p.end_date then p_end else least(m.end_date + d, p_end) end)
   where m.plan_id = p.id and m.status = 'active';
  get diagnostics n_mem = row_count;
  update public.sd_phases s set start_date = greatest(s.start_date + d, p_start), end_date = greatest(greatest(s.start_date + d, p_start), least(s.end_date + d, p_end))
   where s.plan_id = p.id and s.status = 'active';
  get diagnostics n_ph = row_count;
  if p.event_id is not null then update public.unit_events set start_date = p_start, end_date = p_end where id = p.event_id; end if;
  -- people with leave inside the new dates (to move or to take off the team)
  select count(distinct m.employee_id) into n_leave from public.sd_members m
    join public.leave_records l on l.employee_id = m.employee_id and l.in_current_plan and l.status in ('approved', 'planned')
                               and l.start_date <= m.end_date and l.end_date >= m.start_date
   where m.plan_id = p.id and m.status = 'active';
  return jsonb_build_object('days', d, 'members', n_mem, 'phases', n_ph, 'instructions', n_ins, 'leave', n_leave);
end $$;
revoke execute on function public.sd_plan_move(uuid, date, date) from public, anon;
grant execute on function public.sd_plan_move(uuid, date, date) to authenticated;

-- yearly overtime
alter table public.sd_plans add column max_overtime_year numeric not null default 380 check (max_overtime_year > 0);
create table public.overtime_year_taken (
  employee_id uuid not null references public.employees (id),
  year        integer not null check (year between 2000 and 2100),
  hours       numeric not null check (hours >= 0 and hours <= 2000),
  as_of       date not null,
  note        text,
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (employee_id, year)
);
alter table public.overtime_year_taken enable row level security;
create policy overtime_year_taken_staff_read on public.overtime_year_taken for select to authenticated using (public.app_is_staff());
revoke insert, update, delete on public.overtime_year_taken from anon, authenticated;
create trigger overtime_year_taken_audit after insert or update or delete on public.overtime_year_taken for each row execute function public.audit_row_change();

create or replace function public.overtime_year_set(p_employee uuid, p_year integer, p_hours numeric, p_as_of date, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can enter overtime.' using errcode = 'insufficient_privilege'; end if;
  if p_hours is null or p_hours < 0 then raise exception 'Enter the hours (0 or more).' using errcode = 'check_violation'; end if;
  insert into public.overtime_year_taken (employee_id, year, hours, as_of, note)
  values (p_employee, p_year, p_hours, coalesce(p_as_of, current_date), nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (employee_id, year) do update set hours = excluded.hours, as_of = excluded.as_of, note = excluded.note, updated_by = auth.uid(), updated_at = now();
end $$;
revoke execute on function public.overtime_year_set(uuid, integer, numeric, date, text) from public, anon;
grant execute on function public.overtime_year_set(uuid, integer, numeric, date, text) to authenticated;
