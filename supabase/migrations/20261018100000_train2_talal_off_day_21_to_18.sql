-- Train-2 (Section Head, 18 Oct 2026): Talal Alenezi (Day team, Good FO) has his day off on 18 Oct instead of 21 Oct.
-- Checked as the working plan checks a change: Day team on 18 Oct keeps Controller 1 · Experienced 1 · Exp/Good 2
-- (Yaser; Renu; Renu + Shailish); 19–24 Oct is 6 duty days in a row (the limit), off 25 Oct; October overtime unchanged.
-- Both days locked (set by hand: the planner keeps them).
update public.sd_days set works = false, hours = null, locked = true where member_id = 'bb40e77d-927b-4f01-9385-5bb577e3e600' and work_date = '2026-10-18';
update public.sd_days set works = true, hours = 12, locked = true where member_id = 'bb40e77d-927b-4f01-9385-5bb577e3e600' and work_date = '2026-10-21';
