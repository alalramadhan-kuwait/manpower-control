-- Progress engine, phase 2: the physical completion of a quantity account (vessel empty) is stamped by the database,
-- logged, and cannot be changed afterwards. The engine screens are switched on for the test tracker only.
create or replace function public.trk_qty_scope_complete() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.complete_at is not distinct from old.complete_at then return new; end if;
  if old.complete_at is not null then raise exception 'Already confirmed empty on %', old.complete_at; end if;
  new.complete_at := now(); new.complete_by := auth.uid(); new.complete_by_name := public.trk_who();
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  values (new.tracker_id, 'qty', new.equipment_key || ' ' || new.scope, 'complete', null, 'physically complete (vessel empty)', auth.uid(), public.trk_who());
  return new;
end $$;
create or replace trigger trk_qty_scope_complete before update of complete_at on public.trk_qty_scope for each row execute function public.trk_qty_scope_complete();
update public.trk_trackers set settings = settings || '{"progressV2": true}'::jsonb where id = '2e9c8262-20e9-4274-bd52-87c156a3a487';
