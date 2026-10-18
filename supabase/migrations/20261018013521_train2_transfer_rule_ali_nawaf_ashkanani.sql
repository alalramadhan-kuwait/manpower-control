-- Train-2 (Section Head, 18 Oct 2026), rule for the transfer between the crew rota (6/2) and the shutdown cycle (3/1):
-- Ali Alajmi (crew B) rests 17 Oct (recorded rest day; 5 days of the B block, then 17-18 off, starts 19 Oct);
-- Nawaf Aldasem (crew C, +6 h joining) off on 18 Oct (Night team keeps its minimum: an Experienced and a second
-- qualified FO); Abdullah Ashkanani (VR, -10 h returning to D) works 15 Nov (5 days in a row, -2 h after).
-- Applied with execute_sql (the migration tool times out); the guards make a re-run do nothing.
update public.sd_members set rest_days = array['2026-10-17'::date]
 where plan_id = 'f7c739f0-881a-4633-8886-6758f6604469' and status = 'active' and rest_days = '{}'
   and employee_id = (select id from public.employee_directory_v where display_name = 'Ali Alajmi');
update public.sd_days set works = false, hours = null
 where work_date = '2026-10-18' and works and member_id = (select m.id from public.sd_members m where m.plan_id = 'f7c739f0-881a-4633-8886-6758f6604469' and m.status = 'active'
   and m.employee_id = (select id from public.employee_directory_v where display_name = 'Nawaf Aldasem'));
update public.sd_days set works = true, hours = 12
 where work_date = '2026-11-15' and not works and member_id = (select m.id from public.sd_members m where m.plan_id = 'f7c739f0-881a-4633-8886-6758f6604469' and m.status = 'active'
   and m.employee_id = (select id from public.employee_directory_v where display_name = 'Abdullah Ashkanani'));
