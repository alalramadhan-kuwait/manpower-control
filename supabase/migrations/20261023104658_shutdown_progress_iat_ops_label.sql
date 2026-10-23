-- One operations label on an IAT, shown in colour (Section Head, 23 Oct): painting (nothing needed from Operations),
-- spool to drop, ready for handover, operations work in progress. Empty = not set. Logged like the ticks.
alter table public.trk_iat add column if not exists ops_label text check (ops_label in ('painting', 'spool', 'ready', 'progress'));

create or replace function public.trk_iat_ops_log() returns trigger language plpgsql security definer set search_path = public as $$
declare f text; o boolean; n boolean;
begin
  foreach f in array array['ops_action', 'ho_required', 'ops_none', 'spool_only'] loop
    execute format('select ($1).%I, ($2).%I', f, f) into o, n using old, new;
    if n is distinct from o then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
      values (new.tracker_id, 'iat', new.iat_no, case f when 'ops_action' then 'operations action' when 'ho_required' then 'handover needed' when 'ops_none' then 'no action from operations' else 'spool drop only' end,
              o::text, n::text, auth.uid(), public.trk_who());
    end if;
  end loop;
  if new.ops_label is distinct from old.ops_label then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'iat', new.iat_no, 'operations label', old.ops_label, new.ops_label, auth.uid(), public.trk_who());
  end if;
  return new;
end $$;
create or replace trigger trk_iat_ops_log after update of ops_action, ho_required, ops_none, spool_only, ops_label on public.trk_iat for each row execute function public.trk_iat_ops_log();
