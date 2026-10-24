-- Loop diagrams: verified drawing excerpts (P&ID, isometric, vendor) attached to a neutralization loop and its
-- equipment. Reference only. Files live in the private bucket 'trk-drawings' under <tracker_id>/<uuid>.<ext>.
-- Revisions are kept: a new upload for the same loop and sheet makes the previous one 'superseded' (never deleted);
-- a wrong upload is 'withdrawn' with a reason. Read: anyone who reads the tracker (logins, its engineer links).
-- Attach / withdraw: Section Head, Manpower Coordinator, Engineer. Every upload and withdrawal is in trk_log.
create table public.trk_drawing (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  point_id uuid references public.trk_points(id),
  items text[] not null default '{}',
  sheet text not null check (length(trim(sheet)) > 0),
  rev text not null check (length(trim(rev)) > 0),
  source text not null check (length(trim(source)) > 0),
  title text,
  path text not null unique check (path like tracker_id::text || '/%'),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  note text,
  status text not null default 'current' check (status in ('current', 'superseded', 'withdrawn')),
  uploaded_by uuid default auth.uid(),
  uploaded_by_name text default public.trk_who(),
  uploaded_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by_name text,
  closed_reason text,
  check (point_id is not null or cardinality(items) > 0)
);
create index trk_drawing_point on public.trk_drawing (point_id) where status = 'current';
create index trk_drawing_tracker on public.trk_drawing (tracker_id);
alter table public.trk_drawing enable row level security;
create policy trk_drawing_read on public.trk_drawing for select using (public.trk_can_read(tracker_id));
create policy trk_drawing_insert on public.trk_drawing for insert with check (
  public.app_is_admin_staff() and status = 'current' and closed_at is null
  and (point_id is null or exists (select 1 from public.trk_points p where p.id = point_id and p.tracker_id = trk_drawing.tracker_id)));
revoke update, delete, truncate on public.trk_drawing from anon, authenticated;
grant select on public.trk_drawing to anon, authenticated;
grant insert on public.trk_drawing to authenticated;

-- stamps the uploader, supersedes the previous revision of the same loop / sheet, logs the upload
create or replace function public.trk_drawing_added() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare ref text := coalesce((select p.ref from public.trk_points p where p.id = new.point_id), array_to_string(new.items, ', '));
begin
  new.uploaded_by := auth.uid(); new.uploaded_by_name := public.trk_who(); new.uploaded_at := now();
  update public.trk_drawing set status = 'superseded', closed_at = now(), closed_by_name = new.uploaded_by_name, closed_reason = 'Rev ' || new.rev
   where tracker_id = new.tracker_id and status = 'current' and lower(trim(sheet)) = lower(trim(new.sheet))
     and point_id is not distinct from new.point_id and (new.point_id is not null or items = new.items);
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  values (new.tracker_id, 'drawing', ref, 'drawing', null, new.sheet || ' rev ' || new.rev || ' · ' || new.source, new.uploaded_by, new.uploaded_by_name);
  return new;
end $$;
create or replace trigger trk_drawing_added before insert on public.trk_drawing for each row execute function public.trk_drawing_added();
revoke execute on function public.trk_drawing_added() from public, anon, authenticated;

-- a wrong or unapproved upload is withdrawn (kept, with the reason), never deleted
create or replace function public.trk_drawing_withdraw(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path to 'public' as $$
declare d public.trk_drawing; who text := public.trk_who();
begin
  if not public.app_is_admin_staff() then raise exception 'Only the Section Head, a Coordinator or an Engineer can withdraw a drawing.' using errcode = 'insufficient_privilege'; end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'Give the reason for withdrawing the drawing.' using errcode = 'check_violation'; end if;
  update public.trk_drawing set status = 'withdrawn', closed_at = now(), closed_by_name = who, closed_reason = trim(p_reason)
   where id = p_id and status <> 'withdrawn' returning * into d;
  if not found then raise exception 'This drawing is already withdrawn.'; end if;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason)
  values (d.tracker_id, 'drawing', coalesce((select p.ref from public.trk_points p where p.id = d.point_id), array_to_string(d.items, ', ')),
    'drawing', d.sheet || ' rev ' || d.rev, 'withdrawn', auth.uid(), who, trim(p_reason));
end $$;
revoke execute on function public.trk_drawing_withdraw(uuid, text) from public, anon;
grant execute on function public.trk_drawing_withdraw(uuid, text) to authenticated;

-- the files: private bucket, read like the tracker, written by the same three levels, never changed or deleted
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trk-drawings', 'trk-drawings', false, 15728640, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
create policy trk_drawings_read on storage.objects for select
  using (case when bucket_id = 'trk-drawings' then public.trk_can_read(((storage.foldername(name))[1])::uuid) else false end);
create policy trk_drawings_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'trk-drawings' and public.app_is_admin_staff()
    and exists (select 1 from public.trk_trackers t where t.id::text = (storage.foldername(name))[1]));
