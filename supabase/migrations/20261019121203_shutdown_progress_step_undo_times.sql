-- A step taken back from Done (by mistake) loses its done time whatever it goes back to (in progress, pending, not started).
create or replace function public.trk_step_times() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'in_progress' and new.started_at is not distinct from old.started_at and new.started_at is null then new.started_at := now(); end if;
    if new.status = 'done' and new.done_at is not distinct from old.done_at then new.done_at := now(); end if;
    if new.status <> 'done' and new.done_at is not distinct from old.done_at then new.done_at := null; end if;
    if new.status = 'not_started' and new.started_at is not distinct from old.started_at then new.started_at := null; end if;
  end if;
  if not (public.app_is_section_head() or auth.uid() is null) and new.est_hours is distinct from old.est_hours then
    raise exception 'Only the Section Head changes the estimate.'; end if;
  return new;
end $$;
