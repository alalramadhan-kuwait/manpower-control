-- Live refresh: the app reloads a page when manpower_version moves. The shutdown exceptions and the Oracle / HR figures
-- (overtime taken, sick leave) now bump it too, like the plan, leave and assignment tables already do.
create trigger sd_exceptions_mp_bump after insert or update or delete on public.sd_exceptions for each statement execute function public.manpower_bump();
create trigger overtime_entries_mp_bump after insert or update or delete on public.overtime_entries for each statement execute function public.manpower_bump();
create trigger sick_checks_mp_bump after insert or update or delete on public.sick_checks for each statement execute function public.manpower_bump();
-- Train-2 (Section Head, 17 Oct 2026): 3 on / 1 off to the end of the shutdown (16 Nov), not to the day before.
update public.sd_plans set cycle_until = end_date where id = 'f7c739f0-881a-4633-8886-6758f6604469' and approval_status = 'draft' and cycle_until < end_date;
