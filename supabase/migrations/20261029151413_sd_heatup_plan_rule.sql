-- The heat-up plan for every start-up (owner, 29 Oct 2026): each reactor inlet from 350 to 575 °F at its own rate.
-- R-105 is set by the heater firing (25 °F/h); R-101..R-104 follow the heat wave, at Train-1's Oct-26 average rates
-- less a margin and rounded (14, 14, 14, 13 °F/h). R-104 sets the end: 17.3 h. A Shutdown rule, changed on Rules.
insert into public.app_rules (key, grp, sort, value, bounds) values
  ('sd.heatup', 'shutdown', 50, '{"r105":25,"r101":14,"r102":14,"r103":14,"r104":13,"from":350,"to":575}',
   '{"r105":{"min":1,"max":60},"r101":{"min":1,"max":60},"r102":{"min":1,"max":60},"r103":{"min":1,"max":60},"r104":{"min":1,"max":60},"from":{"min":100,"max":500},"to":{"min":300,"max":700}}')
on conflict (key) do nothing;
