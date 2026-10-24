-- Leave is approved by the Section Head in the app, not tracked in Oracle HR. Annual leave (PV) from the plan stays
-- "planned" until approved and does not take the person off the crew from its first day; leave outside the plan
-- (short, unpaid, emergency …) always counts. The Oracle columns stay on record, unused by the app.
alter table public.leave_records
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists approved_by_name text;

-- what the app shows and counts: 'approved', or 'not_submitted' for a planned PV not approved yet (read through the
-- old oracle_status name, so the screens and the engine keep one field)
create or replace function public.approval_state(l public.leave_records) returns text
language sql stable as $$
  select case when l.approved_at is not null or coalesce(l.absence_type_code, '') not like 'annual_leave%' then 'approved' else 'not_submitted' end
$$;

-- already approved: in Oracle, or changed through a request / by hand (the Section Head decided those)
update public.leave_records set approved_at = coalesce(oracle_updated_at, updated_at, now()), approved_by_name = 'Section Head'
 where approved_at is null and absence_type_code like 'annual_leave%' and (oracle_status = 'approved' or origin in ('request', 'manual'));

-- a PV recorded through a request or by hand is approved as it is recorded
create or replace function public.leave_approve_on_insert() returns trigger
language plpgsql as $$
begin
  if new.approved_at is null and coalesce(new.absence_type_code, '') like 'annual_leave%' and new.origin in ('request', 'manual') then
    new.approved_at := now();
    new.approved_by := auth.uid();
    new.approved_by_name := coalesce((select display_name from public.user_profiles where auth_user_id = auth.uid() limit 1), 'Section Head');
  end if;
  return new;
end $$;
create or replace trigger leave_approve_on_insert before insert on public.leave_records
  for each row execute function public.leave_approve_on_insert();

-- the Section Head approves (or takes back the approval of) one or many leave records
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
         approved_by_name = case when p_approve then coalesce((select display_name from public.user_profiles where auth_user_id = auth.uid() limit 1), 'Section Head') end
   where id = any (p_records) and in_current_plan and status in ('approved', 'planned')
     and (approved_at is null) = p_approve;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function public.leave_approve(uuid[], boolean) to authenticated;
grant execute on function public.approval_state(public.leave_records) to authenticated, anon;
