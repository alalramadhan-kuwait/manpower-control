-- E-12-204 and E-12-205 are neutralized inside the loops (S214 tube sides, S215 shell sides, S216 E-205 tube side), not on their own
update public.trk_points set removed = true, items = '{}', before_ho = false
 where kind = 'neut' and ref in ('E-12-204', 'E-12-205') and step_id is null;
