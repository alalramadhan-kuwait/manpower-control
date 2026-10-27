-- Shutdown tracker · update intelligence (27 Oct 2026): pasted departmental reports, the facts read from them, the
-- proposals a person reviews and applies, the official Maintenance Planning progress day by day, and the reconciliation
-- history. Reports, findings, planning figures and reconciliation rows are kept for good (insert only; a revised
-- planning figure is a new revision pointing at the one it corrects). A proposal changes only in its review fields.
-- Applying a proposal goes through the tracker's own tables (steps, items, drums), so the stamps, the change log and
-- the overwrite protection are the same as for any update; the proposal keeps the reference of what was written.
-- Read: every app user. Write: whoever may update the tracker (Section Head, Engineer, Coordinator, Controller, an
-- engineer link). Nothing here is deleted.

create table public.trk_report (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  department text not null check (department in ('ops_engineer','ops_supervisor','shift_ops','mech_maint','planning','inspection','other')),
  report_date date not null,
  shift text check (shift in ('D','N')),
  reporter text,
  scope text not null default 'unknown' check (scope in ('train2','train1','common','unknown')),
  body text not null,
  fingerprint text not null,
  status text not null default 'read' check (status in ('read','applied','partial','failed')),
  summary jsonb not null default '{}'::jsonb,
  submitted_by uuid, submitted_by_name text, submitted_at timestamptz not null default now(),
  unique (tracker_id, fingerprint)
);
create index trk_report_tracker on public.trk_report (tracker_id, report_date desc, submitted_at desc);

create table public.trk_finding (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  report_id uuid not null references public.trk_report(id),
  fact_id text not null, line int not null,
  tag text, equipment_key text, activity_row uuid references public.trk_activities(id),
  kind text not null, state text not null, statement text not null, phrase text,
  event_at timestamptz, qty jsonb, scope text not null default 'unknown', confidence numeric,
  created_at timestamptz not null default now()
);
create index trk_finding_tracker on public.trk_finding (tracker_id, tag, created_at desc);

create table public.trk_proposal (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  report_id uuid not null references public.trk_report(id),
  fact_ids text[] not null default '{}',
  tag text, equipment_key text, equipment_id uuid references public.trk_equipment(id), activity_row uuid references public.trk_activities(id), activity_name text,
  type text not null check (type in ('finish_step','start_step','status_line','drums','new_step','defect','hold','hold_release','risk','planning','info','review')),
  classification text not null, level text check (level in ('confirmed','possible','risk')),
  title text not null, detail text, reason text, evidence text[] not null default '{}', issues text[] not null default '{}',
  current jsonb not null default '{}'::jsonb, proposed jsonb not null default '{}'::jsonb, new_step jsonb,
  event_at timestamptz not null,
  status text not null check (status in ('ready','review','conflict','info','applied','dismissed')),
  reviewed_by uuid, reviewed_by_name text, reviewed_at timestamptz, review_note text,
  applied_at timestamptz, applied_ref text,
  created_at timestamptz not null default now()
);
create index trk_proposal_tracker on public.trk_proposal (tracker_id, status, created_at desc);
create index trk_proposal_tag on public.trk_proposal (tracker_id, tag);

create table public.trk_planning_progress (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  report_date date not null, cutoff timestamptz,
  planned_pct numeric not null check (planned_pct between 0 and 100), actual_pct numeric not null check (actual_pct between 0 and 100),
  source text not null default 'Maintenance Planning', report_id uuid references public.trk_report(id),
  revision int not null default 1, supersedes uuid references public.trk_planning_progress(id),
  verification text not null default 'unverified' check (verification in ('unverified','partial','verified')),
  method text, evidence jsonb, reconciliation jsonb,
  created_by uuid, created_by_name text, created_at timestamptz not null default now(),
  unique (tracker_id, report_date, revision)
);

create table public.trk_reconcile (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  equipment_key text, tag text,
  previous_finding uuid references public.trk_finding(id), new_finding uuid references public.trk_finding(id),
  rule text not null, selected jsonb, reason text,
  at timestamptz not null default now()
);

-- who submitted / reviewed, stamped by the database
create or replace function public.trk_intel_stamp() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'trk_report' and tg_op = 'INSERT' then new.submitted_by := auth.uid(); new.submitted_by_name := public.trk_who(); new.submitted_at := now(); end if;
  if tg_table_name = 'trk_report' and tg_op = 'UPDATE' then
    -- the text and its source never change; only the status and the summary follow the review
    if (to_jsonb(new) - array['status','summary']) <> (to_jsonb(old) - array['status','summary']) then raise exception 'A report is kept as submitted'; end if;
  end if;
  if tg_table_name = 'trk_planning_progress' and tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_by_name := public.trk_who(); new.created_at := now(); end if;
  if tg_table_name = 'trk_proposal' and tg_op = 'UPDATE' then
    -- only the review may change: status, note, applied reference
    if (to_jsonb(new) - array['status','reviewed_by','reviewed_by_name','reviewed_at','review_note','applied_at','applied_ref']) <> (to_jsonb(old) - array['status','reviewed_by','reviewed_by_name','reviewed_at','review_note','applied_at','applied_ref']) then
      raise exception 'A proposal is reviewed, not rewritten'; end if;
    if old.status in ('applied','dismissed') and new.status <> old.status then raise exception 'This proposal is already %', old.status; end if;
    new.reviewed_by := auth.uid(); new.reviewed_by_name := public.trk_who(); new.reviewed_at := now();
    if new.status = 'applied' and old.status <> 'applied' then new.applied_at := now(); end if;
  end if;
  return new;
end $$;
create trigger trk_report_stamp before insert or update on public.trk_report for each row execute function public.trk_intel_stamp();
create trigger trk_planning_stamp before insert on public.trk_planning_progress for each row execute function public.trk_intel_stamp();
create trigger trk_proposal_stamp before update on public.trk_proposal for each row execute function public.trk_intel_stamp();
-- kept for good
create trigger trk_report_keep before delete on public.trk_report for each row execute function public.trk_insert_only();
create trigger trk_finding_keep before update or delete on public.trk_finding for each row execute function public.trk_insert_only();
create trigger trk_planning_keep before update or delete on public.trk_planning_progress for each row execute function public.trk_insert_only();
create trigger trk_reconcile_keep before update or delete on public.trk_reconcile for each row execute function public.trk_insert_only();
create trigger trk_proposal_keep before delete on public.trk_proposal for each row execute function public.trk_insert_only();
-- a report's status follows its proposals
create or replace function public.trk_report_status() returns trigger language plpgsql security definer set search_path = public as $$
declare n_open int; n_applied int; n_all int;
begin
  select count(*) filter (where status in ('ready','review','conflict')), count(*) filter (where status = 'applied'), count(*) into n_open, n_applied, n_all from public.trk_proposal where report_id = new.report_id;
  update public.trk_report set status = case when n_open = 0 and n_applied > 0 then 'applied' when n_applied > 0 then 'partial' else status end where id = new.report_id;
  return new;
end $$;
create trigger trk_proposal_report after update of status on public.trk_proposal for each row execute function public.trk_report_status();

alter table public.trk_report enable row level security;
alter table public.trk_finding enable row level security;
alter table public.trk_proposal enable row level security;
alter table public.trk_planning_progress enable row level security;
alter table public.trk_reconcile enable row level security;
create policy trk_report_read on public.trk_report for select using (public.app_current_role() is not null or public.trk_access_id() is not null);
create policy trk_report_insert on public.trk_report for insert with check (public.trk_can_update(tracker_id));
create policy trk_finding_read on public.trk_finding for select using (public.app_current_role() is not null or public.trk_access_id() is not null);
create policy trk_finding_insert on public.trk_finding for insert with check (public.trk_can_update(tracker_id));
create policy trk_proposal_read on public.trk_proposal for select using (public.app_current_role() is not null or public.trk_access_id() is not null);
create policy trk_proposal_insert on public.trk_proposal for insert with check (public.trk_can_update(tracker_id));
create policy trk_proposal_update on public.trk_proposal for update using (public.trk_can_update(tracker_id)) with check (public.trk_can_update(tracker_id));
create policy trk_planning_read on public.trk_planning_progress for select using (public.app_current_role() is not null or public.trk_access_id() is not null);
create policy trk_planning_insert on public.trk_planning_progress for insert with check (public.trk_can_update(tracker_id));
create policy trk_reconcile_read on public.trk_reconcile for select using (public.app_current_role() is not null or public.trk_access_id() is not null);
create policy trk_reconcile_insert on public.trk_reconcile for insert with check (public.trk_can_update(tracker_id));
revoke all on public.trk_report, public.trk_finding, public.trk_proposal, public.trk_planning_progress, public.trk_reconcile from anon;
revoke delete, truncate on public.trk_report, public.trk_finding, public.trk_proposal, public.trk_planning_progress, public.trk_reconcile from authenticated;
revoke execute on function public.trk_intel_stamp(), public.trk_report_status() from public, anon, authenticated;
