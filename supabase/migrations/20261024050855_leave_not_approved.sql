-- The Section Head can also refuse a planned PV: "Not approved". It never counts as leave (not even on future dates)
-- and leaves the list of leave to approve; taking the refusal back makes it planned again.
alter table public.leave_records
  add column if not exists declined_at timestamptz,
  add column if not exists declined_by_name text;

create or replace function public.approval_state(l public.leave_records) returns text
language sql stable as $$
  select case when coalesce(l.absence_type_code, '') not in ('annual_leave_planned', 'annual_leave_rescheduled') then 'approved'
              when l.declined_at is not null then 'rejected'
              when l.approved_at is not null then 'approved' else 'not_submitted' end
$$;

create or replace function public.leave_approval_mirror() returns trigger
language plpgsql as $$
begin
  new.oracle_status := case when coalesce(new.absence_type_code, '') not in ('annual_leave_planned', 'annual_leave_rescheduled') then 'approved'
      when new.declined_at is not null then 'rejected'
      when new.approved_at is not null or (tg_op = 'INSERT' and new.origin in ('request', 'manual')) then 'approved' else 'not_submitted' end;
  return new;
end $$;
create or replace trigger leave_approval_mirror before insert or update of approved_at, declined_at, absence_type_code, oracle_status on public.leave_records
  for each row execute function public.leave_approval_mirror();

-- refuse (or take back the refusal of) planned PVs; approving clears a refusal and refusing clears an approval
create or replace function public.leave_decline(p_records uuid[], p_decline boolean default true) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_n integer;
begin
  if not public.app_is_section_head() then
    raise exception 'Only the Section Head can decide on leave.' using errcode = 'insufficient_privilege';
  end if;
  update public.leave_records
     set declined_at = case when p_decline then now() end,
         declined_by_name = case when p_decline then coalesce((select display_name from public.user_profiles where auth_user_id = auth.uid() limit 1), 'Section Head') end,
         approved_at = case when p_decline then null else approved_at end,
         approved_by = case when p_decline then null else approved_by end,
         approved_by_name = case when p_decline then null else approved_by_name end
   where id = any (p_records) and in_current_plan and status in ('approved', 'planned')
     and absence_type_code in ('annual_leave_planned', 'annual_leave_rescheduled')
     and (declined_at is null) = p_decline;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.leave_decline(uuid[], boolean) to authenticated;

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
         declined_by_name = case when p_approve then null else declined_by_name end
   where id = any (p_records) and in_current_plan and status in ('approved', 'planned')
     and (approved_at is null) = p_approve;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
