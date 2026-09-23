-- audit_row_change: tolerate tables whose id is not a uuid (e.g. the single-row controller_rules);
-- entity_id is left null there, previous/next still record the full row.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_emp uuid;
  v_id  uuid;
begin
  if tg_table_name = 'employees' then
    v_emp := (v_row->>'id')::uuid;
  else
    v_emp := nullif(v_row->>'employee_id','')::uuid;
  end if;
  if (v_row->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_id := (v_row->>'id')::uuid;
  end if;
  insert into public.audit_log (actor_id, entity_table, entity_id, action, previous, next, related_employee_id, batch_id)
  values (
    auth.uid(), tg_table_name, v_id, lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    v_emp,
    nullif(v_row->>'source_batch_id','')::uuid
  );
  return coalesce(new, old);
end $function$;
