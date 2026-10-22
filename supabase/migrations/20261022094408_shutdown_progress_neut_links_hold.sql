-- A neutralization field step that is the same physical work as equipment work steps points to them (link_acts): its
-- state is theirs, one update counts in both views. A loop can be put on hold with a reason (hold_reason), resumed.
alter table public.trk_point_step add column if not exists link_acts uuid[] not null default '{}';
alter table public.trk_points add column if not exists hold_reason text;
alter table public.trk_points add column if not exists hold_at timestamptz;

create or replace function public.trk_point_hold_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.hold_reason is not distinct from old.hold_reason then return new; end if;
  new.hold_at := case when new.hold_reason is null then null else now() end;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  values (new.tracker_id, 'point', new.ref, case when new.hold_reason is null then 'resumed' else 'hold' end, old.hold_reason, new.hold_reason, auth.uid(), public.trk_who());
  return new;
end $$;
create trigger trk_points_hold before update of hold_reason on public.trk_points for each row execute function public.trk_point_hold_log();
