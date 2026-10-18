-- Unit status: the crews' minimums come from which unit sections are running. Each section (Train-1, Train-2,
-- Fractionator Section) needs 1 Panel and 2 Field Operators per crew; the Controller and the Panel Grade 14+ stay
-- while any section runs. The Fractionator Section is essential: without it the whole unit is down (no minimum).
-- A section is down on the dates of a calendar shutdown / outage that names it (unit_events.unit_codes), so moving a
-- shutdown moves the minimums with it. A shutdown plan's dates now carry to its calendar event.
-- The hand-set periods that did the same job are retired: the Train-2 one was still on the old dates (1-30 Nov).

create table public.unit_sections (
  code        text primary key check (code ~ '^[a-z0-9_]{2,30}$'),
  label       text not null unique check (length(trim(label)) between 2 and 30),
  panel_min   int not null check (panel_min between 0 and 5),
  field_min   int not null check (field_min between 0 and 10),
  essential   boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.unit_sections is 'Unit sections and the Panel / Field Operators each crew needs for a section while it runs. essential = the unit cannot run without it.';
insert into public.unit_sections (code, label, panel_min, field_min, essential, sort_order) values
  ('train_1', 'Train-1', 1, 2, false, 1),
  ('train_2', 'Train-2', 1, 2, false, 2),
  ('fractionator', 'Fractionator Section', 1, 2, true, 3);
alter table public.unit_sections enable row level security;
create policy us_staff_read on public.unit_sections for select to authenticated using (public.app_is_staff());
create policy us_head_update on public.unit_sections for update to authenticated using (public.app_is_section_head()) with check (public.app_is_section_head());
grant select, update on public.unit_sections to authenticated;
create trigger unit_sections_touch before update on public.unit_sections for each row execute function public.calendar_touch();
create trigger unit_sections_audit after insert or update or delete on public.unit_sections for each row execute function public.audit_row_change();
create trigger unit_sections_mp_bump after insert or update or delete on public.unit_sections for each statement execute function public.manpower_bump();

-- which sections a shutdown / outage takes down
alter table public.unit_events add column unit_codes text[] not null default '{}';
alter table public.unit_events add constraint ue_units_only_down check (unit_codes = '{}' or category in ('shutdown', 'outage'));
comment on column public.unit_events.unit_codes is 'Unit sections down on these dates (shutdown / outage only); the crews'' minimums follow.';

create or replace function public.unit_events_units()
returns trigger language plpgsql set search_path = public as $$
declare bad text;
begin
  new.unit_codes := coalesce((select array_agg(distinct c order by c) from unnest(new.unit_codes) c), '{}');
  select c into bad from unnest(new.unit_codes) c where not exists (select 1 from unit_sections s where s.code = c) limit 1;
  if bad is not null then raise exception 'Unknown unit section: %', bad using errcode = 'check_violation'; end if;
  return new;
end $$;
revoke execute on function public.unit_events_units() from public, anon, authenticated;
create trigger unit_events_units before insert or update of unit_codes on public.unit_events for each row execute function public.unit_events_units();
create trigger unit_events_mp_bump after insert or update or delete on public.unit_events for each statement execute function public.manpower_bump();

update public.unit_events set unit_codes = '{train_1}' where status = 'active' and category = 'shutdown' and unit = 'Train-1';
update public.unit_events set unit_codes = '{train_2}' where status = 'active' and category = 'shutdown' and unit = 'Train-2';
update public.unit_events set unit_codes = '{fractionator,train_1,train_2}', unit = 'Whole unit' where status = 'active' and category = 'shutdown' and unit is null and title = 'Total turnaround';

-- a shutdown plan's dates carry to its calendar event (one place to move a shutdown)
create or replace function public.sd_plans_event_dates()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and new.event_id is not null and (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date) then
    update unit_events set start_date = new.start_date, end_date = new.end_date
     where id = new.event_id and status = 'active' and (start_date, end_date) is distinct from (new.start_date, new.end_date);
  end if;
  return null;
end $$;
revoke execute on function public.sd_plans_event_dates() from public, anon, authenticated;
create trigger sd_plans_event_dates after update of start_date, end_date on public.sd_plans for each row execute function public.sd_plans_event_dates();

-- the hand-set periods are replaced by the unit status; their modes stay for a manual override
update public.operation_periods set status = 'cancelled', cancel_reason = 'Replaced by the unit status (Train-2 down on the shutdown dates)' where status = 'active' and mode_code = 'train_sd';
update public.operation_periods set status = 'cancelled', cancel_reason = 'Replaced by the unit status (whole unit down on the turnaround dates)' where status = 'active' and mode_code = 'total_shutdown';
update public.operating_modes set is_active = false, note = 'Now from the unit status. Switch on only for a manual override.' where code in ('train_sd', 'total_shutdown');
