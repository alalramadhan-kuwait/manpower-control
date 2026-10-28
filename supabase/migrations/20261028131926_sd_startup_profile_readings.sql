-- A start-up step's target profile and the panel's readings (owner, 28 Oct 2026). The profile is the SOP's own hour
-- table (MAB-OPR-SOP-12-1051, Train-1: unit feed, AR/DSL flow and each reactor's inlet temperature by hour on stream),
-- hour 0 = the step's actual start; the app shows the target now and next hour and never changes it. A reading is what
-- the panel reports (time, inlet °F, per reactor optional); behind the profile, the rest is re-planned at the SOP rate
-- (never faster) and the step's expected finish (expected_done_at) moves, so the shutdown end follows. A reading can
-- say the heat-up is holding. Nothing is deleted.
alter table public.sd_startup_step add column profile jsonb, add column profile_ref text, add column expected_done_at timestamptz;

create table public.sd_startup_reading (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.sd_startup_step(id),
  at timestamptz not null,
  temp numeric not null check (temp between 0 and 2000),
  rx jsonb,
  holding boolean not null default false,
  reason text check (reason in ('equipment','maintenance','process','safety','other')),
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz, updated_by uuid, updated_by_name text
);
create index sd_startup_reading_step on public.sd_startup_reading (step_id, at);
create trigger sd_startup_reading_stamp before insert or update on public.sd_startup_reading for each row execute function public.sd_page_stamp();
create trigger sd_startup_reading_audit after insert or update or delete on public.sd_startup_reading for each row execute function public.audit_row_change();
alter table public.sd_startup_reading enable row level security;
create policy sd_startup_reading_read on public.sd_startup_reading for select to authenticated using (public.app_is_staff());
create policy sd_startup_reading_insert on public.sd_startup_reading for insert to authenticated with check (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer','controller']), false));
create policy sd_startup_reading_update on public.sd_startup_reading for update to authenticated using (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer','controller']), false)) with check (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer','controller']), false));
revoke all on public.sd_startup_reading from anon;
revoke delete, truncate on public.sd_startup_reading from authenticated;

-- the shutdown end: a running step ends at the later of its start + plan, its expected finish (re-planned) and now
create or replace function public.sd_startup_end_sync() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  ev uuid := coalesce(new.event_id, old.event_id);
  e public.unit_events; r record; cur timestamptz := null; open_n int := 0; any_time boolean := false; new_end date;
begin
  select * into e from public.unit_events where id = ev;
  if e.id is null or e.status <> 'active' or e.tentative then return null; end if;
  for r in select * from public.sd_startup_step where event_id = ev and active and status <> 'not_required' order by seq loop
    if r.started_at is not null or r.done_at is not null then any_time := true; end if;
    if r.status = 'done' and r.done_at is not null then cur := greatest(coalesce(cur, r.done_at), r.done_at);
    elsif r.status = 'running' and r.started_at is not null then open_n := open_n + 1;
      cur := greatest(coalesce(cur, now()), r.started_at + make_interval(secs => coalesce(r.std_hours, 0) * 3600), coalesce(r.expected_done_at, now()), now());
    else open_n := open_n + 1; cur := greatest(coalesce(cur, now()), now()) + make_interval(secs => coalesce(r.std_hours, 0) * 3600);
    end if;
  end loop;
  if not any_time or cur is null then return null; end if;
  new_end := (cur at time zone 'Asia/Kuwait')::date;
  if new_end < e.start_date or new_end = e.end_date then return null; end if;
  update public.unit_events set end_date = new_end where id = ev;
  return null;
end $$;
revoke execute on function public.sd_startup_end_sync() from public, anon, authenticated;
create or replace trigger sd_startup_step_end_sync after insert or update of status, started_at, done_at, std_hours, active, seq, expected_done_at on public.sd_startup_step
  for each row execute function public.sd_startup_end_sync();

-- Train-1 (Sulfur line SD): the heat-up to 575 °F is SOP hours 0-9, the black oil cut-in SOP hours 9-27
update public.sd_startup_step set profile = '[{"h": 0, "sop_h": 0, "feed": 20, "ardsl": "0/20", "rx": [350, 350, 350, 350, 350], "note": null}, {"h": 1, "sop_h": 1, "feed": 20, "ardsl": "0/20", "rx": [375, 375, 375, 375, 375], "note": null}, {"h": 2, "sop_h": 2, "feed": 20, "ardsl": "0/20", "rx": [400, 400, 400, 400, 400], "note": null}, {"h": 3, "sop_h": 3, "feed": 20, "ardsl": "0/20", "rx": [425, 425, 425, 425, 425], "note": null}, {"h": 4, "sop_h": 4, "feed": 20, "ardsl": "0/20", "rx": [450, 450, 450, 450, 450], "note": null}, {"h": 5, "sop_h": 5, "feed": 20, "ardsl": "0/20", "rx": [475, 475, 475, 475, 475], "note": null}, {"h": 6, "sop_h": 6, "feed": 20, "ardsl": "0/20", "rx": [500, 500, 500, 500, 500], "note": null}, {"h": 7, "sop_h": 7, "feed": 20, "ardsl": "0/20", "rx": [525, 525, 525, 525, 525], "note": null}, {"h": 8, "sop_h": 8, "feed": 20, "ardsl": "0/20", "rx": [550, 550, 550, 550, 550], "note": null}, {"h": 9, "sop_h": 9, "feed": 20, "ardsl": "0/20", "rx": [575, 575, 575, 575, 575], "note": null}]'::jsonb, profile_ref = 'MAB-OPR-SOP-12-1051 · hours 0–9' where id = 'fc1ca5e8-ad2f-4884-8b66-abba72fabd70';
update public.sd_startup_step set profile = '[{"h": 0, "sop_h": 9, "feed": 20, "ardsl": "0/20", "rx": [575, 575, 575, 575, 575], "note": null}, {"h": 1, "sop_h": 10, "feed": 23, "ardsl": "3/20", "rx": [600, 600, 600, 600, 600], "note": "Note 1"}, {"h": 2, "sop_h": 11, "feed": 25, "ardsl": "6/19", "rx": [610, 610, 610, 610, 610], "note": null}, {"h": 3, "sop_h": 12, "feed": 25, "ardsl": "9/16", "rx": [620, 620, 620, 620, 620], "note": "Note 2"}, {"h": 4, "sop_h": 13, "feed": 25, "ardsl": "11/14", "rx": [630, 630, 630, 630, 630], "note": null}, {"h": 5, "sop_h": 14, "feed": 25, "ardsl": "13/12", "rx": [640, 642, 645, 647, 649], "note": "50/50"}, {"h": 6, "sop_h": 15, "feed": 25, "ardsl": "15/10", "rx": [640, 642, 645, 647, 649], "note": "Note 3"}, {"h": 7, "sop_h": 16, "feed": 25, "ardsl": "18/07", "rx": [640, 644, 647, 649, 652], "note": null}, {"h": 8, "sop_h": 17, "feed": 25, "ardsl": "21/04", "rx": [640, 646, 649, 650, 654], "note": null}, {"h": 9, "sop_h": 18, "feed": 25, "ardsl": "24/01", "rx": [640, 653, 657, 659, 663], "note": null}, {"h": 10, "sop_h": 19, "feed": 25, "ardsl": "25/0", "rx": [645, 658, 660, 667, 672], "note": null}, {"h": 11, "sop_h": 20, "feed": 28, "ardsl": "28/0", "rx": [646, 659, 661, 668, 675], "note": null}, {"h": 12, "sop_h": 21, "feed": 31, "ardsl": "31/0", "rx": [647, 660, 666, 675, 680], "note": null}, {"h": 13, "sop_h": 22, "feed": 34, "ardsl": "34/0", "rx": [649, 663, 669, 678, 690], "note": null}, {"h": 14, "sop_h": 23, "feed": 37, "ardsl": "37/0", "rx": [650, 666, 672, 681, 693], "note": null}, {"h": 15, "sop_h": 24, "feed": 40, "ardsl": "40/0", "rx": [650, 669, 675, 684, 696], "note": null}, {"h": 16, "sop_h": 25, "feed": 42, "ardsl": "42/0", "rx": [653, 672, 678, 687, 699], "note": null}, {"h": 17, "sop_h": 26, "feed": 42, "ardsl": "42", "rx": [656, 675, 681, 690, 702], "note": null}, {"h": 18, "sop_h": 27, "feed": 42, "ardsl": "42", "rx": [659, 678, 684, 693, 705], "note": null}]'::jsonb, profile_ref = 'MAB-OPR-SOP-12-1051 · hours 9–27' where id = '3a3b3800-0f24-4770-8566-e6efdfbaa095';
