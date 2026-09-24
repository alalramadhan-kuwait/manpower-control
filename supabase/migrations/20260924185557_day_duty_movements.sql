-- Day duty: a crew member leaves their crew for a period and works day shift, Sunday to Thursday (Friday and
-- Saturday off). Recorded as a temporary shift movement to 'DAY' (open-ended = until further notice), so the
-- one-movement-at-a-time rule, end / cancel and history all work as for a temporary cover. The person keeps
-- their home crew and returns to it when the day duty ends. The manpower engine takes them out of their crew
-- on those dates and lists them under Day duty; they are not counted in any crew's minimum.
alter table public.crew_movements drop constraint crew_movements_to_crew_check;
alter table public.crew_movements add constraint crew_movements_to_crew_check check (to_crew in ('A', 'B', 'C', 'D', 'DAY'));
alter table public.crew_movements add constraint cm_day_duty_temporary check (to_crew <> 'DAY' or kind = 'temporary');

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
  if p_to_crew not in ('A', 'B', 'C', 'D', 'DAY') then raise exception 'Choose the crew.' using errcode = 'check_violation'; end if;
  if p_to_crew = 'DAY' and p_kind <> 'temporary' then raise exception 'Day duty is recorded with a first day and a last day (or until further notice).' using errcode = 'check_violation'; end if;
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
