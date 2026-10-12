-- Release step of the final specification (applied with the app that uses it). The app's routine paths now go through
-- the server check (edge function request-gate → request_header_submit_checked / request_header_decide_checked):
--  1. the unchecked request paths and the direct plan primitives are no longer callable by signed-in users (they stay
--     callable by the functions that use them, which run as their owner);
--  2. changing an approved movement or Controller assignment (end early / cancel) is the Section Head's only;
--  3. the shutdown "follow shift" instruction gets its own narrow functions (only that kind of movement);
--  4. a Field Operator's level (Senior / Good / New / Below) is set by the Section Head only.

create or replace function public.movement_amend(p_id uuid, p_kind text, p_date date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_section_head() then
    raise exception 'Only the Section Head changes an approved movement. Send the change as a request in Requests → Entry.' using errcode = 'insufficient_privilege';
  end if;
  if p_kind = 'end' then perform public.crew_move_end(p_id, p_date, p_note);
  elsif p_kind = 'cancel' then perform public.crew_move_cancel(p_id, p_note);
  else raise exception 'Unknown change %.', p_kind using errcode = 'check_violation'; end if;
end $$;

create or replace function public.assignment_amend(p_id uuid, p_kind text, p_date date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_section_head() then
    raise exception 'Only the Section Head changes an approved Controller assignment. Send the change as a request in Requests → Entry.' using errcode = 'insufficient_privilege';
  end if;
  if p_kind = 'end' then
    update public.controller_assignments set end_date = p_date, note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), note) where id = p_id;
  elsif p_kind = 'cancel' then
    if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'Give the reason.' using errcode = 'check_violation'; end if;
    update public.controller_assignments set status = 'cancelled', cancel_reason = btrim(p_note) where id = p_id;
  else raise exception 'Unknown change %.', p_kind using errcode = 'check_violation'; end if;
  if not found then raise exception 'Assignment not found.' using errcode = 'no_data_found'; end if;
end $$;

-- the shutdown instruction "follow crew X's shift before joining the team": a temporary movement ending the day before
-- the member joins, marked as a shutdown instruction (shutdown planning, both roles)
create or replace function public.sd_follow_move(p_member uuid, p_to text, p_start date, p_end date, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.sd_members;
begin
  if not public.app_is_staff() then raise exception 'Staff only.' using errcode = 'insufficient_privilege'; end if;
  select * into m from public.sd_members where id = p_member and status = 'active';
  if not found then raise exception 'Team member not found.' using errcode = 'no_data_found'; end if;
  if p_end is null or p_end >= m.start_date then raise exception 'The instruction ends before the member joins the team.' using errcode = 'check_violation'; end if;
  if coalesce(p_reason, '') not like 'Shutdown instruction%' then raise exception 'Only a shutdown instruction is recorded here.' using errcode = 'check_violation'; end if;
  return public.crew_move(m.employee_id, 'temporary', p_to, p_start, p_end, p_reason);
end $$;

create or replace function public.sd_follow_cancel(p_movement uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_staff() then raise exception 'Staff only.' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from public.crew_movements where id = p_movement and coalesce(reason, '') like 'Shutdown instruction%') then
    raise exception 'Only a shutdown instruction is removed here.' using errcode = 'check_violation';
  end if;
  perform public.crew_move_cancel(p_movement, p_reason);
end $$;

create or replace function public.employees_fo_level_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if new.fo_level is distinct from old.fo_level and auth.uid() is not null and not public.app_is_section_head() then
    raise exception 'Only the Section Head sets a Field Operator''s level.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger employees_fo_level_guard before update on public.employees for each row execute function public.employees_fo_level_guard();
revoke execute on function public.employees_fo_level_guard() from public, anon, authenticated;

revoke execute on function public.request_header_decide(uuid, boolean, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.request_header_submit(text, uuid, integer, text, text, jsonb, jsonb, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.approval_submit(text, uuid, date, date, text, jsonb) from public, anon, authenticated;
revoke execute on function public.approval_decide(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.change_request_decide(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.request_decide(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.leave_save(uuid, uuid, text, date, date, text) from public, anon, authenticated;
revoke execute on function public.leave_cancel(uuid, text) from public, anon, authenticated;
revoke execute on function public.crew_move(uuid, text, text, date, date, text) from public, anon, authenticated;
revoke execute on function public.crew_move_end(uuid, date, text) from public, anon, authenticated;
revoke execute on function public.crew_move_cancel(uuid, text) from public, anon, authenticated;
revoke execute on function public.vr_place(uuid, text, date, text) from public, anon, authenticated;
revoke execute on function public.absence_case_open(uuid, text, date, date, date, date, text) from public, anon, authenticated;
revoke execute on function public.absence_case_version(uuid, text, date, date, date, date, text) from public, anon, authenticated;
revoke execute on function public.server_check_use(uuid, uuid, uuid, text, date, date) from authenticated;
revoke update on public.controller_assignments from authenticated;
revoke insert on public.controller_assignments from authenticated;
revoke insert, update on public.crew_movements from authenticated;
revoke execute on function public.movement_amend(uuid, text, date, text) from public, anon;
revoke execute on function public.assignment_amend(uuid, text, date, text) from public, anon;
revoke execute on function public.sd_follow_move(uuid, text, date, date, text) from public, anon;
revoke execute on function public.sd_follow_cancel(uuid, text) from public, anon;
grant execute on function public.movement_amend(uuid, text, date, text) to authenticated;
grant execute on function public.assignment_amend(uuid, text, date, text) to authenticated;
grant execute on function public.sd_follow_move(uuid, text, date, date, text) to authenticated;
grant execute on function public.sd_follow_cancel(uuid, text) to authenticated;
grant execute on function public.request_header_submit_checked(uuid, text, uuid, integer, text, text, jsonb, text) to authenticated;
grant execute on function public.request_header_decide_checked(uuid, uuid, boolean, text, jsonb) to authenticated;
