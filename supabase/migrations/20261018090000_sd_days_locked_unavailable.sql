-- Working plan (shutdown plan, day by day): a day set by hand is locked (the planner plans the rest around it), and a
-- day off can be marked Unavailable (e.g. not back yet). Unavailable is a day off for every rule (works = false).
alter table public.sd_days add column locked boolean not null default false;
alter table public.sd_days add column unavailable boolean not null default false;
alter table public.sd_days add constraint sd_days_unavailable_off check (not (unavailable and works));
comment on column public.sd_days.locked is 'Set in the working plan by hand: the planner keeps this day as it is when it plans the rest again.';
comment on column public.sd_days.unavailable is 'A day off because the person is not available (e.g. not back yet): a day off for every rule, shown apart in the working plan.';
