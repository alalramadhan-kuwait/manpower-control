-- The shutdown team of a date for the engineer view (Section Head, 23 Oct): a link cannot read the staff tables, so
-- this returns only what the "who is on duty" card needs, for the shutdown plans active on that date: the plan, its
-- teams and members with their own days on the date, the members' names and crews, and their counted leave around
-- the date (approved or planned, current plan). Anyone who can read the tracker (app login or a link) may call it.
create or replace function public.trk_sd_team(p_date date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare plans uuid[]; mems uuid[]; emps uuid[];
begin
  if not public.trk_can_read() then raise exception 'Not allowed.'; end if;
  select coalesce(array_agg(id), '{}') into plans from public.sd_plans where status = 'active' and start_date <= p_date and end_date >= p_date;
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(distinct employee_id), '{}') into mems, emps
    from public.sd_members where plan_id = any(plans) and status = 'active' and start_date <= p_date and end_date >= p_date;
  return jsonb_build_object(
    'plans', coalesce((select jsonb_agg(to_jsonb(p) - 'signatures' - 'memo') from public.sd_plans p where p.id = any(plans)), '[]'),
    'teams', coalesce((select jsonb_agg(to_jsonb(t)) from public.sd_teams t where t.plan_id = any(plans) and t.status = 'active'), '[]'),
    'members', coalesce((select jsonb_agg(to_jsonb(m)) from public.sd_members m where m.id = any(mems)), '[]'),
    'days', coalesce((select jsonb_agg(jsonb_build_object('member_id', d.member_id, 'work_date', d.work_date, 'works', d.works, 'hours', d.hours))
                        from public.sd_days d where d.member_id = any(mems) and d.work_date between p_date - 1 and p_date + 1), '[]'),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.display_name, 'crew', e.crew_code)) from public.employee_directory_v e where e.id = any(emps)), '[]'),
    'leave', coalesce((select jsonb_agg(jsonb_build_object('employee_id', l.employee_id, 'start_date', l.start_date, 'end_date', l.end_date, 'status', l.status, 'in_current_plan', l.in_current_plan,
                        'oracle_status', l.oracle_status, 'absence_type_code', l.absence_type_code, 'label', a.label, 'short_code', a.short_code))
                        from public.leave_records l left join public.absence_types a on a.code = l.absence_type_code
                       where l.employee_id = any(emps) and l.in_current_plan and l.status in ('approved', 'planned')
                         and l.start_date <= p_date + 120 and (l.end_date is null or l.end_date >= p_date - 120)), '[]'));
end $$;
revoke all on function public.trk_sd_team(date) from public;
grant execute on function public.trk_sd_team(date) to anon, authenticated;
