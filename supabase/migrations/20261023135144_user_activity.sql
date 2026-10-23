-- User activity (Section Head, 23 Oct): when each person uses the app and what they open, beside what they change
-- (audit_log for the app, trk_log for the shutdown tracker). The app records a visit through app_visit(): a signed-in
-- user or an engineer link, the page, the device; the same person on the same page within 10 minutes is one visit.
-- Only the Section Head reads it.
create table public.app_activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  login text,
  name text not null,
  kind text not null check (kind in ('app', 'link')),
  page text not null,
  device text
);
create index app_activity_at on public.app_activity (at desc);
create index app_activity_who on public.app_activity (name, at desc);
alter table public.app_activity enable row level security;
create policy app_activity_head on public.app_activity for select using (public.app_is_section_head());

create or replace function public.app_visit(p_page text, p_device text default null) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); link text := public.trk_access_id(); who text; k text;
begin
  if uid is not null then
    select display_name into who from public.user_profiles where auth_user_id = uid and is_active limit 1;
    if who is null then return; end if; k := 'app';
  elsif link is not null then who := link; k := 'link';
  else return; end if;
  if exists (select 1 from public.app_activity a where a.name = who and a.page = left(coalesce(p_page, '/'), 120) and a.at > now() - interval '10 minutes') then return; end if;
  insert into public.app_activity (user_id, login, name, kind, page, device) values (uid, link, who, k, left(coalesce(p_page, '/'), 120), left(p_device, 60));
end $$;
revoke all on function public.app_visit(text, text) from public;
grant execute on function public.app_visit(text, text) to anon, authenticated;

-- the people and what they did in the last days: visits, changes in the app and in the tracker, last seen
create or replace function public.user_activity_summary(p_days int default 7) returns table (name text, kind text, role text, last_seen timestamptz, visits bigint, app_changes bigint, tracker_changes bigint, last_page text)
language sql stable security definer set search_path = public as $$
  with since as (select now() - make_interval(days => greatest(1, least(p_days, 90))) t),
  people as (
    select p.display_name name, 'app'::text kind, p.role_code role, p.auth_user_id uid from public.user_profiles p where p.is_active
    union all select a.login_id, 'link', 'engineer link', null::uuid from public.trk_access a group by a.login_id),
  v as (select a.name, count(*) n, max(a.at) last, (array_agg(a.page order by a.at desc))[1] page from public.app_activity a, since where a.at >= since.t group by a.name),
  au as (select l.actor_id, count(*) n, max(l.occurred_at) last from public.audit_log l, since where l.occurred_at >= since.t and l.batch_id is null group by l.actor_id),
  tk as (select l.by_name, count(*) n, max(l.at) last from public.trk_log l, since where l.at >= since.t group by l.by_name)
  select pe.name, pe.kind, pe.role,
    nullif(greatest(coalesce(v.last, '-infinity'), coalesce(au.last, '-infinity'), coalesce(tk.last, '-infinity'), coalesce((select max(x.last_seen_at) from public.trk_access x where x.login_id = pe.name), '-infinity')), '-infinity'),
    coalesce(v.n, 0), coalesce(au.n, 0), coalesce(tk.n, 0), v.page
  from people pe left join v on v.name = pe.name left join au on au.actor_id = pe.uid left join tk on tk.by_name = pe.name
  where public.app_is_section_head()
  order by 4 desc nulls last, 1
$$;
revoke all on function public.user_activity_summary(int) from public;
grant execute on function public.user_activity_summary(int) to authenticated;
