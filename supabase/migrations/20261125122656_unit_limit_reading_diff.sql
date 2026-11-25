-- A limit can judge the difference of two readings per train (a reactor's outlet minus its inlet temperature).
-- reading_key is the minuend (a key or /pattern/); reading_key2 the subtrahend, or null to use the same key with
-- OUTLET replaced by INLET (one difference per matching reactor).
alter table public.unit_limit_matches add column reading_key2 text;
alter table public.unit_limit_matches drop constraint unit_limit_matches_kind_check;
alter table public.unit_limit_matches add constraint unit_limit_matches_kind_check check (kind in ('reading', 'reading_sum', 'reading_diff', 'lab'));
alter table public.unit_limit_matches drop constraint unit_limit_matches_check;
alter table public.unit_limit_matches add constraint unit_limit_matches_check
  check ((kind in ('reading', 'reading_sum', 'reading_diff') and reading_key is not null) or (kind = 'lab' and material is not null and component is not null));
comment on column public.unit_limit_matches.reading_key2 is 'reading_diff: the subtracted reading (key or /pattern/); null = reading_key with OUTLET replaced by INLET';
