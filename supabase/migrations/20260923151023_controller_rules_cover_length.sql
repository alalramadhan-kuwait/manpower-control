-- Section Head correction (Stage H review):
-- the 2-month maximum applies to Morning Controller rotation only. Ordinary shift cover lasts for the actual
-- leave / coverage period, unless a maximum is configured in controller_rules (off by default).
alter table public.controller_assignments drop constraint ca_max_two_months;
alter table public.controller_assignments add constraint ca_morning_rotation_max_two_months
  check (kind <> 'morning_rotation' or end_date < (start_date + interval '2 months')::date);

create table public.controller_rules (
  id                    int primary key default 1 check (id = 1),
  shift_cover_max_days  int check (shift_cover_max_days is null or shift_cover_max_days > 0),
  updated_by            uuid default auth.uid(),
  updated_at            timestamptz not null default now()
);
insert into public.controller_rules (id, shift_cover_max_days) values (1, null);
alter table public.controller_rules enable row level security;
create policy cr_staff_read on public.controller_rules for select to authenticated using (public.app_is_staff());
create policy cr_head_update on public.controller_rules for update to authenticated using (public.app_is_section_head()) with check (public.app_is_section_head());
create trigger controller_rules_audit after insert or update on public.controller_rules for each row execute function public.audit_row_change();

create or replace function public.controller_assignment_check()
returns trigger language plpgsql set search_path = public as $$
declare
  v_grade int; v_pos text; v_crew text; v_max int;
begin
  if tg_op = 'UPDATE' and old.status = 'cancelled' then
    raise exception 'A cancelled assignment is kept as history and cannot be changed.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' or (new.status = 'active' and (new.employee_id, new.kind, new.crew_code) is distinct from (old.employee_id, old.kind, old.crew_code)) then
    select e.grade into v_grade from public.employees e where e.id = new.employee_id;
    select p.code, c.code into v_pos, v_crew
      from public.employee_role_assignments ra
      join public.positions p on p.id = ra.position_id
      left join public.crews c on c.id = ra.home_crew_id
     where ra.employee_id = new.employee_id and ra.effective_to is null
     order by ra.effective_from desc limit 1;
    if v_pos is null or v_pos not in ('controller', 'vr_controller', 'morning_controller') then
      raise exception 'Only a Controller can be assigned.' using errcode = 'check_violation';
    end if;
    if v_grade is null or v_grade < 15 then
      raise exception 'Controller assignments need Grade 15 or higher.' using errcode = 'check_violation';
    end if;
    if new.kind = 'shift_cover' and v_crew = new.crew_code then
      raise exception 'A Controller cannot cover their own crew.' using errcode = 'check_violation';
    end if;
  end if;
  if new.status = 'active' and new.kind = 'shift_cover' then
    select shift_cover_max_days into v_max from public.controller_rules where id = 1;
    if v_max is not null and (new.end_date - new.start_date + 1) > v_max then
      raise exception 'A shift cover can last at most % days (Controller rules).', v_max using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'cancelled' then
    new.cancelled_at := now(); new.cancelled_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.controller_assignment_check() from public, anon, authenticated;
