-- Neutralization loops checked against the P&ID lineup (process paths, Train-2 by rule):
--   S214 V-206 vapour → E-202 tubes → E-203 tubes → E-204 tubes → V-207 → E-205 tubes (P-12-2049/2050/2051/2054/2055):
--        the tube sides of E-204 and E-205 and the E-202 → E-203 line belong to it.
--   S215 C-201 discharge → E-205 shell → E-204 shell → E-202 shell (P-12-2086/2056/2053, recycle gas, SEG-06 at E-202
--        S/S O/L): the shell sides of E-205 and E-204, not the E-202 → E-203 line (that is the tube side, S214).
--   S216 E-205 tubes → EA-201A-D → E-207 tubes → V-208 (P-12-2057/2059/2065): E-207 tube side too.
--   S320 V-213 vapour → E-210A/B tubes → E-211 tubes / shell → V-209 (P-12-2346/2350/2099, bypass P-12-2401): E-211 too.
-- Each loop's detail names the path and the sides.
update public.trk_points p set items = v.items, detail = v.detail
  from (values
    ('S214', array['V-12-206','V-12-207','E-202 to E-203','E-12-204','E-12-205'], 'V-206 vapour → E-202 T/S → E-203 T/S → E-204 T/S → V-207 → E-205 T/S (P-12-2049, 2050, 2051, 2054, 2055)'),
    ('S215', array['E-12-205','E-12-204'], 'C-201 discharge → E-205 S/S → E-204 S/S → E-202 S/S, recycle gas (P-12-2086, 2056, 2053), SEG-06 at E-202 S/S O/L'),
    ('S216', array['E-12-205','E-12-207','V-12-208'], 'E-205 T/S → EA-201A-D → E-207 T/S → V-208 (P-12-2057, 2059, 2065)'),
    ('S320', array['V-12-213','E-12-210A/B','E-12-211','V-12-209'], 'V-213 vapour → E-210A/B T/S → E-211 → V-209 (P-12-2346, 2350, 2099, bypass P-12-2401)')
  ) v(ref, items, detail)
 where p.kind = 'neut' and p.ref = v.ref;
