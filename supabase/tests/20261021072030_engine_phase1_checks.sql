-- Phase 1 checks, run inside one transaction that always rolls back (it ends by raising the results).
-- Replays the phase-1 migration on a copy of the state, then checks integrity, the mapping fingerprint, the
-- quantity safeguards and the permissions of the existing logins. Rerun only BEFORE the migration is applied.
do $test$
declare t0 timestamptz := clock_timestamp(); r text[] := '{}'; b_act text; b_eq text; b_pt text; b_tr text; b_oth text; a_act text; n int; x text; s205 uuid; e1 uuid; e2 uuid; ok boolean;
begin
  perform set_config('lock_timeout', '5s', true);
  select md5(string_agg(id::text||activity_id||coalesce(planned_start::text,'')||coalesce(planned_finish::text,'')||coalesce(duration_h::text,'')||coalesce(stage::text,'')||tracked::text||coalesce(disabled_reason,'')||coalesce(actual_start::text,'')||coalesce(actual_finish::text,'')||coalesce(seq::text,''), ',' order by id)) into b_act from public.trk_activities;
  select md5(string_agg(to_jsonb(e)::text, ',' order by id)) into b_eq from public.trk_equipment e;
  select md5(string_agg(to_jsonb(p)::text, ',' order by id)) into b_pt from public.trk_points p;
  select md5(string_agg(id::text||settings::text, ',' order by id)) into b_tr from public.trk_trackers;
  select md5(string_agg(id::text||settings::text, ',' order by id)) into b_oth from public.trk_trackers where id <> '2e9c8262-20e9-4274-bd52-87c156a3a487';
  execute $s$-- Progress engine, phase 1: the data foundation. Additive only: new tables, no change to the baseline columns of
-- trk_activities, no automatic completion. Shift entries, estimate revisions, updates and forecasts are insert-only
-- (a correction is a new row). Inferred links and forecasts are marked provisional.

-- how each bar-chart line is measured (one row per line, the line itself untouched)
create table if not exists public.trk_measure (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  activity_row uuid not null unique references public.trk_activities(id),
  measure text not null check (measure in ('qty_removal','qty_loading','milestone','count','acceptance','handover','linked','conditional','operations','misc','support','split_parent')),
  role text not null check (role in ('main','operations','misc','support','excluded')),
  rule text,
  dup_note text,
  dup_status text check (dup_status in ('candidate','confirmed','rejected')),
  startup_req text not null default 'unvalidated' check (startup_req in ('unvalidated','candidate','required','not_required')),
  scope_state text not null default 'in' check (scope_state in ('in','pending','required','not_required')),
  ref_qty numeric, ref_source text, ref_verified boolean not null default false,
  approved_by uuid, approved_by_name text, approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists trk_measure_tracker on public.trk_measure (tracker_id);

-- a quantity account per reactor and scope (removal / loading); the working estimate moves only by a revision row
create table if not exists public.trk_qty_scope (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  equipment_key text not null,
  scope text not null check (scope in ('removal','loading')),
  unit text check (unit in ('drums','kg','t','m3','other')),
  range_low numeric, range_high numeric,
  initial_estimate numeric, working_estimate numeric,
  activity_ids text[] not null default '{}',
  complete_at timestamptz, complete_by uuid, complete_by_name text,
  created_at timestamptz not null default now(),
  unique (tracker_id, equipment_key, scope)
);
create table if not exists public.trk_qty_estimate (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.trk_qty_scope(id),
  value numeric not null check (value > 0),
  reason text not null check (length(trim(reason)) > 0),
  by_user uuid, by_name text, at timestamptz not null default now()
);
create table if not exists public.trk_qty_entry (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references public.trk_qty_scope(id),
  shift_date date not null, shift text not null check (shift in ('D','N')),
  kind text not null check (kind in ('removal','transfer','correction')),
  method text not null check (method in ('free_fall','vacuum','cone','other')),
  qty numeric not null,
  corrects uuid references public.trk_qty_entry(id),
  stoppage text, remark text, source text not null default 'field' check (source in ('field','plant_report')),
  entered_by uuid, entered_by_name text, entered_at timestamptz not null default now(),
  verify_state text not null default 'pending' check (verify_state in ('pending','verified','rejected')),
  verified_by uuid, verified_by_name text, verified_at timestamptz,
  check (kind = 'correction' or qty >= 0),
  check (kind <> 'correction' or (corrects is not null and remark is not null)),
  check (qty <> 0 or kind <> 'removal' or stoppage is not null or remark is not null)
);
-- one removal / transfer per scope, shift and method: a second entry for the same shift is a correction
create unique index if not exists trk_qty_entry_once on public.trk_qty_entry (scope_id, shift_date, shift, method, kind) where kind <> 'correction';

create table if not exists public.trk_update (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  equipment_key text not null,
  activity_row uuid references public.trk_activities(id),
  kind text not null check (kind in ('milestone','accept','reject','no_change','delay','forecast')),
  reason text, expected_finish timestamptz,
  discipline text, acceptor_name text,
  by_user uuid, by_name text, at timestamptz not null default now(),
  verify_state text not null default 'pending' check (verify_state in ('pending','verified','rejected')),
  verified_by uuid, verified_by_name text, verified_at timestamptz,
  -- a technical acceptance names who accepted and for which discipline
  check (kind not in ('accept','reject') or (discipline is not null and acceptor_name is not null)),
  check (kind <> 'delay' or reason is not null)
);
create table if not exists public.trk_link (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  from_kind text not null, from_ref text not null, to_kind text not null, to_ref text not null,
  link_type text not null default 'FS' check (link_type in ('FS','SS','FF')),
  source text not null check (source in ('guideline','isolation','inferred','p6','confirmed')),
  provisional boolean generated always as (source = 'inferred') stored,
  confirmed_by uuid, confirmed_by_name text, confirmed_at timestamptz, note text,
  created_at timestamptz not null default now(),
  unique (tracker_id, from_kind, from_ref, to_kind, to_ref)
);
create table if not exists public.trk_forecast (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  equipment_key text, scope_id uuid references public.trk_qty_scope(id),
  shift_date date not null, shift text not null check (shift in ('D','N')),
  forecast_finish timestamptz, basis text not null,
  confidence text not null check (confidence in ('high','medium','low','unavailable')),
  provisional boolean not null default true,
  detail jsonb, at timestamptz not null default now()
);

-- insert-only records: no delete, and only the one-time verification may change a shift entry or an update
create or replace function public.trk_insert_only() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception '% rows are kept: enter a correction instead', tg_table_name; end if;
  if tg_table_name in ('trk_qty_entry','trk_update') then
    if old.verify_state <> 'pending' then raise exception 'Already %: enter a correction instead', old.verify_state; end if;
    if (to_jsonb(new) - array['verify_state','verified_by','verified_by_name','verified_at']) <> (to_jsonb(old) - array['verify_state','verified_by','verified_by_name','verified_at']) then
      raise exception 'Only the verification can change: enter a correction instead'; end if;
    if new.verify_state = 'pending' then raise exception 'Verification must verify or reject'; end if;
    -- the person who entered a quantity does not verify it (the Section Head may)
    if tg_table_name = 'trk_qty_entry' then
      if auth.uid() is not null and auth.uid() = (to_jsonb(old) ->> 'entered_by')::uuid and not public.app_is_section_head() then
        raise exception 'The person who entered it cannot verify it'; end if;
    end if;
    new.verified_at := now(); new.verified_by := auth.uid(); new.verified_by_name := public.trk_who();
    return new;
  end if;
  raise exception '% rows are kept: add a new row instead', tg_table_name;
end $$;
create or replace trigger trk_qty_entry_keep before update or delete on public.trk_qty_entry for each row execute function public.trk_insert_only();
create or replace trigger trk_update_keep before update or delete on public.trk_update for each row execute function public.trk_insert_only();
create or replace trigger trk_qty_estimate_keep before update or delete on public.trk_qty_estimate for each row execute function public.trk_insert_only();
create or replace trigger trk_forecast_keep before update or delete on public.trk_forecast for each row execute function public.trk_insert_only();

-- who entered a row is stamped by the database
create or replace function public.trk_stamp_entry() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'trk_qty_entry' then new.entered_by := coalesce(auth.uid(), new.entered_by); new.entered_by_name := coalesce(nullif(public.trk_who(), 'system'), new.entered_by_name);
  else new.by_user := coalesce(auth.uid(), new.by_user); new.by_name := coalesce(nullif(public.trk_who(), 'system'), new.by_name); end if;
  return new;
end $$;
create or replace trigger trk_qty_entry_stamp before insert on public.trk_qty_entry for each row execute function public.trk_stamp_entry();
create or replace trigger trk_update_stamp before insert on public.trk_update for each row execute function public.trk_stamp_entry();
create or replace trigger trk_qty_estimate_stamp before insert on public.trk_qty_estimate for each row execute function public.trk_stamp_entry();

-- a revision becomes the working estimate (the first one is also the initial estimate, which never changes after)
create or replace function public.trk_qty_estimate_apply() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.trk_qty_scope set working_estimate = new.value, initial_estimate = coalesce(initial_estimate, new.value) where id = new.scope_id;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  select s.tracker_id, 'qty', s.equipment_key || ' ' || s.scope, 'estimate', null, new.value::text || ' · ' || new.reason, new.by_user, new.by_name from public.trk_qty_scope s where s.id = new.scope_id;
  return null;
end $$;
create or replace trigger trk_qty_estimate_apply after insert on public.trk_qty_estimate for each row execute function public.trk_qty_estimate_apply();
create or replace function public.trk_qty_scope_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Quantity accounts are kept'; end if;
  if old.initial_estimate is not null and new.initial_estimate is distinct from old.initial_estimate then raise exception 'The initial estimate never changes'; end if;
  if new.working_estimate is distinct from old.working_estimate and pg_trigger_depth() < 2 then raise exception 'Change the estimate by adding a revision with its reason'; end if;
  return new;
end $$;
create or replace trigger trk_qty_scope_guard before update or delete on public.trk_qty_scope for each row execute function public.trk_qty_scope_guard();

-- shift entries and verifications go to the change log
create or replace function public.trk_qty_entry_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  select s.tracker_id, 'qty', s.equipment_key || ' ' || s.scope || ' ' || new.shift_date || ' ' || new.shift,
         case when tg_op = 'INSERT' then new.kind else 'verify' end, case when tg_op = 'UPDATE' then old.verify_state end,
         case when tg_op = 'INSERT' then new.qty::text || ' ' || new.method else new.verify_state end,
         auth.uid(), public.trk_who() from public.trk_qty_scope s where s.id = new.scope_id;
  return null;
end $$;
create or replace trigger trk_qty_entry_log after insert or update on public.trk_qty_entry for each row execute function public.trk_qty_entry_log();

-- permissions: everyone with a role reads; the tracker editors enter; the Section Head sets measures, scopes and links
alter table public.trk_measure enable row level security;
alter table public.trk_qty_scope enable row level security;
alter table public.trk_qty_estimate enable row level security;
alter table public.trk_qty_entry enable row level security;
alter table public.trk_update enable row level security;
alter table public.trk_link enable row level security;
alter table public.trk_forecast enable row level security;
create policy trk_measure_read on public.trk_measure for select using (public.app_current_role() is not null);
create policy trk_measure_head on public.trk_measure for all using (public.app_is_section_head()) with check (public.app_is_section_head());
create policy trk_qty_scope_read on public.trk_qty_scope for select using (public.app_current_role() is not null);
create policy trk_qty_scope_head on public.trk_qty_scope for all using (public.app_is_section_head()) with check (public.app_is_section_head());
create policy trk_qty_estimate_read on public.trk_qty_estimate for select using (public.app_current_role() is not null);
create policy trk_qty_estimate_head on public.trk_qty_estimate for insert with check (public.app_is_section_head());
create policy trk_qty_entry_read on public.trk_qty_entry for select using (public.app_current_role() is not null);
create policy trk_qty_entry_write on public.trk_qty_entry for insert with check (public.trk_can_update());
create policy trk_qty_entry_verify on public.trk_qty_entry for update using (public.trk_can_update()) with check (public.trk_can_update());
create policy trk_update_read on public.trk_update for select using (public.app_current_role() is not null);
create policy trk_update_write on public.trk_update for insert with check (public.trk_can_update());
create policy trk_update_verify on public.trk_update for update using (public.trk_can_update()) with check (public.trk_can_update());
create policy trk_link_read on public.trk_link for select using (public.app_current_role() is not null);
create policy trk_link_head on public.trk_link for all using (public.app_is_section_head()) with check (public.app_is_section_head());
create policy trk_forecast_read on public.trk_forecast for select using (public.app_current_role() is not null);
create policy trk_forecast_write on public.trk_forecast for insert with check (public.trk_can_update());
$s$;
  execute $s$-- ── test tracker only (2e9c8262-20e9-4274-bd52-87c156a3a487) ──
-- The measurement of every visible line, by the classification rules reviewed in phase 0 (one rule per line, first
-- match wins). The result was checked line by line against the reviewed register (891 lines, same fingerprint).
-- Nothing is approved yet: approved_by stays empty until the Section Head confirms the mapping.
with l as (
  select a.id, a.tracker_id, a.equipment_key k, a.activity_id aid, a.disabled_reason dr, lower(trim(a.activity)) t, a.grp og,
         coalesce(e.grp, '(no item) ' || coalesce(a.grp, '')) g
    from public.trk_activities a
    left join lateral (select e.grp from public.trk_equipment e where e.tracker_id = a.tracker_id and coalesce(e.barchart_key, e.tag) = a.equipment_key order by e.sort limit 1) e on true
   where a.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and coalesce(a.disabled_reason, '') not in ('split', 'removed', 'unit')
), c as (
  select l.*, case
    when og = 'Operations' then case when t ~ 'hand ?over|entry|gas test' then 'handover' when t ~ 'neutrali|soda|soak' then 'linked' when t ~ 'blind' then 'count' else 'operations' end
    when g like '(no item)%' or g = 'OPR list' then case when t ~ '(\d+)\s*nos|\d+ jobs' then 'misc' when t ~ 'as required|arranging|provide access|use calibrated|safety jobs' then 'support' else 'misc' end
    when t ~ 'scaffolding modification' then 'milestone'
    when t ~ 'if required|if needed|\(if req|possible ' then 'conditional'
    when t ~ '^(clean|buff|hydro ?blast|manual cleaning|complete |comp suc drum)' then 'milestone'
    when t ~ 'dump(ing)? (catalyst|ceramic)|dump catalyst' then 'qty_removal'
    when t ~ 'load(ing)? (of fresh )?(catalyst|ceramic)' then 'qty_loading'
    when t ~ 'soda ash (filling|soaking|draining)|^neutraliz|neutralized|neutralize (piping|od|id|with)|soak done|^neutralization$' then 'linked'
    when t ~ '\yde-?blind|\yblind(ing|s)?\y|remove blinds?|install blinds?|verify blinds' then 'count'
    when t ~ 'hand ?over|entry permit|^clearance|gas test' then 'handover'
    when t ~ 'inspection|offer |ndt|eddy|radiograph|\yrt\y|ufd|hydro ?test|hydrotest|\ytest\y|shell test|tube test|solo run|overspeed|functional test|measur|pe / op|lpt|x-ray|check the|to be check|be checked|all the nrv' then 'acceptance'
    when t ~ 'if required|if needed|\(if req|possible |as required|if threaded|based on' then 'conditional'
    else 'milestone' end measure
  from l
), m as (
  select c.*,
    case when og = 'Operations' then 'operations' when measure = 'support' then 'support'
         when g in ('Reactors','Heaters','Compressor','Exchangers','Vessels','Filters','Pumps / LO','Process piping','PSVs','Check valves','CV shells') then 'main' else 'misc' end role,
    case aid when 'A2430' then 'summary of 6 motor lines (A2760…A8270)' when 'A2490' then 'summary of 17 MOV lines (A2810…A3520)'
             when 'A2500' then 'summary of 3 heater lines (A3530…A3550)' when 'A2510' then 'summary of 5 LT panel lines (A2840…A8290); count conflict 3 vs 5'
             when 'A2410' then 'summary of HT motor lines under "P-203/205 HT motors"'
             when 'A2870' then 'same job as A2540' when 'A2900' then 'same job as A2545' when 'A2880' then 'same job as A9250'
             else case substring(t from '^oplist-(\d+)')
               when '1006' then 'may overlap H-201/202 "Burner cleaning"' when '1011' then 'may overlap C-201 / P-203 suction strainer cleaning lines'
               when '1012' then 'may overlap C-201 / P-203 lube-oil strainer lines' when '1014' then 'may overlap Check valves group (12-VC-01xx)'
               when '1015' then 'may overlap Check valves group (12-VC-01xx)' when '1016' then 'may overlap Check valves group (12-VC-01xx)'
               when '1017' then 'may overlap Check valves group (12-VC-01xx)' when '1026' then 'may overlap C-201-ST "Insulation to be check & replace"' end end dup,
    case when substring(t from '^oplist-(\d+)') in ('1004','1020','1022','1024','1025','1027') or lower(k) like '%steam flushing job prior%' or (g = 'PSVs' and t like '%install psv%')
         then 'candidate' else 'unvalidated' end su
  from c
)
insert into public.trk_measure (tracker_id, activity_row, measure, role, rule, dup_note, dup_status, startup_req, scope_state)
select tracker_id, id, measure, role,
       'phase-0 rule: ' || measure || case when k = 'C-12-201' and t like '%overhaul%' then ' · workshop maintenance (after transfer)' else '' end,
       dup, case when dup is not null then 'candidate' end, su,
       case when dr = 'not required' then 'not_required' when measure = 'conditional' then 'pending' else 'in' end
  from m
on conflict (activity_row) do nothing;
-- the hidden rows: the 91 combined P6 lines kept as split parents, the removed and unit-level operations lines
insert into public.trk_measure (tracker_id, activity_row, measure, role, rule)
select a.tracker_id, a.id, case when a.disabled_reason = 'split' then 'split_parent' else 'operations' end, 'excluded',
       case when a.disabled_reason = 'split' then 'original P6 line, split into single steps: kept unchanged, never counted' else 'hidden operations line (' || a.disabled_reason || ')' end
  from public.trk_activities a where a.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and a.disabled_reason in ('split', 'removed', 'unit')
on conflict (activity_row) do nothing;

-- C-201: the transfer to the workshop and the return, added as milestones with no baseline dates
insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, stage, tracked, baseline)
select '2e9c8262-20e9-4274-bd52-87c156a3a487', v.id, (select a.grp from public.trk_activities a where a.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and a.equipment_key = 'C-12-201' and a.grp is distinct from 'Operations' limit 1),
       'C-12-201', v.txt, null, true, (select max(baseline) from public.trk_activities x where x.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487')
  from (values ('ADD-C201-1', 'Transfer to workshop (shifting)'), ('ADD-C201-2', 'Return from workshop & installation')) v(id, txt)
 where not exists (select 1 from public.trk_activities a where a.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and a.equipment_key = 'C-12-201' and a.activity_id = v.id);
insert into public.trk_measure (tracker_id, activity_row, measure, role, rule)
select a.tracker_id, a.id, 'milestone', 'main', 'added milestone, not in the baseline: no planned dates'
  from public.trk_activities a where a.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and a.activity_id in ('ADD-C201-1', 'ADD-C201-2')
on conflict (activity_row) do nothing;

-- blind references (Train-1 list by the +100 rule) on the items' blind lines: reference only, ref_verified stays false
update public.trk_measure m set ref_qty = r.n, ref_source = r.src
  from (values
  ('C-12-201',58,'Train-1 blind list C-101 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('E-12-202',4,'Train-1 blind list E-102 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('E-12-203',4,'Train-1 blind list E-103 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('E-12-204',5,'Train-1 blind list E-104 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('E-12-205',5,'Train-1 blind list E-105 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('E-12-207',4,'Train-1 blind list E-107 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('E-12-210A',4,'Train-1 blind list E-110A/B (+100 rule), reference only: not checked against the Train-2 blind list (shared count for E-110A/B)'),
  ('E-12-210B',4,'Train-1 blind list E-110A/B (+100 rule), reference only: not checked against the Train-2 blind list (shared count for E-110A/B)'),
  ('E-12-211',5,'Train-1 blind list E-111 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('E-12-216A',6,'Train-1 blind list E-116A/B (+100 rule), reference only: not checked against the Train-2 blind list (shared count for E-116A/B)'),
  ('E-12-216B',6,'Train-1 blind list E-116A/B (+100 rule), reference only: not checked against the Train-2 blind list (shared count for E-116A/B)'),
  ('E-12-229',4,'Train-1 blind list E-129 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('EA-12-201A-D',37,'Train-1 blind list EA-101A-D (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('EJ-12-201',2,'Train-1 blind list EJ-101 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('F-12-201A-E',24,'Train-1 blind list F-101A-E (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('F-12-202',10,'Train-1 blind list F-102 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('H-12-201',16,'Train-1 blind list H-101 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('H-12-202',15,'Train-1 blind list H-102 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('P-12-202',2,'Train-1 blind list P-102 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('P-12-203A',66,'Train-1 blind list P-103A/B (+100 rule), reference only: not checked against the Train-2 blind list (shared count for P-103A/B)'),
  ('P-12-203B',66,'Train-1 blind list P-103A/B (+100 rule), reference only: not checked against the Train-2 blind list (shared count for P-103A/B)'),
  ('P-12-204A',4,'Train-1 blind list P-104A/B (+100 rule), reference only: not checked against the Train-2 blind list (shared count for P-104A/B)'),
  ('P-12-204B',4,'Train-1 blind list P-104A/B (+100 rule), reference only: not checked against the Train-2 blind list (shared count for P-104A/B)'),
  ('P-12-206A',4,'Train-1 blind list P-106A/B (+100 rule), reference only: not checked against the Train-2 blind list (shared count for P-106A/B)'),
  ('P-12-206B',4,'Train-1 blind list P-106A/B (+100 rule), reference only: not checked against the Train-2 blind list (shared count for P-106A/B)'),
  ('P-12-207A',5,'Train-1 blind list P-107A/B/C (+100 rule), reference only: not checked against the Train-2 blind list (shared count for P-107A/B/C)'),
  ('P-12-207B',5,'Train-1 blind list P-107A/B/C (+100 rule), reference only: not checked against the Train-2 blind list (shared count for P-107A/B/C)'),
  ('P-12-207C',5,'Train-1 blind list P-107A/B/C (+100 rule), reference only: not checked against the Train-2 blind list (shared count for P-107A/B/C)'),
  ('R-12-201',2,'Train-1 blind list R-101 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('R-12-202',2,'Train-1 blind list R-102 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('R-12-203',2,'Train-1 blind list R-103 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('R-12-204',3,'Train-1 blind list R-104 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('R-12-205',9,'Train-1 blind list R-105 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('T-12-201',14,'Train-1 blind list T-101 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('V-12-201',12,'Train-1 blind list V-101 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('V-12-202',7,'Train-1 blind list V-102 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('V-12-205',3,'Train-1 blind list V-105 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('V-12-206',7,'Train-1 blind list V-106 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('V-12-207',9,'Train-1 blind list V-107 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('V-12-208',12,'Train-1 blind list V-108 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('V-12-209',11,'Train-1 blind list V-109 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('V-12-210',7,'Train-1 blind list V-110 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('V-12-212',8,'Train-1 blind list V-112 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('V-12-213',8,'Train-1 blind list V-113 (+100 rule), reference only: not checked against the Train-2 blind list'),
  ('V-12-236',6,'Train-1 blind list V-136 (+100 rule), reference only: not checked against the Train-2 blind list')
  ) r(tag, n, src), public.trk_activities a
 where m.activity_row = a.id and a.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and m.measure = 'count' and a.equipment_key = r.tag and a.activity ~* 'blind' and a.activity !~* 'verify';

-- reactor quantity accounts: removal in drums with the management range; loading has no unit until it is decided
insert into public.trk_qty_scope (tracker_id, equipment_key, scope, unit, range_low, range_high, activity_ids)
select '2e9c8262-20e9-4274-bd52-87c156a3a487', v.k, v.scope, v.unit, v.lo, v.hi,
       coalesce((select array_agg(m2.aid order by m2.aid) from (select a.activity_id aid from public.trk_activities a join public.trk_measure m on m.activity_row = a.id
                  where a.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and a.equipment_key = v.k and m.measure = case when v.scope = 'removal' then 'qty_removal' else 'qty_loading' end) m2), '{}')
  from (values ('R-12-201','removal','drums',500,600), ('R-12-202','removal','drums',1100,1200), ('R-12-203','removal','drums',1100,1200), ('R-12-204','removal','drums',1100,1200), ('R-12-205','removal','drums',2300,2600),
               ('R-12-201','loading',null,null,null), ('R-12-202','loading',null,null,null), ('R-12-203','loading',null,null,null), ('R-12-204','loading',null,null,null), ('R-12-205','loading',null,null,null)) v(k, scope, unit, lo, hi)
on conflict (tracker_id, equipment_key, scope) do nothing;
insert into public.trk_qty_estimate (scope_id, value, reason, by_name)
select s.id, s.range_high, 'Working estimate: upper end of the management range (Phase 0 decision D1)', 'Phase 1 setup'
  from public.trk_qty_scope s where s.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and s.scope = 'removal' and s.working_estimate is null;

-- settings: the new engine stays off; freshness and forecast rules from the plan
update public.trk_trackers set settings = settings || '{"progressV2": false, "fcWindow": 4, "fcMin": 3, "staleH": 12, "miscDays": 3}'::jsonb where id = '2e9c8262-20e9-4274-bd52-87c156a3a487';
$s$;
  r := r || ('time data ' || (clock_timestamp()-t0)); t0 := clock_timestamp();
  -- 1 baseline and live untouched by the migration
  select md5(string_agg(id::text||activity_id||coalesce(planned_start::text,'')||coalesce(planned_finish::text,'')||coalesce(duration_h::text,'')||coalesce(stage::text,'')||tracked::text||coalesce(disabled_reason,'')||coalesce(actual_start::text,'')||coalesce(actual_finish::text,'')||coalesce(seq::text,''), ',' order by id)) into a_act from public.trk_activities where activity_id not like 'ADD-C201-%';
  r := r || ('T01 existing activity rows unchanged: ' || (a_act = b_act)::text);
  r := r || ('T02 equipment and points unchanged: ' || ((select md5(string_agg(to_jsonb(e)::text, ',' order by id)) from public.trk_equipment e) = b_eq and (select md5(string_agg(to_jsonb(p)::text, ',' order by id)) from public.trk_points p) = b_pt)::text);
  r := r || ('T03 live/template: new rows 0, settings unchanged: ' || ((select count(*) from public.trk_measure where tracker_id <> '2e9c8262-20e9-4274-bd52-87c156a3a487') + (select count(*) from public.trk_qty_scope where tracker_id <> '2e9c8262-20e9-4274-bd52-87c156a3a487') + (select count(*) from public.trk_activities where activity_id like 'ADD-C201-%' and tracker_id <> '2e9c8262-20e9-4274-bd52-87c156a3a487') = 0
      and (select md5(string_agg(id::text||settings::text, ',' order by id)) from public.trk_trackers where id <> '2e9c8262-20e9-4274-bd52-87c156a3a487') = b_oth)::text);
  select md5(string_agg(x, E'\n' order by convert_to(x, 'UTF8'))) into x from (select a.equipment_key||'|'||a.activity_id||'|'||m.measure||'|'||m.role||'|'||coalesce(m.dup_note,'')||'|'||m.startup_req x
    from public.trk_measure m join public.trk_activities a on a.id = m.activity_row where m.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and m.role <> 'excluded' and a.activity_id not like 'ADD-C201-%') z;
  r := r || ('T00 mapping fingerprint equals the reviewed register (891 lines): ' || (x = '2482323ba492d9023d156b527608741f')::text || ' ' || x);
  -- 2 mapping complete
  select count(*) into n from public.trk_activities a where a.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and not exists (select 1 from public.trk_measure m where m.activity_row = a.id);
  r := r || ('T04 test-tracker lines without a measure: ' || n);
  select string_agg(measure||'='||c, ' ' order by measure) into x from (select measure, count(*) c from public.trk_measure where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' group by 1) z;
  r := r || ('T05 measures: ' || x);
  select string_agg(role||'='||c, ' ' order by role) into x from (select role, count(*) c from public.trk_measure where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' group by 1) z;
  r := r || ('T06 roles: ' || x);
  r := r || ('T07 split parents excluded: ' || (select count(*) from public.trk_measure m join public.trk_activities a on a.id = m.activity_row where a.disabled_reason = 'split' and m.role = 'excluded') || '/91');
  r := r || ('T08 duplicate candidates kept (not excluded): ' || (select count(*) from public.trk_measure where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and dup_status = 'candidate' and role <> 'excluded'));
  r := r || ('T09 startup: candidate ' || (select count(*) from public.trk_measure where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and startup_req = 'candidate') || ', required 0 = ' || ((select count(*) from public.trk_measure where startup_req = 'required') = 0)::text);
  r := r || ('T10 blind refs: lines ' || (select count(*) from public.trk_measure where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and ref_qty is not null) || ' on items ' || (select count(distinct a.equipment_key) from public.trk_measure m join public.trk_activities a on a.id = m.activity_row where m.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and m.ref_qty is not null) || ', verified 0 = ' || ((select count(*) from public.trk_measure where ref_verified) = 0)::text);
  r := r || ('T11 conditional pending ' || (select count(*) from public.trk_measure where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and scope_state = 'pending') || ', not required ' || (select count(*) from public.trk_measure where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and scope_state = 'not_required'));
  -- 3 quantity accounts and revisions
  r := r || ('T12 scopes: ' || (select string_agg(equipment_key||' '||scope||' '||coalesce(unit,'-')||' '||coalesce(initial_estimate::text,'-')||'/'||coalesce(working_estimate::text,'-')||' ['||array_to_string(activity_ids,',')||']', '; ' order by scope, equipment_key) from public.trk_qty_scope where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487'));
  select id into s205 from public.trk_qty_scope where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and equipment_key = 'R-12-205' and scope = 'removal';
  insert into public.trk_qty_estimate (scope_id, value, reason) values (s205, 2400, 'test revision');
  r := r || ('T13 revision 2400: working ' || (select working_estimate from public.trk_qty_scope where id = s205) || ', initial ' || (select initial_estimate from public.trk_qty_scope where id = s205) || ', revisions ' || (select count(*) from public.trk_qty_estimate where scope_id = s205));
  begin update public.trk_qty_scope set working_estimate = 1 where id = s205; r := r || 'T14 direct estimate edit: ALLOWED (fail)'::text; exception when others then r := r || ('T14 direct estimate edit blocked: ' || sqlerrm); end;
  begin update public.trk_qty_scope set initial_estimate = 1 where id = s205; r := r || 'T15 initial edit: ALLOWED (fail)'::text; exception when others then r := r || ('T15 initial estimate edit blocked: ' || sqlerrm); end;
  begin insert into public.trk_qty_estimate (scope_id, value, reason) values (s205, 2500, ' '); r := r || 'T16 revision without reason: ALLOWED (fail)'::text; exception when others then r := r || ('T16 revision without reason blocked: ' || sqlerrm); end;
  -- 4 shift entries
  insert into public.trk_qty_entry (scope_id, shift_date, shift, kind, method, qty) values (s205, '2026-10-21', 'D', 'removal', 'vacuum', 150) returning id into e1;
  begin insert into public.trk_qty_entry (scope_id, shift_date, shift, kind, method, qty) values (s205, '2026-10-21', 'D', 'removal', 'vacuum', 150); r := r || 'T17 duplicate: ALLOWED (fail)'::text; exception when others then r := r || ('T17 duplicate shift entry blocked: ' || sqlerrm); end;
  insert into public.trk_qty_entry (scope_id, shift_date, shift, kind, method, qty) values (s205, '2026-10-21', 'D', 'removal', 'cone', 20);
  r := r || 'T18 same shift, other method accepted'::text;
  begin insert into public.trk_qty_entry (scope_id, shift_date, shift, kind, method, qty) values (s205, '2026-10-21', 'N', 'correction', 'vacuum', -10); r := r || 'T19 correction without reference: ALLOWED (fail)'::text; exception when others then r := r || ('T19 correction needs the entry and a remark: ' || sqlerrm); end;
  insert into public.trk_qty_entry (scope_id, shift_date, shift, kind, method, qty, corrects, remark) values (s205, '2026-10-21', 'D', 'correction', 'vacuum', -10, e1, 'recount');
  insert into public.trk_qty_entry (scope_id, shift_date, shift, kind, method, qty, remark) values (s205, '2026-10-22', 'D', 'transfer', 'vacuum', 40, 'drums moved to the dump area');
  r := r || 'T20 correction with reference and transfer accepted'::text;
  begin insert into public.trk_qty_entry (scope_id, shift_date, shift, kind, method, qty) values (s205, '2026-10-21', 'N', 'removal', 'vacuum', 0); r := r || 'T21 zero without reason: ALLOWED (fail)'::text; exception when others then r := r || ('T21 zero shift needs a stoppage reason: ' || sqlerrm); end;
  insert into public.trk_qty_entry (scope_id, shift_date, shift, kind, method, qty, stoppage) values (s205, '2026-10-21', 'N', 'removal', 'vacuum', 0, 'vacuum truck down');
  begin insert into public.trk_qty_entry (scope_id, shift_date, shift, kind, method, qty) values (s205, '2026-10-22', 'N', 'removal', 'vacuum', -5); r := r || 'T22 negative removal: ALLOWED (fail)'::text; exception when others then r := r || ('T22 negative removal blocked: ' || sqlerrm); end;
  begin update public.trk_qty_entry set qty = 999 where id = e1; r := r || 'T23 edit entry: ALLOWED (fail)'::text; exception when others then r := r || ('T23 entry edit blocked: ' || sqlerrm); end;
  r := r || ('T24 delete trigger present: ' || exists (select 1 from pg_trigger where tgname = 'trk_qty_entry_keep' and (tgtype & 8) = 8)::text || ', delete policies: ' || (select count(*) from pg_policies where tablename like 'trk_qty%' and cmd in ('DELETE','ALL') and policyname not like '%head'));
  update public.trk_qty_entry set verify_state = 'verified' where id = e1;
  begin update public.trk_qty_entry set verify_state = 'rejected' where id = e1; r := r || 'T25 re-verify: ALLOWED (fail)'::text; exception when others then r := r || ('T25 second verification blocked: ' || sqlerrm); end;
  begin insert into public.trk_update (tracker_id, equipment_key, kind) values ('2e9c8262-20e9-4274-bd52-87c156a3a487', 'E-12-204', 'accept'); r := r || 'T26 acceptance without acceptor: ALLOWED (fail)'::text; exception when others then r := r || ('T26 acceptance needs discipline and acceptor: ' || sqlerrm); end;
  begin insert into public.trk_update (tracker_id, equipment_key, kind) values ('2e9c8262-20e9-4274-bd52-87c156a3a487', 'E-12-204', 'delay'); r := r || 'T27 delay without reason: ALLOWED (fail)'::text; exception when others then r := r || ('T27 delay needs a reason: ' || sqlerrm); end;
  r := r || ('T28 log rows for qty: ' || (select count(*) from public.trk_log where kind = 'qty' and tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487'));
  r := r || ('time tests ' || (clock_timestamp()-t0)); t0 := clock_timestamp();
  -- 5 permissions (database roles and logins of the existing profiles)
  perform set_config('request.jwt.claims', json_build_object('sub', '5983438a-f4d7-44c2-98fa-26cbd7a2ec19', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := r || ('T29 coordinator reads scopes: ' || (select count(*) from public.trk_qty_scope where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487'));
  begin insert into public.trk_qty_entry (scope_id, shift_date, shift, kind, method, qty) values (s205, '2026-10-23', 'D', 'removal', 'vacuum', 100) returning id into e2; r := r || 'T30 coordinator enters drums: allowed'::text; exception when others then r := r || ('T30 coordinator entry FAILED: ' || sqlerrm); end;
  r := r || ('T31 stamped by: ' || coalesce((select entered_by_name from public.trk_qty_entry where id = e2), 'none'));
  begin update public.trk_qty_entry set verify_state = 'verified' where id = e2; r := r || 'T32 self-verify: ALLOWED (fail)'::text; exception when others then r := r || ('T32 self-verification blocked: ' || sqlerrm); end;
  begin insert into public.trk_qty_estimate (scope_id, value, reason) values (s205, 2000, 'x'); r := r || 'T33 coordinator revises estimate: ALLOWED (fail)'::text; exception when others then r := r || ('T33 estimate revision is Section Head only: ' || sqlerrm); end;
  update public.trk_measure set startup_req = 'required' where tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487';
  get diagnostics n = row_count; r := r || ('T34 coordinator changes measures (rows): ' || n);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', '95a5b52b-f075-4cd5-8244-4e1215a8e958', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin update public.trk_qty_entry set verify_state = 'verified' where id = e2; r := r || ('T35 other coordinator verifies: ' || (select verify_state || ' by ' || coalesce(verified_by_name,'-') from public.trk_qty_entry where id = e2)); exception when others then r := r || ('T35 other coordinator verify FAILED: ' || sqlerrm); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin r := r || ('T36 anonymous reads rows: ' || (select count(*) from public.trk_qty_entry) + (select count(*) from public.trk_measure)); exception when others then r := r || ('T36 anonymous read denied: ' || sqlerrm); end;
  begin r := r || ('T36b anonymous reads existing trk_points: ' || (select count(*) from public.trk_points)); exception when others then r := r || ('T36b anonymous read of existing trk_points denied the same way: ' || sqlerrm); end;
  begin insert into public.trk_qty_entry (scope_id, shift_date, shift, kind, method, qty) values (s205, '2026-10-24', 'D', 'removal', 'vacuum', 1); r := r || 'T37 anonymous entry: ALLOWED (fail)'::text; exception when others then r := r || ('T37 anonymous entry blocked: ' || sqlerrm); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', '839d8dd0-58d6-4d7c-bd12-a248ad262074', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin insert into public.trk_qty_estimate (scope_id, value, reason) values (s205, 2450, 'head revision'); r := r || ('T38 Section Head revises: working ' || (select working_estimate from public.trk_qty_scope where id = s205)); exception when others then r := r || ('T38 head revision FAILED: ' || sqlerrm); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  r := r || ('time permissions ' || (clock_timestamp()-t0));
  -- rollback script: tested separately (needs the destructive-statement confirmation)
  raise exception 'RESULTS%', E'\n' || array_to_string(r, E'\n');
end $test$;