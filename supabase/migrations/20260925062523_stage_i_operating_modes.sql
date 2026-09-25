-- Stage I: operating modes (shutdown, one train, ...) with their own minimums per crew, and the dates they apply.
-- - operating_modes: a name and the four minimums. 'full_operation' is the default (1 / 3 / 1 Grade 14+ / 6) and
--   applies on every date that has no period. Only the Section Head adds modes or changes the numbers.
-- - operation_periods: mode from a first day to a last day. Active periods never overlap. The Section Head or the
--   Manpower Coordinator schedules them; a period is cancelled, not deleted, so the history stays.
-- Both tables are audited.

create table public.operating_modes (
  code              text primary key check (code ~ '^[a-z0-9_]{2,40}$'),
  label             text not null check (length(trim(label)) between 2 and 60),
  controller_min    int  not null check (controller_min between 0 and 5),
  panel_min         int  not null check (panel_min between 0 and 10),
  panel_grade14_min int  not null check (panel_grade14_min between 0 and 10),
  field_min         int  not null check (field_min between 0 and 20),
  is_default        boolean not null default false,
  is_active         boolean not null default true,
  sort_order        int not null default 100,
  note              text,
  updated_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  constraint om_grade14_within_panel check (panel_grade14_min <= panel_min)
);
create unique index operating_modes_one_default on public.operating_modes (is_default) where is_default;
comment on table public.operating_modes is 'Stage I: minimums per crew for each operating mode; full_operation is the default.';
insert into public.operating_modes (code, label, controller_min, panel_min, panel_grade14_min, field_min, is_default, sort_order)
values ('full_operation', 'Full operation', 1, 3, 1, 6, true, 0);

create table public.operation_periods (
  id            uuid primary key default gen_random_uuid(),
  mode_code     text not null references public.operating_modes(code),
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
  constraint op_dates check (end_date >= start_date),
  constraint op_no_overlap exclude using gist (daterange(start_date, end_date, '[]') with &&) where (status = 'active')
);
create index operation_periods_dates on public.operation_periods (start_date, end_date);
comment on table public.operation_periods is 'Stage I: which operating mode applies from start_date to end_date (inclusive). Dates without an active period use the default mode.';

create or replace function public.operation_period_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'cancelled' then raise exception 'A cancelled period is kept as history and cannot be changed.' using errcode = 'check_violation'; end if;
  if new.status = 'cancelled' then new.cancelled_at := now(); new.cancelled_by := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.operation_period_touch() from public, anon, authenticated;
create trigger operation_periods_touch before update on public.operation_periods for each row execute function public.operation_period_touch();

create or replace function public.operating_mode_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  if tg_op = 'UPDATE' and old.is_default and (new.is_default is distinct from true or new.is_active is distinct from true) then
    raise exception 'Full operation stays the default mode.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.operating_mode_touch() from public, anon, authenticated;
create trigger operating_modes_touch before insert or update on public.operating_modes for each row execute function public.operating_mode_touch();

create trigger operating_modes_audit after insert or update or delete on public.operating_modes for each row execute function public.audit_row_change();
create trigger operation_periods_audit after insert or update or delete on public.operation_periods for each row execute function public.audit_row_change();

alter table public.operating_modes enable row level security;
create policy om_staff_read on public.operating_modes for select to authenticated using (public.app_is_staff());
create policy om_head_insert on public.operating_modes for insert to authenticated with check (public.app_is_section_head() and not is_default);
create policy om_head_update on public.operating_modes for update to authenticated using (public.app_is_section_head()) with check (public.app_is_section_head());
-- no delete: a mode that is no longer used is switched off (is_active = false)

alter table public.operation_periods enable row level security;
create policy op_staff_read on public.operation_periods for select to authenticated using (public.app_is_staff());
create policy op_staff_insert on public.operation_periods for insert to authenticated with check (public.app_is_staff() and status = 'active');
create policy op_staff_update on public.operation_periods for update to authenticated using (public.app_is_staff()) with check (public.app_is_staff());
-- no delete: cancelled periods are history
