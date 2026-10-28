-- The heat wave and the black oil cut-in (owner, 28 Oct 2026). Only R-105 is heated; the heat reaches R-101..R-104 in
-- turn. A step can carry the cut-in conditions (each reactor's bed temperature, the most the R-105 inlet may be raised
-- to); the panel's temperatures along the train are recorded as wave readings, and the app estimates from them when
-- every reactor reaches its temperature. An estimate only: it never changes a step. Nothing is deleted.
alter table public.sd_startup_step add column cutin jsonb;

create table public.sd_wave_reading (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references public.sd_startup_step(id),
  at timestamptz not null,
  pts jsonb not null,
  beds jsonb,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz, updated_by uuid, updated_by_name text
);
create index sd_wave_reading_step on public.sd_wave_reading (step_id, at);
create trigger sd_wave_reading_stamp before insert or update on public.sd_wave_reading for each row execute function public.sd_page_stamp();
create trigger sd_wave_reading_audit after insert or update or delete on public.sd_wave_reading for each row execute function public.audit_row_change();
alter table public.sd_wave_reading enable row level security;
create policy sd_wave_reading_read on public.sd_wave_reading for select to authenticated using (public.app_is_staff());
create policy sd_wave_reading_insert on public.sd_wave_reading for insert to authenticated with check (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer','controller']), false));
create policy sd_wave_reading_update on public.sd_wave_reading for update to authenticated using (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer','controller']), false)) with check (coalesce((select public.app_current_role()) = any (array['section_head','manpower_coordinator','engineer','controller']), false));
revoke all on public.sd_wave_reading from anon;
revoke delete, truncate on public.sd_wave_reading from authenticated;

-- Train-1: the cut-in conditions on the heat-up step (process instruction, 28 Oct 2026) and the two panel readings
update public.sd_startup_step set cutin = '{"targets": {"r105": 610, "r101": 600, "r102": 580, "r103": 570, "r104": 560}, "inletMax": 620, "ref": "Process instruction 28 Oct 2026"}'::jsonb
  where id = 'fc1ca5e8-ad2f-4884-8b66-abba72fabd70';
insert into public.sd_wave_reading (step_id, at, pts, beds, note) values
  ('fc1ca5e8-ad2f-4884-8b66-abba72fabd70', '2026-10-28 12:00:00+00', '{"r105_in": 401, "r105_out": 369, "r101_in": 360, "r102_in": 355, "r103_in": 345, "r104_in": 336, "r104_out": 331}'::jsonb, null, 'Panel temperatures, 3:00 PM'),
  ('fc1ca5e8-ad2f-4884-8b66-abba72fabd70', '2026-10-28 18:51:00+00', '{"r105_in": 580.2, "r105_out": 522.4, "r101_in": 497, "r102_in": 488, "r103_in": 460, "r104_in": 429, "r104_out": 403.8}'::jsonb,
   '{"r105": 398.1, "r101": 486, "r102": 460, "r103": 422, "r104": 395}'::jsonb, 'DCS reactors bed temperature page, 9:51 PM; beds: coldest of each reactor');
