-- A shutdown ends with its start-up (owner, 28 Oct 2026): once a start-up step has a time, the Calendar shutdown's
-- last day follows the start-up. All steps done: the day the last one was done. Otherwise the expected day: each step
-- after the previous one (its actual done time, or a running step's start + standard, never before now) plus its
-- standard hours. A step not required takes no time. The change is kept in the audit history like any other.
create or replace function public.sd_startup_end_sync() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  ev uuid := coalesce(new.event_id, old.event_id);
  e public.unit_events; r record; cur timestamptz := null; open_n int := 0; any_time boolean := false; new_end date;
begin
  select * into e from public.unit_events where id = ev;
  if e.id is null or e.status <> 'active' or e.tentative then return null; end if;
  for r in select * from public.sd_startup_step where event_id = ev and active and status <> 'not_required' order by seq loop
    if r.started_at is not null or r.done_at is not null then any_time := true; end if;
    if r.status = 'done' and r.done_at is not null then cur := greatest(coalesce(cur, r.done_at), r.done_at);
    elsif r.status = 'running' and r.started_at is not null then open_n := open_n + 1; cur := greatest(coalesce(cur, now()), r.started_at + make_interval(secs => coalesce(r.std_hours, 0) * 3600), now());
    else open_n := open_n + 1; cur := greatest(coalesce(cur, now()), now()) + make_interval(secs => coalesce(r.std_hours, 0) * 3600);
    end if;
  end loop;
  if not any_time or cur is null then return null; end if;
  new_end := (cur at time zone 'Asia/Kuwait')::date;
  if new_end < e.start_date or new_end = e.end_date then return null; end if;
  update public.unit_events set end_date = new_end where id = ev;
  return null;
end $$;
revoke execute on function public.sd_startup_end_sync() from public, anon, authenticated;

create trigger sd_startup_step_end_sync after insert or update of status, started_at, done_at, std_hours, active, seq on public.sd_startup_step
  for each row execute function public.sd_startup_end_sync();

-- the shutdowns already in start-up follow now (Train-1 Sulfur line SD)
update public.sd_startup_step set seq = seq where id in (select distinct on (event_id) id from public.sd_startup_step where active order by event_id, seq);
