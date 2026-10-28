-- Five-year shutdown plan FY 2027/28–2031/32 (memo O-TS(MAB)-OP-26-0347, 26 Oct 2026; owner, 28 Oct 2026: "memo dates
-- are correct, treat Sep 2027 as whole-unit shutdown, don't change the current"). Unit 12 = ARDS-12 I (Train-1) and
-- ARDS-12 II (Train-2). Each future shutdown is a Calendar shutdown event, marked tentative with the memo as its source,
-- so the unit status, the crew minimums and the plans see it. The current Train-2 shutdown is left as it is.
alter table public.unit_events add column if not exists tentative boolean not null default false;
alter table public.unit_events add column if not exists source_ref text;

insert into public.unit_events (category, title, unit, unit_codes, start_date, end_date, note, tentative, source_ref) values
  ('shutdown', 'RMP MRTA · whole unit', 'Whole unit', array['fractionator','train_1','train_2'], '2027-09-01', '2027-10-08',
   'RMP utilities down 1–20 Sep 2027. Train-1 M&I with cat change, Train-2 M&I only (38 days). Whole unit down (owner).', true, 'O-TS(MAB)-OP-26-0347'),
  ('shutdown', 'Train-2 SD · Cat change', 'Train-2', array['train_2'], '2028-02-01', '2028-03-01', 'Cat change · 30 days', true, 'O-TS(MAB)-OP-26-0347'),
  ('shutdown', 'Train-1 SD · Cat change', 'Train-1', array['train_1'], '2029-01-01', '2029-01-30', 'Cat change · 30 days', true, 'O-TS(MAB)-OP-26-0347'),
  ('shutdown', 'Train-2 SD · Cat change', 'Train-2', array['train_2'], '2029-05-01', '2029-05-30', 'Cat change · 30 days', true, 'O-TS(MAB)-OP-26-0347'),
  ('shutdown', 'Train-1 SD · Cat change', 'Train-1', array['train_1'], '2030-05-01', '2030-05-30', 'Cat change · 30 days', true, 'O-TS(MAB)-OP-26-0347'),
  ('shutdown', 'Train-2 SD · Cat change', 'Train-2', array['train_2'], '2030-09-01', '2030-09-30', 'Cat change · 30 days', true, 'O-TS(MAB)-OP-26-0347'),
  ('shutdown', 'Train-1 SD · Cat change', 'Train-1', array['train_1'], '2031-09-01', '2031-09-30', 'Cat change · 30 days', true, 'O-TS(MAB)-OP-26-0347'),
  ('shutdown', 'Train-2 SD · Cat change', 'Train-2', array['train_2'], '2031-12-01', '2031-12-30', 'Cat change · 30 days', true, 'O-TS(MAB)-OP-26-0347');
