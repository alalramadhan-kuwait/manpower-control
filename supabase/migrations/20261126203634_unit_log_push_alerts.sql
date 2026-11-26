-- Unit log alerts (owner, 26 Nov 2026): a push when a new ARDS shift log or new lab results arrive. Each phone that has
-- push turned on chooses them separately from the shift alerts (off by default); logbook-ingest sends to those phones.
alter table public.push_subscriptions add column unit_log_alerts boolean not null default false;
comment on column public.push_subscriptions.unit_log_alerts is 'This phone also gets a push for each new Unit log and new lab results';

create or replace function public.push_unit_log_alerts(p_endpoint text, p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_staff() then
    raise exception 'Only staff can turn on Unit log alerts.' using errcode = 'insufficient_privilege';
  end if;
  update public.push_subscriptions set unit_log_alerts = coalesce(p_on, false) where endpoint = p_endpoint and user_id = auth.uid();
  return found;
end $$;
revoke all on function public.push_unit_log_alerts(text, boolean) from public, anon;
grant execute on function public.push_unit_log_alerts(text, boolean) to authenticated;
