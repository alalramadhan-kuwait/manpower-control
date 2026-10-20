-- IAT details from the daily tracking sheet, for the IATs tab: the finding (observations), the recommendation, line class,
-- material, the inspection checks (prefabrication, excavation, LPT, X-ray, stress relief, hardness, hydro / service test:
-- REQ, IF REQ or the sheet's value) and the painting IAT (WO, reference, status), and who acts on it.
alter table public.trk_iat add column if not exists finding text;
alter table public.trk_iat add column if not exists recommendation text;
alter table public.trk_iat add column if not exists line_class text;
alter table public.trk_iat add column if not exists material text;
alter table public.trk_iat add column if not exists checks jsonb not null default '{}';
alter table public.trk_iat add column if not exists painting jsonb not null default '{}';
alter table public.trk_iat add column if not exists action_by text;
