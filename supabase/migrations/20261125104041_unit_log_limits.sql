-- Unit log limit library (owner's "ARDS Shift Panel Log" spec, 25 Nov 2026): the operating limits, which e-logbook
-- reading or lab result each one judges, and the overrides / bypasses register (spec §5.1). The library rows are refinery
-- data and are loaded by SQL only (never in this public repo). Staff read; nobody writes from the app yet (limit changes
-- will go through the approval workflow of spec §4).

create table public.unit_limits (
  param_id text primary key check (param_id ~ '^[A-Z0-9-]{2,30}$'),
  section text not null,
  description text not null,
  tag_tr1 text,
  tag_tr2 text,
  unit text,
  frequency text,
  entry_by text,
  target text,
  normal_lo numeric,
  normal_hi numeric,
  iow_std text,
  iow_crit text,
  trip text,
  roc_max text,
  source text,
  action text,
  status text not null check (status in ('active', 'verify', 'retired')),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
comment on table public.unit_limits is 'Operating limits per parameter (normal, IOW standard / critical, trip for awareness), from the owner''s limit library';

create table public.unit_limit_matches (
  id bigint generated always as identity primary key,
  param_id text not null references public.unit_limits (param_id),
  kind text not null check (kind in ('reading', 'reading_sum', 'lab')),
  reading_key text,                 -- 'reading': a key, or /pattern/; 'reading_sum': /pattern/ whose matches are added per train
  scale numeric not null default 1,
  material text,
  component text,
  equipment text,
  check ((kind in ('reading', 'reading_sum') and reading_key is not null) or (kind = 'lab' and material is not null and component is not null))
);
create index unit_limit_matches_param_idx on public.unit_limit_matches (param_id);

create table public.unit_overrides (
  id uuid primary key default gen_random_uuid(),
  train text not null check (train in ('TR-1', 'TR-2', 'Common')),
  item text not null,
  tags text,
  reason text,
  moc text,
  started_on date,
  expires_on date,
  status text not null default 'open' check (status in ('open', 'closed')),
  source text,
  created_at timestamptz not null default now()
);
comment on table public.unit_overrides is 'Trip bypasses, voting changes and forced signals (spec §5.1); open items lead the handover';

alter table public.unit_limits enable row level security;
alter table public.unit_limit_matches enable row level security;
alter table public.unit_overrides enable row level security;
create policy unit_limits_read on public.unit_limits for select to authenticated using ((select public.app_current_role()) is not null);
create policy unit_limit_matches_read on public.unit_limit_matches for select to authenticated using ((select public.app_current_role()) is not null);
create policy unit_overrides_read on public.unit_overrides for select to authenticated using ((select public.app_current_role()) is not null);

revoke all on public.unit_limits, public.unit_limit_matches, public.unit_overrides from anon;
revoke insert, update, delete, truncate on public.unit_limits, public.unit_limit_matches, public.unit_overrides from authenticated;
grant select on public.unit_limits, public.unit_limit_matches, public.unit_overrides to authenticated;
grant select, insert, update on public.unit_limits, public.unit_limit_matches, public.unit_overrides to service_role;
