-- The cut-in conditions are on the reactor inlet temperatures (owner, 29 Oct 2026); a reading's beds are now each
-- reactor's hottest bed (optional, shows a reaction). The 9:51 PM reading's coldest beds move into its note, and the
-- 5:37 AM panel reading is recorded.
update public.sd_wave_reading set beds = null,
  note = 'DCS reactors bed temperature page, 9:51 PM; coldest beds: R-105 398.1, R-101 486, R-102 460, R-103 422, R-104 395'
  where step_id = 'fc1ca5e8-ad2f-4884-8b66-abba72fabd70' and at = '2026-10-28 18:51:00+00' and active;
insert into public.sd_wave_reading (step_id, at, pts, beds, note) values
  ('fc1ca5e8-ad2f-4884-8b66-abba72fabd70', '2026-10-29 02:37:00+00',
   '{"r105_in": 620, "r105_out": 611.1, "r101_in": 576, "r102_in": 577, "r103_in": 574, "r104_in": 561, "r104_out": 551.5}'::jsonb,
   '{"r105": 627.6, "r101": 577, "r102": 580, "r103": 574, "r104": 560}'::jsonb,
   'DCS reactors bed temperature page, 5:37 AM; beds: hottest of each reactor');
update public.sd_startup_step set cutin = jsonb_set(cutin, '{ref}', '"Process instruction 28 Oct 2026 · reactor inlets"')
  where id = 'fc1ca5e8-ad2f-4884-8b66-abba72fabd70';
