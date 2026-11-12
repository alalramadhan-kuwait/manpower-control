-- Unit-12 Train-2 start-up plan (owner, 12 Nov 2026: "This is start i want to track startup"): the 17 steps and their
-- planned hours (168 h) from the start-up dashboard workbook, on the Train-2 SD (18 Oct – 16 Nov 2026). The workbook is
-- headed "Tr-1" with Train-1 tags; the owner confirmed it is Train-2, so the tags read as Train-2 (R-205, C-201, E-216).
-- Pull vacuum started 12 Nov 10:00 (the workbook's actual start); its 18:00 finish was still ahead, so it is running.
insert into public.sd_startup_step (event_id, seq, title, std_hours, remark) values
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df',  10, 'Pull vacuum', 8, 'Nitrogen hose got ruptured'),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df',  20, 'Deblinding (including segregation) · commission flare header', 8, 'OCR tensioning delay'),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df',  30, 'Pressurize and test with N2 @ 20–25 psig', 4, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df',  40, 'Pressurize and test with H2 @ 475 psig (100 psi/h)', 6, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df',  50, 'Commission recycle gas compressor C-201 to operating speed', 6, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df',  60, 'Heat up R-205 inlets to 350 °F by commissioning heaters', 12, 'Workbook dashboard says 360 °F'),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df',  70, 'Reach min skin 125 °F · system pressure 525 psig', 8, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df',  80, 'Reach min skin 130 °F · system pressure 750 psig', 8, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df',  90, 'Reach min skin 140 °F · system pressure 800 psig', 8, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df', 100, 'Reach min skin 150 °F · system pressure 1000 psig', 6, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df', 110, 'Reach min skin 180 °F · system pressure 1600 psig', 28, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df', 120, 'Commission feed pump & stabilize levels', 6, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df', 130, 'Flushing oil cut-in & fill reactors', 2, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df', 140, 'Catalyst pre-wetting (one reactors'' volume) · E-216 commissioning', 8, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df', 150, 'First stage catalyst sulfiding (50% DMDS injected)', 24, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df', 160, 'Second stage catalyst sulfiding', 24, null),
  ('2e94a02b-e34b-4e8f-9ae1-5a80294719df', 170, 'Black oil cut-in', 2, null);
update public.sd_startup_step set status = 'running', started_at = '2026-11-12 10:00:00+03'
 where event_id = '2e94a02b-e34b-4e8f-9ae1-5a80294719df' and seq = 10;
