-- Unit-12 Train-1 start-up plan (owner, 28 Oct 2026): the 8 start-up steps and their standard hours (60 h in all) on
-- the Train-1 Sulfur line SD (9–24 Oct 2026). The remarks are the plan's own; no actual time is entered here (the
-- owner records the starts and finishes on the shutdown page).
insert into public.sd_startup_step (event_id, seq, title, std_hours, remark) values
  ('1dc76213-48a0-4999-bc66-30540beeaa97', 10, 'Pressurization of HP loop with Hydrogen up to 475 psig', 7, 'Done on 25 October 2026 (plan)'),
  ('1dc76213-48a0-4999-bc66-30540beeaa97', 20, 'C-12-101 start-up and normalization of flow', 3, null),
  ('1dc76213-48a0-4999-bc66-30540beeaa97', 30, 'Increasing heater outlet temp to 350 °F @ 25 °F/h', 8, 'Considering the current bed temperature as 190'),
  ('1dc76213-48a0-4999-bc66-30540beeaa97', 40, 'Increasing pressure to 1000 psig @ 100 psig/h as per MPT', 5, 'Considering the MPTs are achieved'),
  ('1dc76213-48a0-4999-bc66-30540beeaa97', 50, 'Increasing pressure to 1600 psig @ 150 psig/h as per MPT', 4, null),
  ('1dc76213-48a0-4999-bc66-30540beeaa97', 60, 'Feed pump commissioning and filling reactors', 6, 'As per plan 24 hours (with reactors heat-up)'),
  ('1dc76213-48a0-4999-bc66-30540beeaa97', 70, 'Reactors heat up to 575 °F', 9, 'As per plan 24 hours (with feed pump commissioning)'),
  ('1dc76213-48a0-4999-bc66-30540beeaa97', 80, 'Black oil cut-in: completely replacing diesel with black oil up to 42 kbpd as per table', 18, 'As per plan 24 hours');
