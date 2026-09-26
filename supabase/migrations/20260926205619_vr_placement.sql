-- VR placement: a Vacation Relief Controller is a role, not a shift. Each VR is placed in a crew from a date until
-- changed (crew_movements kind 'placement', no last day) and works that crew's rota: the crew's Controller when its
-- own Controller is away, an extra Controller when present. Moving a VR ends the current placement the day before.
-- 1. crew_movements: kind 'placement' (VR only, from_crew = previous placement crew or null); no overlapping
--    active placements per person.
-- 2. vr_place(employee, crew, start, reason): place / move a VR (ends the running placement; refuses when a later
--    placement is already recorded). crew_move_end / crew_move_cancel accept placements too.
-- 3. The existing dated VR covers become placements (stays in the crew until moved) and the covers are cancelled
--    with that reason (kept as history): 18008 B from 2 Sep, D from 11 Nov, A from 17 Nov, C from 1 Dec;
--    19766 D from 8 Sep, A from 8 Oct.

alter table public.crew_movements drop constraint crew_movements_kind_check;
alter table public.crew_movements add constraint crew_movements_kind_check check (kind in ('temporary', 'permanent', 'placement'));
alter table public.crew_movements add constraint cm_placement_to_crew check (kind <> 'placement' or to_crew in ('A', 'B', 'C', 'D'));
alter table public.crew_movements add constraint cm_one_placement_at_a_time exclude using gist
  (employee_id with =, daterange(start_date, end_date, '[]') with &&) where (status = 'active' and kind = 'placement');

create or replace function public.vr_place(p_employee uuid, p_crew text, p_start date, p_reason text)
returns uuid language plpgsql set search_path = public as $$
declare
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_pos text;
  v_cur public.crew_movements;
  v_id uuid;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can place a VR Controller.' using errcode = 'insufficient_privilege'; end if;
  if p_crew not in ('A', 'B', 'C', 'D') then raise exception 'Choose the crew.' using errcode = 'check_violation'; end if;
  if p_start is null then raise exception 'Enter the first day.' using errcode = 'check_violation'; end if;
  select p.code into v_pos from public.employee_role_assignments ra join public.positions p on p.id = ra.position_id
   where ra.employee_id = p_employee and ra.effective_from <= p_start and (ra.effective_to is null or ra.effective_to >= p_start)
   order by ra.effective_from desc limit 1;
  if v_pos is distinct from 'vr_controller' then raise exception 'Only a VR Controller is placed in a crew.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.crew_movements where employee_id = p_employee and kind = 'placement' and status = 'active' and start_date >= p_start) then
    raise exception 'A placement from this day or later is already recorded. Cancel it first.' using errcode = 'check_violation';
  end if;
  select * into v_cur from public.crew_movements
   where employee_id = p_employee and kind = 'placement' and status = 'active' and start_date < p_start and (end_date is null or end_date >= p_start)
   for update;
  if v_cur.id is not null then
    if v_cur.to_crew = p_crew then raise exception 'Already in % Shift on %.', p_crew, to_char(p_start, 'FMDD Mon YYYY') using errcode = 'check_violation'; end if;
    update public.crew_movements set end_date = p_start - 1 where id = v_cur.id;
  end if;
  insert into public.crew_movements (employee_id, kind, from_crew, to_crew, start_date, end_date, reason)
  values (p_employee, 'placement', v_cur.to_crew, p_crew, p_start, null, coalesce(v_reason, 'VR placement'))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.vr_place(uuid, text, date, text) from public, anon;
grant execute on function public.vr_place(uuid, text, date, text) to authenticated;

create or replace function public.crew_move_end(p_id uuid, p_end date, p_note text)
returns void language plpgsql set search_path = public as $$
declare m public.crew_movements;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can change shift movements.' using errcode = 'insufficient_privilege'; end if;
  select * into m from public.crew_movements where id = p_id for update;
  if m.id is null then raise exception 'Movement not found.' using errcode = 'no_data_found'; end if;
  if m.kind not in ('temporary', 'placement') or m.status <> 'active' then raise exception 'Only an active temporary cover or VR placement can be ended.' using errcode = 'check_violation'; end if;
  if p_end is null or p_end < m.start_date then raise exception 'The last day cannot be before the first day (%).', to_char(m.start_date, 'FMDD Mon YYYY') using errcode = 'check_violation'; end if;
  if m.end_date is not null and p_end >= m.end_date then raise exception 'Choose a day before the current last day (%).', to_char(m.end_date, 'FMDD Mon YYYY') using errcode = 'check_violation'; end if;
  update public.crew_movements set end_date = p_end, reason = concat_ws(' | ', reason, 'Ended ' || to_char(p_end, 'FMDD Mon YYYY') || coalesce(': ' || nullif(trim(p_note), ''), '')) where id = p_id;
end $$;

create or replace function public.crew_move_cancel(p_id uuid, p_reason text)
returns void language plpgsql set search_path = public as $$
declare m public.crew_movements;
begin
  if not public.app_is_staff() then raise exception 'Only the Section Head or the Manpower Coordinator can change shift movements.' using errcode = 'insufficient_privilege'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Give the reason for cancelling.' using errcode = 'check_violation'; end if;
  select * into m from public.crew_movements where id = p_id for update;
  if m.id is null then raise exception 'Movement not found.' using errcode = 'no_data_found'; end if;
  if m.kind not in ('temporary', 'placement') or m.status <> 'active' then raise exception 'Only an active temporary cover or VR placement can be cancelled. A permanent move is corrected on the profile (Correct role / crew).' using errcode = 'check_violation'; end if;
  update public.crew_movements set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_id;
end $$;

-- 3. existing VR covers → placements
do $$
declare
  v_ash uuid := (select id from public.employees where employee_number = '18008');
  v_sae uuid := (select id from public.employees where employee_number = '19766');
  r record;
begin
  for r in select * from (values
      (v_ash, null::text, 'B', date '2026-09-02', date '2026-11-10'),
      (v_ash, 'B', 'D', date '2026-11-11', date '2026-11-16'),
      (v_ash, 'D', 'A', date '2026-11-17', date '2026-11-30'),
      (v_ash, 'A', 'C', date '2026-12-01', null::date),
      (v_sae, null, 'D', date '2026-09-08', date '2026-10-07'),
      (v_sae, 'D', 'A', date '2026-10-08', null)) as t(emp, fr, tc, s, e)
  loop
    insert into public.crew_movements (employee_id, kind, from_crew, to_crew, start_date, end_date, reason)
    values (r.emp, 'placement', r.fr, r.tc, r.s, r.e, 'VR placement (from the recorded cover): stays in the crew until moved');
  end loop;
  update public.controller_assignments set status = 'cancelled', cancel_reason = 'Replaced by VR placement: the VR stays in the crew until moved'
   where status = 'active' and kind = 'shift_cover' and employee_id in (v_ash, v_sae);
end $$;
