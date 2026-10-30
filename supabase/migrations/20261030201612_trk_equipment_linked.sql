-- Items with no blind between them (owner, 30 Oct 2026: "E-204 and 205 are linked, they have the same hydrotest"):
-- one page together, and a test recorded on one is recorded on the others. Each keeps its own steps and progress.
alter table public.trk_equipment add column if not exists linked text;
comment on column public.trk_equipment.linked is 'Items tested together (no blind between them): the same value on each; their test steps move together';
update public.trk_equipment set linked = 'E-204 + E-205' where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and tag in ('E-12-204','E-12-205') and linked is null;
