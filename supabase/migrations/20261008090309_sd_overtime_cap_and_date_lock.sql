-- Shutdown overtime cap: 72 h per person per calendar month (Section Head, 8 Oct 2026), the default for new plans and
-- for the shutdowns still to come (finished shutdowns keep the cap they were planned with).
-- Date lock: a shutdown with people on it cannot have its first or last day changed on its own (their days, hours and
-- shift instructions would stay on the old dates). Moving a whole shutdown comes with the shutdown package.
alter table public.sd_plans alter column max_overtime set default 72;
update public.sd_plans set max_overtime = 72 where status = 'active' and end_date >= current_date and max_overtime <> 72;

create or replace function public.sd_plans_dates_locked() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.start_date, new.end_date) is distinct from (old.start_date, old.end_date)
     and exists (select 1 from public.sd_members m where m.plan_id = old.id and m.status = 'active') then
    raise exception 'This shutdown has people on it: changing its dates alone would leave their days, hours and shift instructions on the old dates. Moving a shutdown with its people comes with the shutdown package; until then keep the dates (or take the people off first).'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger sd_plans_dates_locked before update of start_date, end_date on public.sd_plans for each row execute function public.sd_plans_dates_locked();
