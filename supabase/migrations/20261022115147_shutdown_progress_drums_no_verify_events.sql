-- Drum entries count when entered: no second-person verification (Section Head, 22 Oct). Corrections stay entries.
alter table public.trk_qty_entry alter column verify_state set default 'verified';

-- Events of the shutdown that are not one item's work: nitrogen supply (trailers) and issues common to the reactors.
-- Recorded above the reactors on the equipment page, open until ended, logged.
create table public.trk_event (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  category text not null check (category in ('nitrogen', 'reactors', 'other')),
  text text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  by_user uuid, by_name text, ended_by_name text,
  updated_at timestamptz
);
alter table public.trk_event enable row level security;
create policy trk_event_read on public.trk_event for select using (public.app_current_role() is not null);
create policy trk_event_insert on public.trk_event for insert with check (public.trk_can_update());
create policy trk_event_update on public.trk_event for update using (public.trk_can_update()) with check (public.trk_can_update());
create index trk_event_tracker on public.trk_event (tracker_id, started_at desc);

create or replace function public.trk_event_stamp() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.by_user := auth.uid(); new.by_name := public.trk_who();
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'event', new.category, 'event', null, new.text, auth.uid(), public.trk_who());
  else
    new.updated_at := now();
    if new.ended_at is distinct from old.ended_at then
      new.ended_by_name := case when new.ended_at is null then null else public.trk_who() end;
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
      values (new.tracker_id, 'event', new.category, case when new.ended_at is null then 'event reopened' else 'event ended' end, null, new.text, auth.uid(), public.trk_who());
    end if;
  end if;
  return new;
end $$;
create trigger trk_event_stamp before insert or update on public.trk_event for each row execute function public.trk_event_stamp();
