-- Stage K, part 4: in a total turnaround each Controller of a shift handles a section (e.g. TR-I, TR-II, Low Pressure).
-- sd_plans.sections: the Controller sections; a Controller's section is kept in sd_members.area; each phase says how
-- many Controllers each section needs (sd_phases.needs -> team -> "sections").
alter table public.sd_plans add column sections text[] not null default '{}';
comment on column public.sd_plans.sections is 'Total turnaround: the sections a Controller handles (e.g. TR-I, TR-II, L.P).';
comment on column public.sd_phases.needs is 'Per team id: {"controller": n, "sections": {"<section>": n}, "areas": {"<area>": n}} — people needed each day of the phase.';
