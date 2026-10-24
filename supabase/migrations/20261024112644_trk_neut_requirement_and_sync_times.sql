-- 1. Routine loop updates were refused ("Give a reason for correcting a time…"): changing a loop's fill / soak /
--    drain / done time makes trk_point_sync copy those times onto the linked soda-ash steps, and the time guard took
--    that copy for a person correcting a recorded time. A copy made by another trigger is now exempt from the reason
--    and 48 h rules (the person's change is the loop's, logged on the loop); no time in the future and no finish
--    before the start still apply to every change.
create or replace function public.trk_activity_time_guard() returns trigger
language plpgsql set search_path to 'public' as $$
declare person boolean := (auth.uid() is not null or public.trk_access_id() is not null) and pg_trigger_depth() <= 1;
  free boolean := public.app_is_section_head() or public.app_current_role() = 'engineer' or public.trk_access_id() is not null;
  s_old boolean := new.actual_start is distinct from old.actual_start and new.actual_start < now() - interval '48 hours';
  f_old boolean := new.actual_finish is distinct from old.actual_finish and new.actual_finish < now() - interval '48 hours';
  fixed boolean := (old.actual_start is not null and new.actual_start is not null and abs(extract(epoch from new.actual_start - old.actual_start)) > 60)
                or (old.actual_finish is not null and new.actual_finish is not null and abs(extract(epoch from new.actual_finish - old.actual_finish)) > 60);
begin
  if new.actual_start is not distinct from old.actual_start and new.actual_finish is not distinct from old.actual_finish then return new; end if;
  if new.actual_start > now() + interval '15 minutes' or new.actual_finish > now() + interval '15 minutes' then
    raise exception 'A start or finish time cannot be in the future.' using errcode = 'check_violation';
  end if;
  if new.actual_start is not null and new.actual_finish is not null and new.actual_finish < new.actual_start then
    raise exception 'The finish cannot be before the start.' using errcode = 'check_violation';
  end if;
  if person and (s_old or f_old) and not free then
    raise exception 'Times more than 48 h back are entered by an Engineer or the Section Head.' using errcode = 'insufficient_privilege';
  end if;
  if person and (s_old or f_old or fixed) and length(trim(coalesce(new.time_reason, ''))) = 0 then
    raise exception 'Give a reason for correcting a time or entering one more than 48 h back.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.trk_activity_time_guard() from public, anon;

-- 2. Neutralization requirement: Required (default) · Not required (N/R, with a reason) · Pending decision.
--    N/R only on a loop not started: it never stands for a neutralization performed. Who and when are stamped and
--    every change is logged with its reason. Blinds, handover steps and loop links are not touched.
alter table public.trk_points add column if not exists requirement text not null default 'required';
alter table public.trk_points add column if not exists requirement_reason text;
alter table public.trk_points add column if not exists requirement_by_name text;
alter table public.trk_points add column if not exists requirement_at timestamptz;
alter table public.trk_points add constraint trk_points_requirement_check check (requirement in ('required', 'not_required', 'pending'));
alter table public.trk_points add constraint trk_points_nr_reason check (requirement <> 'not_required' or length(trim(coalesce(requirement_reason, ''))) > 0);
alter table public.trk_points add constraint trk_points_nr_not_started check (requirement <> 'not_required' or (kind = 'neut' and status = 'open'));

create or replace function public.trk_point_requirement_stamp() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.requirement is distinct from old.requirement then
    new.requirement_by_name := public.trk_who(); new.requirement_at := now();
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason)
    values (new.tracker_id, 'point', new.ref, 'requirement', old.requirement, new.requirement, auth.uid(), public.trk_who(), nullif(trim(coalesce(new.requirement_reason, '')), ''));
  end if;
  return new;
end $$;
revoke execute on function public.trk_point_requirement_stamp() from public, anon;
create or replace trigger trk_point_requirement_stamp before update of requirement on public.trk_points
  for each row execute function public.trk_point_requirement_stamp();
