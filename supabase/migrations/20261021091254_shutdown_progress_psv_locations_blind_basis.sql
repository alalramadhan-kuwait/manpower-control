-- PSV locations from the Train-1 P&IDs (Train-2 = Train-1 + 400 for instruments, + 100 for equipment), all trackers.
update public.trk_equipment e set description = v.d from (values
  ('12-PSV-0519', 'PSV on V-12-202 vent header · 95 psig to BD-12-2004 (Train-1 PSV-119, sheet 1-R-12-0-104)'),
  ('12-PSV-0537', 'PSV on H-12-201 water preheat coil outlet · 2500 psig to V-12-205 (Train-1 PSV-137, sheet 1-R-12-0-106)'),
  ('12-PSV-0601', 'PSV on P-12-203 suction · 500 psig to the min-flow return to V-12-201 (Train-1 PSV-201, sheet 1-R-12-0-103)'),
  ('12-PSV-0643', 'Spare PSV on V-12-209 (duty PSV-2142) · 350 psig to BD-12-2014 (Train-1 PSV-243, sheet 1-R-12-0-119)'),
  ('12-PSV-0719', 'PSV on the C-12-201 suction line from V-12-212 · 1850 psig to BD-12-2012 (Train-1 PSV-319, sheet 1-R-12-0-117)'),
  ('12-PSV-1322', 'PSV on C-12-201 P1A (compressor vendor package, not on the process P&IDs)'),
  ('12-PSV-1339', 'PSV on C-12-201 E3 (compressor vendor package, not on the process P&IDs)'),
  ('12-PSV-1403', 'P-12-203 lube-oil main pump discharge PSV to the oil tank (Train-1 PSV-1003)'),
  ('12-PSV-1404', 'P-12-203 lube-oil auxiliary pump discharge PSV to the oil tank (Train-1 PSV-1004)')) v(tag, d)
 where e.tag = v.tag;

-- Train-1 blind counts accepted by the Section Head as the Train-2 basis (the trains are identical): verified.
update public.trk_measure set ref_verified = true,
       ref_source = replace(ref_source, 'reference only: not checked against the Train-2 blind list', 'accepted by the Section Head as the Train-2 basis (trains identical), 21 Oct 2026')
 where ref_source like 'Train-1 blind list%' and not ref_verified;
