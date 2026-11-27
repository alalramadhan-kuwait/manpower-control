-- Unit log sample schedule (owner, 27 Nov 2026: "if the result is overdue the schedule, it should show them in a
-- different colour"). One row per routine test at a sample point, with the lab's own test names. The rows come from the
-- owner's sampling document and are loaded by SQL only (never in the public repo). Staff read; nobody writes from the app.
create table public.unit_sample_schedule (
  id bigint generated always as identity primary key,
  point text not null,                       -- as people say it: 'Distillate T-103'
  material text not null,                    -- the lab report's material
  equipment text,                            -- the lab report's sample point; null = any
  test text not null,                        -- as the schedule names it
  components text[] not null check (cardinality(components) between 1 and 6),   -- the lab report's test names (any of)
  frequency text not null check (frequency in ('daily', 'weekly_sun')),           -- morning shift every day / Sunday morning
  status text not null default 'active' check (status in ('active', 'retired')),
  source text,
  created_at timestamptz not null default now()
);
comment on table public.unit_sample_schedule is 'Routine lab sampling: which test at which point, daily (morning shift) or weekly (Sunday morning); results older than the last due time are overdue';
alter table public.unit_sample_schedule enable row level security;
create policy unit_sample_schedule_read on public.unit_sample_schedule for select using (public.app_is_staff());
revoke all on public.unit_sample_schedule from anon;
revoke insert, update, delete, truncate on public.unit_sample_schedule from authenticated;
