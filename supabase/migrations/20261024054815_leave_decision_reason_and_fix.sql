-- The Section Head's other decisions on a planned PV: reject with a short reason, or send it to the Manpower
-- Coordinator to fix the dates (with a note). The Coordinator gives new dates through a PV reschedule, which comes
-- back to the Section Head; the note stays until the leave is replaced or the Section Head decides.
alter table public.leave_records
  add column if not exists declined_reason text,
  add column if not exists fix_note text,
  add column if not exists fix_sent_at timestamptz,
  add column if not exists fix_sent_by_name text;

create or replace function public.leave_decline(p_records uuid[], p_decline boolean default true, p_reason text default null) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_n integer;
begin
  if not public.app_is_section_head() then
    raise exception 'Only the Section Head can decide on leave.' using errcode = 'insufficient_privilege';
  end if;
  update public.leave_records
     set declined_at = case when p_decline then now() end,
         declined_by_name = case when p_decline then coalesce((select display_name from public.user_profiles where auth_user_id = auth.uid() limit 1), 'Section Head') end,
         declined_reason = case when p_decline then nullif(trim(coalesce(p_reason, '')), '') end,
         approved_at = case when p_decline then null else approved_at end,
         approved_by = case when p_decline then null else approved_by end,
         approved_by_name = case when p_decline then null else approved_by_name end,
         fix_note = case when p_decline then null else fix_note end,
         fix_sent_at = case when p_decline then null else fix_sent_at end,
         fix_sent_by_name = case when p_decline then null else fix_sent_by_name end
   where id = any (p_records) and in_current_plan and status in ('approved', 'planned')
     and absence_type_code in ('annual_leave_planned', 'annual_leave_rescheduled')
     and (declined_at is null) = p_decline;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.leave_decline(uuid[], boolean, text) to authenticated;
revoke execute on function public.leave_decline(uuid[], boolean) from authenticated;

-- send to the Coordinator to fix the dates (or take it back)
create or replace function public.leave_send_fix(p_records uuid[], p_note text default null, p_send boolean default true) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_n integer;
begin
  if not public.app_is_section_head() then
    raise exception 'Only the Section Head can send leave to the Coordinator.' using errcode = 'insufficient_privilege';
  end if;
  update public.leave_records
     set fix_note = case when p_send then nullif(trim(coalesce(p_note, '')), '') end,
         fix_sent_at = case when p_send then now() end,
         fix_sent_by_name = case when p_send then coalesce((select display_name from public.user_profiles where auth_user_id = auth.uid() limit 1), 'Section Head') end
   where id = any (p_records) and in_current_plan and status in ('approved', 'planned')
     and absence_type_code in ('annual_leave_planned', 'annual_leave_rescheduled');
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.leave_send_fix(uuid[], text, boolean) to authenticated;

-- approving clears a note to fix as well as a refusal
create or replace function public.leave_approve(p_records uuid[], p_approve boolean default true) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_n integer;
begin
  if not public.app_is_section_head() then
    raise exception 'Only the Section Head can approve leave.' using errcode = 'insufficient_privilege';
  end if;
  update public.leave_records
     set approved_at = case when p_approve then now() end,
         approved_by = case when p_approve then auth.uid() end,
         approved_by_name = case when p_approve then coalesce((select display_name from public.user_profiles where auth_user_id = auth.uid() limit 1), 'Section Head') end,
         declined_at = case when p_approve then null else declined_at end,
         declined_by_name = case when p_approve then null else declined_by_name end,
         declined_reason = case when p_approve then null else declined_reason end,
         fix_note = case when p_approve then null else fix_note end,
         fix_sent_at = case when p_approve then null else fix_sent_at end,
         fix_sent_by_name = case when p_approve then null else fix_sent_by_name end
   where id = any (p_records) and in_current_plan and status in ('approved', 'planned')
     and (approved_at is null) = p_approve;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
