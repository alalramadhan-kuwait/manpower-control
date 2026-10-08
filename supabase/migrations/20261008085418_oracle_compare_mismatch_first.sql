-- When Oracle holds both an older version of a leave and dates never in its approved chain, the comparison shows
-- the mismatch (the more serious problem) with those dates; otherwise the latest older version (update required).
create or replace view public.oracle_compare_v with (security_invoker = true) as
select l.id as leave_record_id, l.employee_id, l.root_id, l.plan_year, l.absence_type_code, l.start_date, l.end_date, true as in_plan,
       coalesce(x.id, y.id) as oracle_request_id, coalesce(x.start_date, y.start_date) as oracle_start, coalesce(x.end_date, y.end_date) as oracle_end,
       coalesce(x.status, y.status) as oracle_status, coalesce(x.oracle_ref, y.oracle_ref) as oracle_ref, coalesce(x.source, y.source) as oracle_source,
       case
         when x.id is not null then case x.status when 'approved' then 'match' when 'submitted' then 'submitted' else 'rejected' end
         when y.id is null then 'not_submitted'
         when y.in_chain then 'update_required'
         else 'mismatch'
       end as compare_status
  from public.leave_records l
  left join lateral (select r.* from public.oracle_requests r
                      where r.leave_root_id = l.root_id and r.status <> 'cancelled' and r.start_date = l.start_date and r.end_date = l.end_date
                      order by r.recorded_at desc, r.status_at desc limit 1) x on true
  left join lateral (select r.*, exists (select 1 from public.leave_records v where v.root_id = r.leave_root_id and not v.in_current_plan
                                           and v.start_date = r.start_date and v.end_date = r.end_date) as in_chain
                       from public.oracle_requests r
                      where r.leave_root_id = l.root_id and r.status in ('submitted', 'approved')
                        and not exists (select 1 from public.leave_records c where c.root_id = r.leave_root_id and c.in_current_plan
                                          and c.start_date = r.start_date and c.end_date = r.end_date)
                      order by in_chain asc, r.recorded_at desc, r.status_at desc limit 1) y on x.id is null
 where l.in_current_plan and l.status in ('approved', 'planned')
union all
select v.id, v.employee_id, v.root_id, v.plan_year, v.absence_type_code, v.start_date, v.end_date, false,
       r.id, r.start_date, r.end_date, r.status, r.oracle_ref, r.source, 'update_required'
  from public.oracle_requests r
  join lateral (select * from public.leave_records v where v.root_id = r.leave_root_id order by v.version_no desc, v.created_at desc limit 1) v on true
 where r.status in ('submitted', 'approved')
   and not exists (select 1 from public.leave_records c where c.root_id = r.leave_root_id and c.in_current_plan);
