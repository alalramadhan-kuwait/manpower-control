-- Train-2 exchangers (E-204, E-205, E-211, E-216A/B, E-229): one set of step names (owner, 30 Oct 2026: unify the
-- steps, group the exchangers). Renames only: the P6 text is kept in p6_activity by the rename guard (the test medium
-- and the full wording stay there); no dates, times or order change; the merged P6 parent lines (not tracked) are left.
update public.trk_activities a set activity = m.std from (values
  ('Neutralize with 2% soda ash.','Neutralize (2% soda ash)'),('Neutralize with 2% soda ash','Neutralize (2% soda ash)'),
  ('Open channel','Open channel / covers'),('Open covers','Open channel / covers'),
  ('Pull tube bundle','Pull out bundle / shell'),('Pull out tube bundle','Pull out bundle / shell'),('Pull out shell','Pull out bundle / shell'),
  ('H-Blast Tube bundle using 2% soda ash','Hydroblast tube bundle'),('H-Blast tube bundle using process water containing chloride < 50 ppm','Hydroblast tube bundle'),
  ('H/blast clean the shell & components using 2% soda ash solution.','Clean shell & components'),('Clean components','Clean shell & components'),('Clean shell and components thoroughly to prepare for NDT','Clean shell & components'),
  ('Buff clean the components & shell weld joints internally & Measure','Buff weld joints & measure'),
  ('Carry out Eddy current /IRIS inspection','Eddy current / IRIS inspection'),('Extensive NDT on the shell and nozzles','NDT of shell & nozzles'),
  ('Offer for Inspection','Offer for inspection'),
  ('Hydrotest shell side at differential pressure of 866 psig','Shell side hydrotest (differential) · 866 psig'),('Hydrotest shell side at differential pressure of 1900 psig','Shell side hydrotest (differential) · 1900 psig'),
  ('Simultaneous hydro test - shell at 3300 psig & tube at 2850 psig','Hydrotest shell & tube · 3300 / 2850 psig'),('Simultaneous hydro test - shell at 4805 psig & tube at 3300 psig','Hydrotest shell & tube · 4805 / 3300 psig'),
  ('Hydrotest tube side at 4500 psig and shell side 383 psig using process','Hydrotest shell & tube · 383 / 4500 psig'),('Hydrotest Shell Side & Tube Side at 620 psig with process water containing','Hydrotest shell & tube · 620 / 620 psig'),
  ('Install the tube bundle, channel and covers back','Box-up (bundle, channel, covers)')) m(old, std)
where a.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and a.equipment_key in ('E-12-204','E-12-205','E-12-211','E-12-216A','E-12-216B','E-12-229') and a.tracked and a.activity = m.old;
