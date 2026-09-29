-- A fourth Field Operator level for shutdown teams: below (below average). Senior, good and new are unchanged;
-- someone rated below ranks after everyone else when a team is picked. The constraint only gains a value: no row changes.
alter table public.employees drop constraint employees_fo_level_check;
alter table public.employees add constraint employees_fo_level_check check (fo_level in ('senior', 'good', 'new', 'below'));
comment on column public.employees.fo_level is 'Level for shutdown teams, set by the Section Head: senior, good, new, or below (below average).';
