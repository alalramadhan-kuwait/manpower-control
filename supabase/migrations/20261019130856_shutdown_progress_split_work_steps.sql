-- A bar-chart line that holds several jobs (Blind, remove elbow and top trays) becomes one work step per job, so each
-- is tracked on its own: the plan time is shared in order, the stage of each part is its own (the blind part = stage 1
-- and the deblind part = stage 6 follow the item stage). The original line stays, off, marked split. Every bar-chart
-- import splits the same way and keeps the actuals of the parts.

create or replace function public.trk_split_lines(p_tracker uuid) returns int language plpgsql security definer set search_path = public as $$
declare b int; n int;
begin
  select max(baseline) into b from public.trk_activities where tracker_id = p_tracker;
  if b is null then return 0; end if;
  with m(src, ord, part, st) as (values
    ('blind, remove elbow & top trays', 1, 'Blind', 1), ('blind, remove elbow & top trays', 2, 'Remove elbow', 2), ('blind, remove elbow & top trays', 3, 'Remove top trays', 2),
    ('disconnect isotopes / blind / open top & bottom elbows', 1, 'Disconnect isotopes', 1), ('disconnect isotopes / blind / open top & bottom elbows', 2, 'Blind', 1),
    ('disconnect isotopes / blind / open top & bottom elbows', 3, 'Open top elbow', 2), ('disconnect isotopes / blind / open top & bottom elbows', 4, 'Open bottom elbow', 2),
    ('neutralization / filling and draining of soda ash', 1, 'Soda ash filling', 1), ('neutralization / filling and draining of soda ash', 2, 'Soda ash soaking', 1), ('neutralization / filling and draining of soda ash', 3, 'Soda ash draining', 1),
    ('filling of soda ash & neutralization/soaking/draining', 1, 'Soda ash filling', 1), ('filling of soda ash & neutralization/soaking/draining', 2, 'Soda ash soaking', 1), ('filling of soda ash & neutralization/soaking/draining', 3, 'Soda ash draining', 1),
    ('isolate, drain & blinding', 1, 'Isolate', 1), ('isolate, drain & blinding', 2, 'Drain', 1), ('isolate, drain & blinding', 3, 'Blind', 1),
    ('isolate / blind', 1, 'Isolate', 1), ('isolate / blind', 2, 'Blind', 1),
    ('neutralize od, open manways', 1, 'Neutralize OD', 2), ('neutralize od, open manways', 2, 'Open manways', 2),
    ('neutralize od, open manways & neutreize id with 2% soda ash solution.', 1, 'Neutralize OD', 2), ('neutralize od, open manways & neutreize id with 2% soda ash solution.', 2, 'Open manways', 2),
    ('neutralize od, open manways & neutreize id with 2% soda ash solution.', 3, 'Neutralize ID (2% soda ash)', 2),
    ('burner d__p & cleaning', 1, 'Burners down', 2), ('burner d__p & cleaning', 2, 'Burner cleaning', 2),
    ('open manway/ install ventilation', 1, 'Open manway', 2), ('open manway/ install ventilation', 2, 'Install ventilation', 2),
    ('open manway/install ventilation', 1, 'Open manway', 2), ('open manway/install ventilation', 2, 'Install ventilation', 2),
    ('open channel, diaphragm & pull tube bundle', 1, 'Open channel', 2), ('open channel, diaphragm & pull tube bundle', 2, 'Remove diaphragm', 2), ('open channel, diaphragm & pull tube bundle', 3, 'Pull tube bundle', 2),
    ('open channel, diaphragm & pull out shell', 1, 'Open channel', 2), ('open channel, diaphragm & pull out shell', 2, 'Remove diaphragm', 2), ('open channel, diaphragm & pull out shell', 3, 'Pull out shell', 2),
    ('open covers and pull out the tube bundle', 1, 'Open covers', 2), ('open covers and pull out the tube bundle', 2, 'Pull out tube bundle', 2),
    ('removal of bottom inlet elbow / chimney trays', 1, 'Remove bottom inlet elbow', 2), ('removal of bottom inlet elbow / chimney trays', 2, 'Remove chimney trays', 2),
    ('erect complete internal scaffold/ manual cleaning as per inspection', 1, 'Erect internal scaffold', 2), ('erect complete internal scaffold/ manual cleaning as per inspection', 2, 'Manual cleaning as per inspection', 2),
    ('initial inspection/ manual cleaning', 1, 'Initial inspection', 3), ('initial inspection/ manual cleaning', 2, 'Manual cleaning', 3),
    ('hb& gb shell id', 1, 'Hydroblast shell ID', 2), ('hb& gb shell id', 2, 'Grit blast shell ID', 2),
    ('remove scaffolding & prepare for loading', 1, 'Remove scaffolding', 2), ('remove scaffolding & prepare for loading', 2, 'Prepare for loading', 2),
    ('cleaning components & measure diaphragm dimensions', 1, 'Clean components', 3), ('cleaning components & measure diaphragm dimensions', 2, 'Measure diaphragm dimensions', 3),
    ('pe/op. inspection & clearance', 1, 'PE / OP inspection', 3), ('pe/op. inspection & clearance', 2, 'Clearance', 3),
    ('load catalyst & install trays', 1, 'Load catalyst', 5), ('load catalyst & install trays', 2, 'Install trays', 5),
    ('box up chimney trays & load ceramic balls', 1, 'Box up chimney trays', 5), ('box up chimney trays & load ceramic balls', 2, 'Load ceramic balls', 5),
    ('fix top basket & top elbow', 1, 'Fix top basket', 5), ('fix top basket & top elbow', 2, 'Fix top elbow', 5),
    ('fix back all covers & box-up', 1, 'Fix back covers', 5), ('fix back all covers & box-up', 2, 'Box-up', 5),
    ('elbow box-up & deblind', 1, 'Elbow box-up', 5), ('elbow box-up & deblind', 2, 'Deblind', 6),
    ('box-up & deblind', 1, 'Box-up', 5), ('box-up & deblind', 2, 'Deblind', 6),
    ('box-up & de-blind', 1, 'Box-up', 5), ('box-up & de-blind', 2, 'Deblind', 6),
    ('box-up & deblinding', 1, 'Box-up', 5), ('box-up & deblinding', 2, 'Deblind', 6),
    ('deblind & connect piping', 1, 'Deblind', 6), ('deblind & connect piping', 2, 'Connect piping', 6),
    ('remove blind and install psv', 1, 'Remove blind', 6), ('remove blind and install psv', 2, 'Install PSV', 6)),
  o as (select a.* from public.trk_activities a where a.tracker_id = p_tracker and a.baseline = b and a.tracked and a.disabled_reason is null
          and exists (select 1 from m where lower(a.activity) like m.src)),
  p as (select o.*, m.ord, m.part, m.st, count(*) over (partition by o.id) k,
          min(case when not (m.part ~* 'blind' and m.st in (1, 6)) then m.ord end) over (partition by o.id) fw
          from o join m on lower(o.activity) like m.src),
  ins as (insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline, actual_start, actual_finish, actual_note)
    select p.tracker_id, p.activity_id || '-' || p.ord, p.grp, p.equipment_key, p.part, round(p.duration_h / p.k, 1),
           p.planned_start + (p.ord - 1) * (p.planned_finish - p.planned_start) / p.k, p.planned_start + p.ord * (p.planned_finish - p.planned_start) / p.k, p.st, true, p.baseline,
           coalesce(prev.actual_start, case when p.actual_finish is not null or p.ord = p.fw then p.actual_start end),
           coalesce(prev.actual_finish, p.actual_finish), coalesce(prev.actual_note, case when p.ord = p.fw then p.actual_note end)
      from p left join lateral (select x.actual_start, x.actual_finish, x.actual_note from public.trk_activities x
             where x.tracker_id = p.tracker_id and x.baseline = b - 1 and x.activity_id = p.activity_id || '-' || p.ord and x.equipment_key = p.equipment_key limit 1) prev on true
    returning 1)
  select count(*) into n from ins;
  update public.trk_activities a set tracked = false, disabled_reason = 'split' where a.tracker_id = p_tracker and a.baseline = b and a.tracked and a.disabled_reason is null
     and exists (select 1 from public.trk_activities x where x.tracker_id = a.tracker_id and x.baseline = b and x.equipment_key = a.equipment_key and x.activity_id = a.activity_id || '-1');
  -- the blind and deblind parts follow the item stage
  update public.trk_activities a set actual_start = coalesce(a.actual_start, case when a.stage = 1 then e.blinds_in_at else e.blinds_out_at end),
         actual_finish = case when a.stage = 1 then e.blinds_in_at else e.blinds_out_at end
    from public.trk_equipment e where e.tracker_id = a.tracker_id and coalesce(e.barchart_key, e.tag) = a.equipment_key and a.tracker_id = p_tracker and a.baseline = b
     and a.tracked and a.activity ~* 'blind' and a.actual_finish is null and ((a.stage = 1 and e.stage >= 1) or (a.stage = 6 and e.stage >= 6));
  return n;
end $$;

create or replace function public.trk_import_barchart(p_tracker uuid, p_rows jsonb) returns integer language plpgsql security definer set search_path = public as $$
declare t public.trk_trackers; b int; n int;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head imports the bar chart.'; end if;
  select * into t from public.trk_trackers where id = p_tracker;
  if t.id is null or t.mode = 'template' then raise exception 'Import into a test or live tracker.'; end if;
  select coalesce(max(baseline), 0) + 1 into b from public.trk_activities where tracker_id = p_tracker;
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline, actual_start, actual_finish, actual_note)
  select p_tracker, r->>'activity_id', nullif(r->>'group', ''), r->>'equipment_key', r->>'activity', nullif(r->>'duration_h', '')::numeric,
         nullif(r->>'planned_start', '')::timestamptz, nullif(r->>'planned_finish', '')::timestamptz, nullif(r->>'stage', '')::int,
         coalesce(nullif(r->>'tracked', '')::int, 1) = 1, b, prev.actual_start, prev.actual_finish, prev.actual_note
    from jsonb_array_elements(p_rows) r
    left join lateral (select a.actual_start, a.actual_finish, a.actual_note from public.trk_activities a
       where a.tracker_id = p_tracker and a.baseline = b - 1 and a.activity_id = r->>'activity_id' and a.equipment_key = r->>'equipment_key' limit 1) prev on true
   where coalesce(r->>'activity_id', '') <> '' and coalesce(r->>'equipment_key', '') <> '';
  get diagnostics n = row_count;
  -- a test import also becomes the seed of the next test reset
  if t.mode = 'test' and t.template_id is not null then
    insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, baseline)
    select t.template_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked,
           (select coalesce(max(baseline), 0) + 1 from public.trk_activities where tracker_id = t.template_id)
      from public.trk_activities where tracker_id = p_tracker and baseline = b;
    perform public.trk_split_lines(t.template_id);
  end if;
  perform public.trk_split_lines(p_tracker);
  return n;
end $$;

select public.trk_split_lines(id) from public.trk_trackers;
