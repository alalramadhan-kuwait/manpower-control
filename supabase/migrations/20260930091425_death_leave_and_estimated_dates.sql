-- 1. New leave type Death Leave (DEATH): recorded when it happens, no approval step (like sick leave).
-- 2. leave_records.dates_estimated: leave whose dates are an estimate until the final notice (Escort Leave: the travel
--    date is not always known). It counts in the manpower like any leave; the app marks it and reminds until the dates
--    are confirmed. leave_set_estimated switches it (staff only; audited through the leave_records audit trigger).

insert into public.absence_types (code, label, short_code, reduces_manpower, requires_approval, is_active, sort_order)
values ('death_leave', 'Death Leave', 'DEATH', true, false, true, 25);

alter table public.leave_records add column dates_estimated boolean not null default false;
comment on column public.leave_records.dates_estimated is 'True while the dates are an estimate awaiting the final notice (e.g. Escort Leave); confirmed by turning it off.';

create or replace function public.leave_set_estimated(p_record uuid, p_estimated boolean)
returns void language plpgsql set search_path = public as $$
begin
  if not public.app_is_staff() then
    raise exception 'Only the Section Head or the Manpower Coordinator can change leave.' using errcode = 'insufficient_privilege';
  end if;
  if p_estimated is null then raise exception 'Choose Estimated or Confirmed.' using errcode = 'check_violation'; end if;
  update public.leave_records set dates_estimated = p_estimated
   where id = p_record and in_current_plan and status in ('approved', 'planned') and dates_estimated is distinct from p_estimated;
end $$;
revoke execute on function public.leave_set_estimated(uuid, boolean) from public, anon;
grant execute on function public.leave_set_estimated(uuid, boolean) to authenticated;
