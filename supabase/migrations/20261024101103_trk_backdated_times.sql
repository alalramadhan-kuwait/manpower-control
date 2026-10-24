-- Start / finish times entered after the event. The step keeps the actual time; trk_log keeps the entry time, who
-- entered it and the old value (trk_log_activity). Rules: never in the future (15 min clock margin), never a finish
-- before the start; more than 48 h back only by the Section Head: others send a request (trk_time_request) that
-- the Section Head approves or rejects. Loads without a login (plant report updates by the owner) are not limited.
create or replace function public.trk_activity_time_guard() returns trigger
language plpgsql set search_path to 'public' as $$
declare person boolean := auth.uid() is not null or public.trk_access_id() is not null;
begin
  if new.actual_start is not distinct from old.actual_start and new.actual_finish is not distinct from old.actual_finish then return new; end if;
  if new.actual_start > now() + interval '15 minutes' or new.actual_finish > now() + interval '15 minutes' then
    raise exception 'A start or finish time cannot be in the future.' using errcode = 'check_violation';
  end if;
  if new.actual_start is not null and new.actual_finish is not null and new.actual_finish < new.actual_start then
    raise exception 'The finish cannot be before the start.' using errcode = 'check_violation';
  end if;
  if person and not public.app_is_section_head() and (
       (new.actual_start is distinct from old.actual_start and new.actual_start < now() - interval '48 hours')
    or (new.actual_finish is distinct from old.actual_finish and new.actual_finish < now() - interval '48 hours')) then
    raise exception 'Times more than 48 h back need the Section Head: send it as a request.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create or replace trigger trk_activity_time_guard before update of actual_start, actual_finish on public.trk_activities
  for each row execute function public.trk_activity_time_guard();

create table if not exists public.trk_time_request (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  activity_row uuid not null references public.trk_activities(id),
  actual_start timestamptz,
  actual_finish timestamptz,
  reason text not null check (length(trim(reason)) > 0),
  by_user uuid default auth.uid(),
  by_name text default public.trk_who(),
  at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  check (actual_start is not null or actual_finish is not null),
  check (actual_finish is null or actual_start is null or actual_finish >= actual_start)
);
create index if not exists trk_time_request_tracker on public.trk_time_request (tracker_id, status);
alter table public.trk_time_request enable row level security;
create policy trk_time_request_read on public.trk_time_request for select
  using ((select public.app_current_role()) is not null or tracker_id = (select public.trk_access_tracker()));
create policy trk_time_request_insert on public.trk_time_request for insert with check (
  (coalesce((select public.app_current_role()) in ('section_head', 'manpower_coordinator', 'controller'), false) or tracker_id = (select public.trk_access_tracker()))
  and status = 'pending' and decided_at is null
  and exists (select 1 from public.trk_activities a where a.id = activity_row and a.tracker_id = trk_time_request.tracker_id));
revoke delete, update on public.trk_time_request from anon, authenticated;
grant select, insert on public.trk_time_request to anon, authenticated;

-- the Section Head decides; an approved request writes the times (as the Section Head), both are logged
create or replace function public.trk_time_request_decide(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path to 'public' as $$
declare r public.trk_time_request; who text := public.trk_who(); ref text;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can decide on earlier times.' using errcode = 'insufficient_privilege'; end if;
  select * into r from public.trk_time_request where id = p_id for update;
  if not found or r.status <> 'pending' then raise exception 'This request is no longer pending.'; end if;
  if p_approve then
    update public.trk_activities set actual_start = coalesce(r.actual_start, actual_start), actual_finish = coalesce(r.actual_finish, actual_finish)
     where id = r.activity_row;
  end if;
  update public.trk_time_request set status = case when p_approve then 'approved' else 'rejected' end, decided_by_name = who, decided_at = now(),
    decision_note = nullif(trim(coalesce(p_note, '')), '') where id = p_id;
  select equipment_key || ' · ' || activity_id into ref from public.trk_activities where id = r.activity_row;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  values (r.tracker_id, 'activity', ref, 'time request', r.by_name || ': ' || coalesce('start ' || r.actual_start::text, '') || coalesce(' finish ' || r.actual_finish::text, '') || ' (' || r.reason || ')',
    case when p_approve then 'approved' else 'rejected' end || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''), auth.uid(), who);
end $$;
revoke execute on function public.trk_time_request_decide(uuid, boolean, text) from public, anon;
grant execute on function public.trk_time_request_decide(uuid, boolean, text) to authenticated;

-- the requester may withdraw a pending request
create or replace function public.trk_time_request_withdraw(p_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  update public.trk_time_request set status = 'withdrawn', decided_at = now(), decided_by_name = public.trk_who()
   where id = p_id and status = 'pending' and public.trk_can_update(tracker_id) and by_name = public.trk_who();
  if not found then raise exception 'Only the person who sent a pending request can withdraw it.'; end if;
end $$;
revoke execute on function public.trk_time_request_withdraw(uuid) from public;
grant execute on function public.trk_time_request_withdraw(uuid) to anon, authenticated;
