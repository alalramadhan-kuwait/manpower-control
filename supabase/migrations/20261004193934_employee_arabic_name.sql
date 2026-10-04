-- The employee's name in Arabic, typed by the Section Head (Employees › profile › Edit). Used by search: an Arabic word is
-- matched against it directly, and by sound against the English spellings when it is empty. Added at the end of the directory view.
alter table public.employees add column if not exists arabic_name text;
comment on column public.employees.arabic_name is 'Name in Arabic letters, for search; typed by the Section Head.';

create or replace view public.employee_directory_v with (security_invoker = true) as
 SELECT e.id,
    e.employee_number,
    e.official_name,
    e.display_name,
    e.short_name,
    e.employment_type,
    e.employment_type_source,
    e.in_unit12_scope,
    e.is_active,
    e.grade,
    e.master_position,
    e.cost_center,
    e.join_date,
    e.normalization_date,
    e.last_promotion_date,
    e.position_start_date,
    e.education,
    e.service_years,
    e.years_in_grade,
    e.notes,
    e.created_at,
    e.updated_at,
    s.code AS section_code,
    s.name AS section_name,
    ra.id AS role_assignment_id,
    ra.effective_from AS role_effective_from,
    p.code AS position_code,
    p.label AS position_label,
    p.category AS position_category,
    c.code AS crew_code,
    ( SELECT q.status
           FROM employee_qualifications q
          WHERE q.employee_id = e.id AND q.qualification = 'take_charge'::text AND q.effective_to IS NULL) AS take_charge_status,
    ( SELECT q.status
           FROM employee_qualifications q
          WHERE q.employee_id = e.id AND q.qualification = 'panel_operator'::text AND q.effective_to IS NULL) AS panel_operator_status,
    ( SELECT q.status
           FROM employee_qualifications q
          WHERE q.employee_id = e.id AND q.qualification = 'acting_controller'::text AND q.effective_to IS NULL) AS acting_controller_status,
    ( SELECT q.status
           FROM employee_qualifications q
          WHERE q.employee_id = e.id AND q.qualification = 'controller'::text AND q.effective_to IS NULL) AS controller_status,
    ( SELECT count(*) AS count
           FROM leave_records l
          WHERE l.employee_id = e.id AND l.status = 'unresolved'::text) AS unresolved_absences,
    ra.source AS role_source,
    ra.note AS role_note,
    e.fo_level,
    e.can_cover_field,
    e.arabic_name
   FROM employees e
     LEFT JOIN sections s ON s.id = e.section_id
     LEFT JOIN employee_role_assignments ra ON ra.employee_id = e.id AND ra.effective_to IS NULL
     LEFT JOIN positions p ON p.id = ra.position_id
     LEFT JOIN crews c ON c.id = ra.home_crew_id;
