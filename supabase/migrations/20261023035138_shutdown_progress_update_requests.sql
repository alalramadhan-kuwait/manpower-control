-- Ask for updates: each item put in a WhatsApp update request is recorded (who, when), so the next request can say
-- "2nd request" for an item still not updated since.
create table public.trk_ask (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  item_key text not null,
  asked_at timestamptz not null default now(),
  by_user uuid, by_name text
);
alter table public.trk_ask enable row level security;
create policy trk_ask_read on public.trk_ask for select using (public.app_current_role() is not null);
create policy trk_ask_insert on public.trk_ask for insert with check (public.trk_can_update());
create index trk_ask_tracker on public.trk_ask (tracker_id, item_key, asked_at desc);

create or replace function public.trk_ask_stamp() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.by_user := auth.uid(); new.by_name := public.trk_who(); new.asked_at := now();
  return new;
end $$;
create or replace trigger trk_ask_stamp before insert on public.trk_ask for each row execute function public.trk_ask_stamp();
