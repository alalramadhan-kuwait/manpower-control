-- Two ticks on each IAT, set by a person: Operations action needed, handover needed. Logged when changed.
alter table public.trk_iat add column if not exists ops_action boolean not null default false;
alter table public.trk_iat add column if not exists ho_required boolean not null default false;

create or replace function public.trk_iat_ops_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ops_action is distinct from old.ops_action then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'iat', new.iat_no, 'operations action', old.ops_action::text, new.ops_action::text, auth.uid(), public.trk_who());
  end if;
  if new.ho_required is distinct from old.ho_required then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'iat', new.iat_no, 'handover needed', old.ho_required::text, new.ho_required::text, auth.uid(), public.trk_who());
  end if;
  return new;
end $$;
create trigger trk_iat_ops_log after update of ops_action, ho_required on public.trk_iat for each row execute function public.trk_iat_ops_log();
