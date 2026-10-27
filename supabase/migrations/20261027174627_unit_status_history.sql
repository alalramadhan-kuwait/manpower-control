-- Unit status history (owner's notes, answered 27 Oct 2026: date and time of each change, and the link to the shutdown
-- plan). Read from the audit log the changes of the unit's shutdown events (unit_events) and of the operating-mode
-- overrides (operation_periods): added, dates changed, sections changed, cancelled. Read only; no names (not asked);
-- any app user. Nothing is copied: the audit log stays the record.
create or replace function public.unit_status_history(p_limit int default 200)
returns table (at timestamptz, kind text, action text, entity_id uuid, title text, units text[], mode_code text,
  old_start date, old_end date, new_start date, new_end date, old_status text, new_status text, plan_id uuid, plan_title text)
language sql stable security definer set search_path to 'public' as $$
  select a.occurred_at, case a.entity_table when 'unit_events' then 'unit' else 'mode' end, a.action, a.entity_id,
    coalesce(a.next->>'title', a.previous->>'title'),
    array(select jsonb_array_elements_text(coalesce(a.next->'unit_codes', a.previous->'unit_codes', '[]'::jsonb))),
    coalesce(a.next->>'mode_code', a.previous->>'mode_code'),
    (a.previous->>'start_date')::date, (a.previous->>'end_date')::date, (a.next->>'start_date')::date, (a.next->>'end_date')::date,
    a.previous->>'status', a.next->>'status', p.id, p.title
  from public.audit_log a
  left join lateral (select id, title from public.sd_plans s where a.entity_table = 'unit_events' and s.event_id = a.entity_id
                     order by (s.status = 'active') desc, s.start_date desc limit 1) p on true
  where public.app_current_role() is not null
    and a.entity_table in ('unit_events', 'operation_periods')
    and (a.action <> 'update' or (a.previous->>'start_date', a.previous->>'end_date', a.previous->>'status', coalesce(a.previous->'unit_codes', 'null'))
         is distinct from (a.next->>'start_date', a.next->>'end_date', a.next->>'status', coalesce(a.next->'unit_codes', 'null')))
  order by a.occurred_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;
revoke execute on function public.unit_status_history(int) from public, anon;
grant execute on function public.unit_status_history(int) to authenticated;
