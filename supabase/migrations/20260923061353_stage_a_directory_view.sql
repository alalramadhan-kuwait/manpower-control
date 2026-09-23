-- Read model for the employee directory / profile. security_invoker keeps RLS of the caller.
create or replace view public.employee_directory_v
with (security_invoker = true) as
select
  e.id, e.employee_number, e.full_name, e.short_name, e.employment_type, e.employment_type_source,
  e.in_unit12_scope, e.is_active, e.grade, e.master_position, e.cost_center, e.join_date,
  e.normalization_date, e.last_promotion_date, e.position_start_date, e.education, e.service_years,
  e.years_in_grade, e.notes, e.created_at, e.updated_at,
  s.code as section_code, s.name as section_name,
  ra.id as role_assignment_id, ra.effective_from as role_effective_from,
  p.code as position_code, p.label as position_label, p.category as position_category,
  c.code as crew_code,
  (select q.status from public.employee_qualifications q where q.employee_id = e.id and q.qualification = 'take_charge'       and q.effective_to is null) as take_charge_status,
  (select q.status from public.employee_qualifications q where q.employee_id = e.id and q.qualification = 'panel_operator'    and q.effective_to is null) as panel_operator_status,
  (select q.status from public.employee_qualifications q where q.employee_id = e.id and q.qualification = 'acting_controller' and q.effective_to is null) as acting_controller_status,
  (select q.status from public.employee_qualifications q where q.employee_id = e.id and q.qualification = 'controller'        and q.effective_to is null) as controller_status,
  (select count(*) from public.leave_records l where l.employee_id = e.id and l.status = 'unresolved') as unresolved_absences
from public.employees e
left join public.sections s on s.id = e.section_id
left join public.employee_role_assignments ra on ra.employee_id = e.id and ra.effective_to is null
left join public.positions p on p.id = ra.position_id
left join public.crews c on c.id = ra.home_crew_id;

grant select on public.employee_directory_v to authenticated;
