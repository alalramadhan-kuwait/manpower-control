-- Shift alerts: a push notification 15 minutes before each shift starts, with the crew and the Controller in charge.
-- 1. push_config: the push keys (VAPID) and the secret the cron job sends the edge function. Nobody but the server reads it.
-- 2. shift_alert_settings: on / off, minutes before, time zone, and when each shift starts. Staff read; the Section Head changes; audited.
-- 3. push_subscriptions: one row per phone that turned alerts on (each person reads only their own). Not audited: it holds device tokens.
-- 4. shift_alert_log: one row per shift per day once alerted, so it is never sent twice.
-- 5. RPCs push_public_key / push_subscribe / push_unsubscribe for the app.
-- 6. pg_cron job every minute calls the edge function shift-alerts.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table public.push_config (
  id boolean primary key default true check (id),
  vapid_public text,
  vapid_private text,
  cron_secret text not null default encode(extensions.gen_random_bytes(24), 'hex')
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
insert into public.push_config (id) values (true);
comment on table public.push_config is 'Push keys and cron secret. RLS on with no policy: only the server (service key) and the database owner read it.';

create table public.shift_alert_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  lead_minutes int not null default 15 check (lead_minutes between 1 and 120),
  tz text not null default 'Asia/Kuwait',
  morning_start time not null default '06:00',
  afternoon_start time not null default '14:00',
  night_start time not null default '22:00',
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
insert into public.shift_alert_settings (id) values (true);
alter table public.shift_alert_settings enable row level security;
create policy shift_alert_settings_read on public.shift_alert_settings for select using (public.app_is_staff());
create policy shift_alert_settings_write on public.shift_alert_settings for update using (public.app_is_section_head()) with check (public.app_is_section_head());
revoke insert, delete on public.shift_alert_settings from authenticated, anon;
create trigger shift_alert_settings_audit after insert or update or delete on public.shift_alert_settings for each row execute function public.audit_row_change();

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  label text,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own on public.push_subscriptions for select using (public.app_is_staff() and user_id = auth.uid());
revoke insert, update, delete on public.push_subscriptions from authenticated, anon;
revoke select (p256dh, auth) on public.push_subscriptions from authenticated, anon;

create table public.shift_alert_log (
  shift_date date not null,
  shift text not null check (shift in ('M', 'A', 'N')),
  crew text,
  sent_at timestamptz not null default now(),
  sent int not null default 0,
  failed int not null default 0,
  primary key (shift_date, shift)
);
alter table public.shift_alert_log enable row level security;
create policy shift_alert_log_read on public.shift_alert_log for select using (public.app_is_staff());
revoke insert, update, delete on public.shift_alert_log from authenticated, anon;

create or replace function public.push_public_key()
returns text language sql stable security definer set search_path = public as $$
  select vapid_public from public.push_config where id and public.app_is_staff();
$$;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_label text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.app_is_staff() then
    raise exception 'Only the Section Head or the Manpower Coordinator can turn on shift alerts.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'This phone did not give a complete push subscription.' using errcode = 'check_violation';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, label)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_label, 80))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.push_public_key(), public.push_subscribe(text, text, text, text), public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_public_key(), public.push_subscribe(text, text, text, text), public.push_unsubscribe(text) to authenticated;

select cron.schedule('shift-alerts', '* * * * *', $job$
  select net.http_post(
    url := 'https://fhnqaurtryfmmomvzrpl.supabase.co/functions/v1/shift-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select cron_secret from public.push_config where id)),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
$job$);
