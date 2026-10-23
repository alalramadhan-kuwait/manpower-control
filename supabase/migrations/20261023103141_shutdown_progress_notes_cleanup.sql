-- Notes clean-up approved by the Section Head (23 Oct): a note says the status only; problems become Issues on the
-- item, waits become the status (pending reason), counts already shown elsewhere (drums) are dropped, and lineup
-- facts move to the item's description. The stamp is paused so each item keeps the time it was last really updated
-- (the "to update" list relies on it); the change log still records every change.
alter table public.trk_equipment disable trigger trk_equipment_stamp;
alter table public.trk_event disable trigger trk_event_stamp;

with t as (select '406998dc-a9ce-47ca-9a4f-fe74845b4b6a'::uuid tid),
v(tag, remark, pending, keep_pending) as (values
  ('R-12-205', 'Vacuum dumping stopped', null, true),
  ('R-12-203', 'Dumping I/P', null, true),
  ('V-12-209', null, 'Waiting permit / gas test', false),
  ('V-12-212', 'Manway not opened', 'Waiting manpower', false),
  ('E-12-207', 'Shell & bundle hydroblasting I/P', null, true),
  ('V-12-213', 'Gas test OK, utility line steaming done', null, true),
  ('C-12-201', null, null, true))
update public.trk_equipment e set remark = v.remark, pending_reason = case when v.keep_pending then e.pending_reason else v.pending end
  from t, v where e.tracker_id = t.tid and e.tag = v.tag;

update public.trk_equipment set description = 'Lean amine pump to T-201 with hydraulic turbine (P&ID lineup), not the charge pump (P-203)', remark = null
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and tag = 'P-12-205';

insert into public.trk_event (tracker_id, category, text, started_at, by_name, equipment_key, updated_at)
select '406998dc-a9ce-47ca-9a4f-fe74845b4b6a', x.cat, x.txt, x.at::timestamptz, x.who, x.k, now()
  from (values
    ('reactors', 'High temp in one bed: N2 flow increased, soda ash level raised (vendor)', '2026-10-23T13:17:02+03:00', 'Aad323', 'R-12-205'),
    ('other', 'Last gas test failed', '2026-10-23T08:01:35+03:00', 'system', 'V-12-209')) x(cat, txt, at, who, k)
 where not exists (select 1 from public.trk_event e where e.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and e.equipment_key = x.k and e.text = x.txt);

alter table public.trk_equipment enable trigger trk_equipment_stamp;
alter table public.trk_event enable trigger trk_event_stamp;
