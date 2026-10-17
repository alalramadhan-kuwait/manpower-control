-- Train-2 (plan f7c739f0, 18 Oct - 15 Nov 2026), Section Head decision 17 Oct 2026: the Night Controller (a0fa, crew B)
-- rests 17 Oct before joining on 18 Oct (rest rules: 12-16 Oct with B, then off, then the team's nights). The VR
-- Controller Abdullah Al-Saegh (placed with A, which keeps its own Controller that day) covers B Shift on 17 Oct (night)
-- and has 18 Oct off (B's rest day, his rest after the night); back with A on 19 Oct. No overtime; the shutdown days are
-- unchanged. Applied with execute_sql (the migration tool times out); the guards make a re-run do nothing.
update public.sd_members set rest_days = array['2026-10-17'::date]
 where plan_id = 'f7c739f0-881a-4633-8886-6758f6604469' and status = 'active'
   and employee_id = 'a0fae7c1-2238-42ee-b872-8179dc97f3f8' and start_date = '2026-10-18';
insert into public.controller_assignments (kind, employee_id, crew_code, covers_employee_id, start_date, end_date, note, created_by)
select 'shift_cover', 'b6b4ecbc-80f8-4791-9d56-908dcb78fb5d', 'B', 'a0fae7c1-2238-42ee-b872-8179dc97f3f8', '2026-10-17', '2026-10-18',
  'Section Head decision 17 Oct 2026: covers B Shift on 17 Oct (night) while the B Controller rests before joining the Train-2 shutdown team on 18 Oct; 18 Oct is B''s rest day (his rest after the night); back with A Shift 19 Oct. A Shift keeps its own Controller on 17 Oct.',
  '839d8dd0-58d6-4d7c-bd12-a248ad262074'
where not exists (select 1 from public.controller_assignments where status = 'active' and employee_id = 'b6b4ecbc-80f8-4791-9d56-908dcb78fb5d' and crew_code = 'B' and start_date = '2026-10-17');
