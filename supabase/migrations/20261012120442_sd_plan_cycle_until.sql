-- Train shutdown: work the plan's days-on / days-off cycle (e.g. 3 on / 1 off) up to this date, then follow the own crew's days.
alter table public.sd_plans add column if not exists cycle_until date;
comment on column public.sd_plans.cycle_until is 'Train shutdown: days on / days off cycle up to and including this date, own crew''s duty days after it (null: own crew throughout).';
