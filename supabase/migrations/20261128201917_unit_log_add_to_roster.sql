-- Add a person seen in a shift log but not in the roster (owner, 28 Nov 2026: "he does not add the roster, so I just
-- add him to the shift he's covering … by just clicking on his name"; chose: a crew member who counts like everyone
-- else, Section Head only). Creates the employee in Section 1 (Unit 12) with the home crew and role picked, from a
-- date. Qualifications and grade are left unset, so the manpower engine treats them as not yet confirmed until they
-- are set on the profile. Nothing existing is changed; both inserts are in the audit log.
create or replace function public.unit_log_add_to_roster(p_number text, p_name text, p_crew text, p_position text, p_from date, p_log_position text, p_log_no integer)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  num text := btrim(coalesce(p_number, ''));
  nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  eid uuid; pos uuid; crew uuid; sec uuid;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can add a person to the roster.' using errcode = 'insufficient_privilege'; end if;
  if num !~ '^\d{3,7}$' then raise exception 'Employee number must be 3 to 7 digits.'; end if;
  if length(nm) < 3 then raise exception 'Give the person''s name.'; end if;
  if p_position not in ('panel_operator', 'field_operator') then raise exception 'Role must be Panel or Field Operator.'; end if;
  if p_from is null then raise exception 'Give the date from which the person is in the crew.'; end if;
  if exists (select 1 from public.employees e where ltrim(e.employee_number, '0') = ltrim(num, '0')) then
    raise exception 'Employee % is already in the app: open the profile to change the crew or role.', num;
  end if;
  select id into crew from public.crews where code = p_crew;
  if crew is null then raise exception 'Crew must be A, B, C or D.'; end if;
  select id into pos from public.positions where code = p_position;
  select id into sec from public.sections where code = 'A4-S1-U12';
  insert into public.employees (employee_number, official_name, display_name, employment_type, employment_type_source, section_id, in_unit12_scope, is_active, master_position, notes)
    values (num, upper(nm), nm, case when length(num) = 6 then 'contractor' else 'knpc' end, 'inferred', sec, true, true,
            nullif(btrim(coalesce(p_log_position, '')), ''),
            'Added from the Unit log' || coalesce(' #' || p_log_no, '') || ' on ' || to_char(current_date, 'DD Mon YYYY') || ' (not in the roster; seen in the shift log).')
    returning id into eid;
  insert into public.employee_role_assignments (employee_id, position_id, home_crew_id, effective_from, source, source_ref, note)
    values (eid, pos, crew, p_from, 'manual', 'Unit log' || coalesce(' #' || p_log_no, ''), 'Added from the Unit log by the Section Head');
  return eid;
end $$;
revoke all on function public.unit_log_add_to_roster(text, text, text, text, date, text, integer) from public, anon;
grant execute on function public.unit_log_add_to_roster(text, text, text, text, date, text, integer) to authenticated;
