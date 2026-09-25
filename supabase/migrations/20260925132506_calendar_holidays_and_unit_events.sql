-- Calendar: Kuwait public holidays and unit events (shutdown / startup / maintenance / catalyst / outage / ...).
-- Both are information on the calendar: they do not change the manpower minimums (operating modes do that).
-- - public_holidays: name and dates. `expected` = dates depend on the moon sighting or the official
--   announcement and must be confirmed; the Section Head or Coordinator edits them in the app.
-- - unit_events: category, title, unit / train (for colour), dates; cancelled instead of deleted.
-- Both audited; staff read and write.

create table public.public_holidays (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 2 and 80),
  start_date  date not null,
  end_date    date not null,
  expected    boolean not null default false,
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ph_dates check (end_date >= start_date)
);
create index public_holidays_dates on public.public_holidays (start_date, end_date);
comment on table public.public_holidays is 'Kuwait official public holidays shown on the calendar. expected = not yet confirmed by the official announcement.';

create table public.unit_events (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('shutdown', 'startup', 'maintenance', 'catalyst', 'outage', 'operational', 'training', 'other')),
  title         text not null check (length(trim(title)) between 2 and 80),
  unit          text check (unit is null or length(trim(unit)) between 1 and 40),
  start_date    date not null,
  end_date      date not null,
  note          text,
  status        text not null default 'active' check (status in ('active', 'cancelled')),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  cancelled_by  uuid,
  cancelled_at  timestamptz,
  cancel_reason text,
  constraint ue_dates check (end_date >= start_date)
);
create index unit_events_dates on public.unit_events (start_date, end_date);
comment on table public.unit_events is 'Unit / train events on the calendar (shutdown, startup, maintenance, catalyst, outage, operational, training). Information only.';

create or replace function public.calendar_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'unit_events' then
    if old.status = 'cancelled' then raise exception 'A cancelled event is kept as history and cannot be changed.' using errcode = 'check_violation'; end if;
    if new.status = 'cancelled' then new.cancelled_at := now(); new.cancelled_by := auth.uid(); end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.calendar_touch() from public, anon, authenticated;
create trigger public_holidays_touch before update on public.public_holidays for each row execute function public.calendar_touch();
create trigger unit_events_touch before update on public.unit_events for each row execute function public.calendar_touch();
create trigger public_holidays_audit after insert or update or delete on public.public_holidays for each row execute function public.audit_row_change();
create trigger unit_events_audit after insert or update or delete on public.unit_events for each row execute function public.audit_row_change();

alter table public.public_holidays enable row level security;
create policy ph_staff_read on public.public_holidays for select to authenticated using (public.app_is_staff());
create policy ph_staff_insert on public.public_holidays for insert to authenticated with check (public.app_is_staff());
create policy ph_staff_update on public.public_holidays for update to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
create policy ph_staff_delete on public.public_holidays for delete to authenticated using (public.app_is_staff());

alter table public.unit_events enable row level security;
create policy ue_staff_read on public.unit_events for select to authenticated using (public.app_is_staff());
create policy ue_staff_insert on public.unit_events for insert to authenticated with check (public.app_is_staff() and status = 'active');
create policy ue_staff_update on public.unit_events for update to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
-- no delete on events: cancelled events are history

-- Kuwait public holidays. Fixed-date holidays are certain; Islamic holidays follow the Hijri calendar and are
-- marked expected until the Civil Service Commission announces the official days off.
insert into public.public_holidays (name, start_date, end_date, expected, note) values
  ('New Year''s Day',             '2026-01-01', '2026-01-01', false, null),
  ('National Day',                '2026-02-25', '2026-02-25', false, null),
  ('Liberation Day',              '2026-02-26', '2026-02-26', false, null),
  ('New Year''s Day',             '2027-01-01', '2027-01-01', false, null),
  ('Isra'' and Mi''raj',          '2027-01-05', '2027-01-05', true,  '27 Rajab 1448 (expected; may be moved by the official announcement)'),
  ('National Day',                '2027-02-25', '2027-02-25', false, null),
  ('Liberation Day',              '2027-02-26', '2027-02-26', false, null),
  ('Eid al-Fitr',                 '2027-03-09', '2027-03-11', true,  '1–3 Shawwal 1448 (expected; moon sighting)'),
  ('Arafat Day',                  '2027-05-15', '2027-05-15', true,  '9 Dhu al-Hijjah 1448 (expected; moon sighting)'),
  ('Eid al-Adha',                 '2027-05-16', '2027-05-18', true,  '10–12 Dhu al-Hijjah 1448 (expected; moon sighting)'),
  ('Islamic New Year',            '2027-06-06', '2027-06-06', true,  '1 Muharram 1449 (expected)'),
  ('Prophet''s Birthday',         '2027-08-15', '2027-08-15', true,  '12 Rabi'' al-Awwal 1449 (expected)');
