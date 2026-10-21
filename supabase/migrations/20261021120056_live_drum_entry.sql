-- Drum entry on the live tracker: the reactor removal accounts as on the test tracker (same activity lines),
-- working estimate the upper end of the management range, the engine switched on for the live tracker
insert into public.trk_qty_scope (tracker_id, equipment_key, scope, unit, range_low, range_high, activity_ids)
select '406998dc-a9ce-47ca-9a4f-fe74845b4b6a', s.equipment_key, s.scope, s.unit, s.range_low, s.range_high, s.activity_ids
  from public.trk_qty_scope s
 where s.tracker_id = '2e9c8262-20e9-4274-bd52-87c156a3a487' and s.scope = 'removal'
   and not exists (select 1 from unnest(s.activity_ids) x(aid) where not exists (select 1 from public.trk_activities a where a.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and a.equipment_key = s.equipment_key and a.activity_id = x.aid))
on conflict (tracker_id, equipment_key, scope) do nothing;
insert into public.trk_qty_estimate (scope_id, value, reason, by_name)
select s.id, s.range_high, 'Working estimate: upper end of the management range (Phase 0 decision D1)', 'Live setup'
  from public.trk_qty_scope s where s.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and s.scope = 'removal' and s.working_estimate is null;
update public.trk_trackers set settings = settings || '{"progressV2": true, "fcWindow": 4, "fcMin": 3, "staleH": 12, "miscDays": 3}'::jsonb
 where id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a';
-- R-12-203: gas test (OP-13) and hand over for inert entry (OP-14) were recorded on 21 Oct, the waiting note is stale
update public.trk_equipment set pending_reason = null, remark = 'Gas test done, handed over for inert entry 21 Oct'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and tag = 'R-12-203' and pending_reason = 'Waiting permit / gas test';
