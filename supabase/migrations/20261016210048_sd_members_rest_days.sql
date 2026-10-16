-- Shutdown members' recorded rest days off their crew around the team dates (rest rules when joining / returning).
-- On these days the member is off his crew; the plan check verifies the crew keeps its minimum (with a recorded cover).
alter table public.sd_members add column if not exists rest_days date[] not null default '{}';
comment on column public.sd_members.rest_days is 'Rest days off his own crew just before joining or after leaving the shutdown team (rest rules). On these days he is off his crew; the crew''s minimum is checked and its cover recorded in controller_assignments.';
