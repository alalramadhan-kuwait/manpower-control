-- Rules (owner, 27 Oct 2026): every organization rule of the app in one place, changed by the Section Head only, with a
-- reason, inside its allowed range, from today forward; every change kept. One row per rule in app_rules (its group,
-- order and allowed range; the value for the rules the app keeps here). The rules already stored elsewhere stay where
-- they are and are changed through the same function: crew minimums (operating_modes, unit_sections), the approval
-- checks (validation_rules), the Controller shift cover length (controller_rules); the shutdown overtime limits are
-- also written to the shutdown plans still to be approved. Leave already approved, a published plan and an approved or
-- finished shutdown plan keep the rule they were made under (nothing is re-checked).

create table public.app_rules (
  key text primary key,
  grp text not null check (grp in ('crew','leave','vacation','controllers','checks','shutdown','tracker')),
  sort int not null,
  value jsonb,
  bounds jsonb not null default '{}'::jsonb,
  updated_by uuid, updated_by_name text, updated_at timestamptz
);
create table public.app_rule_changes (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  old_value jsonb, new_value jsonb not null,
  reason text not null,
  by_user uuid, by_name text, at timestamptz not null default now()
);
create index app_rule_changes_key on public.app_rule_changes (key, at desc);

insert into public.app_rules (key, grp, sort, value, bounds) values
  -- crew minimums: the values live in operating_modes / unit_sections (templates for every mode / section)
  ('crew.mode',          'crew', 10, null, '{"controller":{"min":0,"max":5},"panel":{"min":0,"max":10},"field":{"min":0,"max":20}}'),
  ('crew.section',       'crew', 20, null, '{"panel":{"min":0,"max":5},"field":{"min":0,"max":10}}'),
  ('crew.acting_panel',  'crew', 30, '{"grade":13,"sickMax":30}', '{"grade":{"min":10,"max":16},"sickMax":{"min":0,"max":365}}'),
  ('leave.pv_seats',     'leave', 10, '{"panelSeats":4}', '{"panelSeats":{"min":1,"max":8}}'),
  ('leave.pv_on_duty',   'leave', 20, '{"panel":3,"field":6}', '{"panel":{"min":0,"max":10},"field":{"min":0,"max":20}}'),
  ('leave.summer',       'leave', 30, '{"fromMonth":6,"toMonth":9,"maxCycles":2,"maxPeriods":1}', '{"fromMonth":{"min":1,"max":12},"toMonth":{"min":1,"max":12},"maxCycles":{"min":0,"max":12},"maxPeriods":{"min":0,"max":5}}'),
  ('vac.periods',        'vacation', 10, '{"min":4,"max":5}', '{"min":{"min":0,"max":10},"max":{"min":1,"max":10}}'),
  ('vac.per_slot',       'vacation', 20, '{"perSlot":4}', '{"perSlot":{"min":1,"max":10}}'),
  ('vac.panel_group',    'vacation', 30, '{"panelGroup":4}', '{"panelGroup":{"min":1,"max":8}}'),
  ('ctl.leaves',         'controllers', 10, '{"maxLeavesPerYear":4,"minDaysPerYear":25}', '{"maxLeavesPerYear":{"min":1,"max":12},"minDaysPerYear":{"min":0,"max":60}}'),
  ('ctl.cover_max',      'controllers', 20, null, '{"days":{"min":1,"max":60,"nullable":true}}'),
  ('chk.consecutive',    'checks', 10, null, '{"max":{"min":3,"max":14}}'),
  ('chk.change_rest',    'checks', 20, null, '{"hours":{"min":0,"max":48}}'),
  ('chk.min_rest',       'checks', 30, null, '{"hours":{"min":0,"max":24,"nullable":true}}'),
  ('chk.shift_times',    'checks', 40, null, '{"M":{"time":true},"A":{"time":true},"N":{"time":true},"hours":{"min":4,"max":12},"dayDutyStart":{"time":true},"dayDutyHours":{"min":4,"max":12}}'),
  ('sd.ot_month',        'shutdown', 10, '{"warn":72,"hard":80}', '{"warn":{"min":0,"max":200},"hard":{"min":0,"max":250}}'),
  ('sd.ot_year',         'shutdown', 20, '{"warn":380,"hard":440}', '{"warn":{"min":0,"max":1000},"hard":{"min":0,"max":1200}}'),
  ('sd.team_min',        'shutdown', 30, '{"controller":1,"experienced":1,"qualifiedFo":2}', '{"controller":{"min":0,"max":5},"experienced":{"min":0,"max":5},"qualifiedFo":{"min":0,"max":10}}'),
  ('sd.sick',            'shutdown', 40, '{"okMax":21,"warnMax":35,"freshDays":45}', '{"okMax":{"min":0,"max":365},"warnMax":{"min":0,"max":365},"freshDays":{"min":1,"max":365}}'),
  ('trk.stale',          'tracker', 10, '{"critical":6,"normal":12,"small":24}', '{"critical":{"min":1,"max":96},"normal":{"min":1,"max":96},"small":{"min":1,"max":168}}'),
  ('trk.qty_tol',        'tracker', 20, '{"abs":10,"relPct":1}', '{"abs":{"min":0,"max":100},"relPct":{"min":0,"max":10}}');

-- the value of a rule as it stands now, wherever it is kept
create or replace function public.app_rule_value(p_key text) returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if p_key like 'crew.mode.%' then
    select jsonb_build_object('controller', controller_min, 'panel', panel_min, 'field', field_min) into v from public.operating_modes where code = substr(p_key, 11);
  elsif p_key like 'crew.section.%' then
    select jsonb_build_object('panel', panel_min, 'field', field_min) into v from public.unit_sections where code = substr(p_key, 14);
  elsif p_key = 'ctl.cover_max' then select jsonb_build_object('days', shift_cover_max_days) into v from public.controller_rules where id = 1;
  elsif p_key = 'chk.consecutive' then select jsonb_build_object('max', (params->>'max')::numeric) into v from public.validation_rules where code = 'max_consecutive_duty_days';
  elsif p_key = 'chk.change_rest' then select jsonb_build_object('hours', (params->>'hours')::numeric) into v from public.validation_rules where code = 'shift_type_change_rest';
  elsif p_key = 'chk.min_rest' then select jsonb_build_object('hours', case when enabled then params->'hours' else 'null'::jsonb end) into v from public.validation_rules where code = 'min_rest_hours';
  elsif p_key = 'chk.shift_times' then select params into v from public.validation_rules where code = 'shift_times';
  else select value into v from public.app_rules where key = p_key;
  end if;
  return v;
end $$;

-- the Section Head changes one rule: inside its range, with a reason, kept in the history
create or replace function public.app_rule_set(p_key text, p_value jsonb, p_reason text) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r public.app_rules; tmpl text; old jsonb; f text; b jsonb; x jsonb; n numeric; who text := coalesce((select display_name from public.user_profiles where auth_user_id = auth.uid() limit 1), 'Section Head');
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head changes the rules.' using errcode = 'insufficient_privilege'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Say why the rule changes.' using errcode = 'check_violation'; end if;
  if jsonb_typeof(p_value) <> 'object' then raise exception 'The new value is not readable.' using errcode = 'check_violation'; end if;
  tmpl := case when p_key like 'crew.mode.%' then 'crew.mode' when p_key like 'crew.section.%' then 'crew.section' else p_key end;
  select * into r from public.app_rules where key = tmpl;
  if r.key is null then raise exception 'Unknown rule %.', p_key using errcode = 'check_violation'; end if;
  if p_key like 'crew.mode.%' and not exists (select 1 from public.operating_modes where code = substr(p_key, 11)) then raise exception 'Unknown operating mode.' using errcode = 'check_violation'; end if;
  if p_key like 'crew.section.%' and not exists (select 1 from public.unit_sections where code = substr(p_key, 14)) then raise exception 'Unknown unit section.' using errcode = 'check_violation'; end if;
  -- every part of the rule, inside its range
  for f, b in select * from jsonb_each(r.bounds) loop
    x := p_value -> f;
    if x is null then raise exception '% is missing.', f using errcode = 'check_violation'; end if;
    if jsonb_typeof(x) = 'null' then
      if coalesce((b->>'nullable')::boolean, false) then continue; end if;
      raise exception '% needs a value.', f using errcode = 'check_violation';
    end if;
    if coalesce((b->>'time')::boolean, false) then
      if jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception '% must be a time (HH:MM).', f using errcode = 'check_violation'; end if;
      continue;
    end if;
    if jsonb_typeof(x) <> 'number' then raise exception '% must be a number.', f using errcode = 'check_violation'; end if;
    n := (x #>> '{}')::numeric;
    if n < (b->>'min')::numeric or n > (b->>'max')::numeric then raise exception '% must be between % and %.', f, b->>'min', b->>'max' using errcode = 'check_violation'; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(p_value)) <> (select count(*) from jsonb_object_keys(r.bounds)) then raise exception 'Unexpected parts in the value.' using errcode = 'check_violation'; end if;
  -- the pairs that must stay in order
  if (p_value ? 'min') and (p_value ? 'max') and (p_value->>'min')::numeric > (p_value->>'max')::numeric then raise exception 'The least cannot be more than the most.' using errcode = 'check_violation'; end if;
  if (p_value ? 'warn') and (p_value ? 'hard') and (p_value->>'warn')::numeric > (p_value->>'hard')::numeric then raise exception 'The warning cannot be above the hard limit.' using errcode = 'check_violation'; end if;
  if (p_value ? 'okMax') and (p_value ? 'warnMax') and (p_value->>'okMax')::numeric > (p_value->>'warnMax')::numeric then raise exception 'OK cannot be above the warning.' using errcode = 'check_violation'; end if;
  if p_key = 'trk.stale' and not ((p_value->>'critical')::numeric <= (p_value->>'normal')::numeric and (p_value->>'normal')::numeric <= (p_value->>'small')::numeric) then raise exception 'Critical ≤ normal ≤ small jobs.' using errcode = 'check_violation'; end if;
  old := public.app_rule_value(p_key);
  if old = p_value then raise exception 'Nothing changed.' using errcode = 'check_violation'; end if;
  -- where the rule is kept
  if p_key like 'crew.mode.%' then
    update public.operating_modes set controller_min = (p_value->>'controller')::int, panel_min = (p_value->>'panel')::int, field_min = (p_value->>'field')::int,
      panel_grade14_min = least(panel_grade14_min, (p_value->>'panel')::int) where code = substr(p_key, 11);
  elsif p_key like 'crew.section.%' then
    update public.unit_sections set panel_min = (p_value->>'panel')::int, field_min = (p_value->>'field')::int where code = substr(p_key, 14);
  elsif p_key = 'ctl.cover_max' then
    update public.controller_rules set shift_cover_max_days = (p_value->>'days')::int, updated_by = auth.uid(), updated_at = now() where id = 1;
  elsif p_key = 'chk.consecutive' then
    update public.validation_rules set params = params || jsonb_build_object('max', (p_value->>'max')::int) where code = 'max_consecutive_duty_days';
  elsif p_key = 'chk.change_rest' then
    update public.validation_rules set params = params || jsonb_build_object('hours', (p_value->>'hours')::numeric) where code = 'shift_type_change_rest';
  elsif p_key = 'chk.min_rest' then
    update public.validation_rules set enabled = jsonb_typeof(p_value->'hours') <> 'null', params = params || jsonb_build_object('hours', p_value->'hours') where code = 'min_rest_hours';
  elsif p_key = 'chk.shift_times' then
    update public.validation_rules set params = p_value where code = 'shift_times';
  else
    update public.app_rules set value = p_value where key = p_key;
    -- the shutdown overtime limits: also the plans still to be approved (approved or finished plans keep theirs)
    if p_key = 'sd.ot_month' then
      update public.sd_plans set max_overtime = (p_value->>'warn')::int, max_overtime_hard = (p_value->>'hard')::int where status = 'active' and end_date >= current_date and approval_status <> 'approved';
    elsif p_key = 'sd.ot_year' then
      update public.sd_plans set max_overtime_year = (p_value->>'warn')::int, max_overtime_year_hard = (p_value->>'hard')::int where status = 'active' and end_date >= current_date and approval_status <> 'approved';
    end if;
  end if;
  update public.app_rules set updated_by = auth.uid(), updated_by_name = who, updated_at = now() where key = tmpl;
  insert into public.app_rule_changes (key, old_value, new_value, reason, by_user, by_name) values (p_key, old, p_value, trim(p_reason), auth.uid(), who);
  return p_value;
end $$;

-- the vacation plan reads its periods rule (was five, fixed)
create or replace function public.pv_rule(p_part text) returns int language sql stable security definer set search_path to 'public' as $$
  select (value->>p_part)::int from public.app_rules where key = 'vac.periods'
$$;

alter table public.app_rules enable row level security;
alter table public.app_rule_changes enable row level security;
create policy app_rules_read on public.app_rules for select using (public.app_current_role() is not null or public.trk_access_id() is not null);
create policy app_rule_changes_read on public.app_rule_changes for select using (public.app_current_role() is not null);
create trigger app_rule_changes_keep before update or delete on public.app_rule_changes for each row execute function public.trk_insert_only();
revoke all on public.app_rules, public.app_rule_changes from anon;
revoke insert, update, delete, truncate on public.app_rules, public.app_rule_changes from authenticated;
grant select on public.app_rules, public.app_rule_changes to authenticated;
revoke execute on function public.app_rule_set(text, jsonb, text), public.app_rule_value(text), public.pv_rule(text) from public, anon;
grant execute on function public.app_rule_set(text, jsonb, text), public.app_rule_value(text) to authenticated;
grant execute on function public.pv_rule(text) to authenticated, service_role;
-- crew minimums, the cover length and the approval checks change only through the rule function (history kept)
revoke update on public.unit_sections from authenticated;
revoke update on public.controller_rules from authenticated;
revoke execute on function public.validation_rule_set(text, text, boolean, jsonb) from authenticated;
-- a rule change makes an approval check of the vacation plan stale
create or replace function public.pv_alloc_fingerprint(p_year integer) returns text language sql stable security definer set search_path to 'public' as $$
  select md5(coalesce((select a.id::text || ':' || a.version::text || ':' || a.status from public.pv_allocs a where a.year = p_year and a.status <> 'superseded'), 'none')
    || '|' || coalesce((select string_agg(public.pv_row_json(r)::text, ',' order by r.employee_id)
                          from public.pv_alloc_rows r join public.pv_allocs a on a.id = r.alloc_id where a.year = p_year and a.status <> 'superseded'), '')
    || '|' || coalesce((select max(entered_at)::text from public.sick_checks), '') || '|' || coalesce((select max(imported_at)::text from public.oracle_stat_snapshots), '')
    || '|' || coalesce((select string_agg(e.id::text || coalesce(e.grade::text, '-') || coalesce(e.employment_type, '') || e.is_active::text, ',' order by e.id) from public.employees e where e.in_unit12_scope), '')
    || '|' || coalesce((select max(at)::text from public.app_rule_changes), ''))
$$;

-- the vacation periods per person: the Rules page (vac.periods) instead of a fixed five
create or replace function public.pv_draft_set(p_year integer, p_employee uuid, p_blocks jsonb) returns integer language plpgsql security definer set search_path to 'public' as $$
declare pl public.pv_plans; a public.pv_allocs; r public.pv_alloc_rows; crew text; b jsonb; s date; e date; n integer; prev_e date; periods integer := 0; src text;
begin
  if not public.app_is_staff() then raise exception 'Only the manpower staff can change the vacation plan.' using errcode = 'insufficient_privilege'; end if;
  select * into pl from public.pv_plans where year = p_year for update;
  if pl.id is null then raise exception 'There is no vacation plan for %.', p_year using errcode = 'check_violation'; end if;
  if pl.status not in ('draft') then raise exception 'Vacation Plan % is %: it can only be changed while it is a draft.', p_year, pl.status using errcode = 'check_violation'; end if;
  select * into a from public.pv_allocs where year = p_year and status = 'approved';
  if a.id is null then raise exception 'Approve the % manpower allocation first.', p_year using errcode = 'check_violation'; end if;
  select * into r from public.pv_alloc_rows where alloc_id = a.id and employee_id = p_employee;
  if r.id is null or r.grp = 'excluded' then raise exception 'This person is not in the approved manpower allocation.' using errcode = 'check_violation'; end if;
  crew := case when r.grp = 'relief' then r.cycle_crew else r.crew end;
  if crew is null then raise exception 'This person has no shift rota in the allocation.' using errcode = 'check_violation'; end if;
  for b in select * from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) order by (value->>'start')::date loop
    s := (b->>'start')::date; e := (b->>'end')::date; src := coalesce(b->>'source', 'manual');
    if s is null or e is null or e < s then raise exception 'Each vacation needs a first and a last day.' using errcode = 'check_violation'; end if;
    if extract(year from s)::integer <> p_year then raise exception 'A % vacation must start in %.', p_year, p_year using errcode = 'check_violation'; end if;
    if not public.pv_is_m1(crew, s) or (e - s + 1) % 8 <> 0 then raise exception 'Whole cycles only: % to % is not whole cycles of the % Shift rota.', s, e, crew using errcode = 'check_violation'; end if;
    if src not in ('manual', 'form', 'system') then raise exception 'Unknown source %.', src using errcode = 'check_violation'; end if;
    if prev_e is not null and s <= prev_e then raise exception 'Two vacations overlap on %.', s using errcode = 'check_violation'; end if;
    if prev_e is null or s > prev_e + 1 then periods := periods + 1; end if;
    prev_e := e;
  end loop;
  if periods > coalesce(public.pv_rule('max'), 5) then raise exception '% vacation periods: % at most.', periods, coalesce(public.pv_rule('max'), 5) using errcode = 'check_violation'; end if;
  update public.pv_plan_blocks x set removed_at = now(), removed_by = auth.uid()
   where x.plan_id = pl.id and x.employee_id = p_employee and x.removed_at is null
     and not exists (select 1 from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) j where (j->>'start')::date = x.start_date and (j->>'end')::date = x.end_date
                       and coalesce(j->>'source', 'manual') = x.source);
  insert into public.pv_plan_blocks (plan_id, employee_id, start_date, end_date, version, source, upload_id)
  select pl.id, p_employee, (j->>'start')::date, (j->>'end')::date, pl.version, coalesce(j->>'source', 'manual'), nullif(j->>'upload_id', '')::uuid
    from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) j
   where not exists (select 1 from public.pv_plan_blocks x where x.plan_id = pl.id and x.employee_id = p_employee and x.removed_at is null
                       and x.start_date = (j->>'start')::date and x.end_date = (j->>'end')::date and x.source = coalesce(j->>'source', 'manual'));
  update public.pv_plans set updated_at = now() where id = pl.id;
  select count(*) into n from public.pv_plan_blocks where plan_id = pl.id and employee_id = p_employee and removed_at is null;
  return n;
end $$;
