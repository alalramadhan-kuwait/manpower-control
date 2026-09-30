-- A shutdown team member can be told to follow another crew's rota: the crew whose duty days (and rest days) he keeps
-- on the team. Null = his own crew. Used to spread the days off of people of the same crew.
alter table public.sd_members add column if not exists follow_crew text;
alter table public.sd_members drop constraint if exists sd_members_follow_crew_check;
alter table public.sd_members add constraint sd_members_follow_crew_check check (follow_crew is null or follow_crew in ('A', 'B', 'C', 'D'));
comment on column public.sd_members.follow_crew is 'Crew (A-D) whose rota the member follows on the team instead of his own; null = his own crew.';
