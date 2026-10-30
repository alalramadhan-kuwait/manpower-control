-- A neutralization loop kept under N2 and handed over instead of soda ash (owner, 30 Oct 2026): a third decision next
-- to required and not required; like not required, only before the loop starts.
alter table public.trk_points drop constraint trk_points_requirement_check;
alter table public.trk_points add constraint trk_points_requirement_check check (requirement = any (array['required','not_required','pending','n2']));
alter table public.trk_points drop constraint trk_points_nr_not_started;
alter table public.trk_points add constraint trk_points_nr_not_started check (requirement not in ('not_required','n2') or (kind = 'neut' and status = 'open'));
