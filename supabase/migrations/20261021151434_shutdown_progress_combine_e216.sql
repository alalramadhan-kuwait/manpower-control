-- Items worked as one (twin exchangers): shown as one row, a step started or finished on all of them; each keeps its
-- own bar-chart lines and times. E-12-216A and E-12-216B (Section Head, 21 Oct).
alter table public.trk_equipment add column if not exists combine text;
update public.trk_equipment set combine = 'E-12-216A/B' where tag in ('E-12-216A', 'E-12-216B');
