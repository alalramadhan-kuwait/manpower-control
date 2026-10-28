-- One page per shutdown (owner, 28 Oct 2026): Shutdown → M&I → Start-up, and the shutdown & start-up file.
-- The shutdown steps stay in the tracker (trk_steps, est_hours is their standard time); the start-up steps and the
-- file (scope, shutdown / handover / start-up procedures, each Available / Missing / Needs update) belong to the
-- Calendar shutdown. Nothing is deleted: a step or document no longer needed is switched off (active = false).

create table public.sd_startup_step (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.unit_events(id),
  seq int not null,
  title text not null check (length(trim(title)) > 0),
  std_hours numeric check (std_hours is null or std_hours >= 0),
  procedure_ref text,
  status text not null default 'not_started' check (status in ('not_started','running','done','not_required')),
  started_at timestamptz, done_at timestamptz,
  reason text, remark text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz, updated_by uuid, updated_by_name text
);
create index sd_startup_step_event on public.sd_startup_step (event_id, seq);

create table public.sd_file_doc (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.unit_events(id),
  part text not null check (part in ('scope','shutdown','handover','startup')),
  seq int not null default 0,
  ref text,
  title text not null check (length(trim(title)) > 0),
  location text,
  status text not null default 'missing' check (status in ('available','missing','update')),
  steps text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz, updated_by uuid, updated_by_name text
);
create index sd_file_doc_event on public.sd_file_doc (event_id, part, seq);

-- who changed it and when, filled in by the database
create or replace function public.sd_page_stamp() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.updated_by_name := coalesce((select display_name from public.user_profiles where auth_user_id = auth.uid() limit 1), new.updated_by_name);
  return new;
end $$;
revoke execute on function public.sd_page_stamp() from public, anon;

create trigger sd_startup_step_stamp before insert or update on public.sd_startup_step for each row execute function public.sd_page_stamp();
create trigger sd_file_doc_stamp before insert or update on public.sd_file_doc for each row execute function public.sd_page_stamp();
create trigger sd_startup_step_audit after insert or update or delete on public.sd_startup_step for each row execute function public.audit_row_change();
create trigger sd_file_doc_audit after insert or update or delete on public.sd_file_doc for each row execute function public.audit_row_change();

alter table public.sd_startup_step enable row level security;
alter table public.sd_file_doc enable row level security;
create policy sd_startup_step_read on public.sd_startup_step for select to authenticated using (public.app_is_staff());
create policy sd_startup_step_insert on public.sd_startup_step for insert to authenticated with check (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer','controller']), false));
create policy sd_startup_step_update on public.sd_startup_step for update to authenticated using (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer','controller']), false)) with check (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer','controller']), false));
create policy sd_file_doc_read on public.sd_file_doc for select to authenticated using (public.app_is_staff());
create policy sd_file_doc_insert on public.sd_file_doc for insert to authenticated with check (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer']), false));
create policy sd_file_doc_update on public.sd_file_doc for update to authenticated using (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer']), false)) with check (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer']), false));
revoke all on public.sd_startup_step, public.sd_file_doc from anon;
revoke delete, truncate on public.sd_startup_step, public.sd_file_doc from authenticated;
