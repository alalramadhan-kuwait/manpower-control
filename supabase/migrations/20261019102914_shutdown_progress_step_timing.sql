-- Step timing: when each guideline step started and was done (stamped on Start / Done, the times can be corrected),
-- against its estimate. The estimate is the Section Head's (setup), the times are progress.
alter table public.trk_steps add column started_at timestamptz, add column done_at timestamptz;

create or replace function public.trk_step_times() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'in_progress' and new.started_at is not distinct from old.started_at and new.started_at is null then new.started_at := now(); end if;
    if new.status = 'done' and new.done_at is not distinct from old.done_at then new.done_at := now(); end if;
    if new.status in ('not_started', 'na') and new.done_at is not distinct from old.done_at then new.done_at := null; end if;
    if new.status = 'not_started' and new.started_at is not distinct from old.started_at then new.started_at := null; end if;
  end if;
  if not (public.app_is_section_head() or auth.uid() is null) and new.est_hours is distinct from old.est_hours then
    raise exception 'Only the Section Head changes the estimate.'; end if;
  return new;
end $$;
create trigger trk_steps_times before update on public.trk_steps for each row execute function public.trk_step_times();

create or replace function public.trk_log_step_times() returns trigger language plpgsql security definer set search_path = public as $$
declare who text := public.trk_who();
begin
  if new.started_at is distinct from old.started_at and new.status is not distinct from old.status then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'step', new.step_id, 'started_at', old.started_at::text, new.started_at::text, auth.uid(), who); end if;
  if new.done_at is distinct from old.done_at and new.status is not distinct from old.status then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'step', new.step_id, 'done_at', old.done_at::text, new.done_at::text, auth.uid(), who); end if;
  return new;
end $$;
create trigger trk_steps_times_log after update on public.trk_steps for each row execute function public.trk_log_step_times();
