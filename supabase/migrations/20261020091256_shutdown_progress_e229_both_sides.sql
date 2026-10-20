-- E-12-229 is neutralized on both sides by loops: the tube side in S111 (R-205 to R-201, through E-229) and the shell
-- side in S318 (charge pump P-203 to H-201). S111 now colours E-12-229 too, and both loops say which side.
update public.trk_points set items = items || array['E-12-229']
 where kind = 'neut' and ref = 'S111' and not ('E-12-229' = any(items));
update public.trk_points set detail = 'R-205 to R-201 loop, through E-12-229 tube side'
 where kind = 'neut' and ref = 'S111';
update public.trk_points set detail = 'Charge pump P-203 to H-201 passes: E-216 tube side, E-203 shell side, E-12-229 shell side'
 where kind = 'neut' and ref = 'S318';
