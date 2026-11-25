-- Unit log (owner, 25 Nov 2026): the shift logs and lab results the e-logbook and the lab system e-mail every shift,
-- read on the owner's Mac (src/core/logbook/parse.ts) and sent by the logbook-ingest function. Staff read them; only the
-- server writes (service role), and only for a Mac key that is on file and not revoked.

create table public.unit_shift_logs (
  kind text not null check (kind in ('ards', 'htu', 'controller1')),
  log_no integer not null check (log_no > 0),
  log_date date not null,
  shift text check (shift in ('Morning', 'Afternoon', 'Night')),
  crew text check (crew in ('A', 'B', 'C', 'D')),
  shift_day text check (shift_day in ('1st', '2nd')),
  recorded_at timestamptz,
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  readings jsonb not null default '[]'::jsonb check (jsonb_typeof(readings) = 'array'),
  feed jsonb not null default '[]'::jsonb check (jsonb_typeof(feed) = 'array'),
  products jsonb not null default '[]'::jsonb check (jsonb_typeof(products) = 'array'),
  unplaced integer not null default 0,
  source_file text,
  received_at timestamptz not null default now(),
  primary key (kind, log_no)
);
create index unit_shift_logs_date_idx on public.unit_shift_logs (log_date desc, kind);
comment on table public.unit_shift_logs is 'Shift logs read from the e-logbook PDFs: ARDS (the unit), HTU (information only) and the ARDS part of the Controller I log';

create table public.unit_lab_samples (
  sample_id text primary key check (length(sample_id) between 1 and 80),
  unit_no text,
  material text,
  equipment text,
  collected_at timestamptz,
  note text,
  results jsonb not null default '[]'::jsonb check (jsonb_typeof(results) = 'array'),
  source_file text,
  received_at timestamptz not null default now()
);
create index unit_lab_samples_collected_idx on public.unit_lab_samples (collected_at desc);
comment on table public.unit_lab_samples is 'Lab results read from the lab system PDFs, one row per sample';

-- the Mac's key: only its SHA-256 is kept; nobody but the server reads this table
create table public.logbook_ingest_keys (
  key_sha256 text primary key check (key_sha256 ~ '^[0-9a-f]{64}$'),
  label text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

alter table public.unit_shift_logs enable row level security;
alter table public.unit_lab_samples enable row level security;
alter table public.logbook_ingest_keys enable row level security;

create policy unit_shift_logs_read on public.unit_shift_logs for select to authenticated using ((select public.app_current_role()) is not null);
create policy unit_lab_samples_read on public.unit_lab_samples for select to authenticated using ((select public.app_current_role()) is not null);

revoke all on public.unit_shift_logs, public.unit_lab_samples, public.logbook_ingest_keys from anon;
revoke insert, update, delete, truncate on public.unit_shift_logs, public.unit_lab_samples from authenticated;
revoke all on public.logbook_ingest_keys from authenticated;
grant select on public.unit_shift_logs, public.unit_lab_samples to authenticated;
grant select, insert, update on public.unit_shift_logs, public.unit_lab_samples to service_role;
grant select, update on public.logbook_ingest_keys to service_role;
