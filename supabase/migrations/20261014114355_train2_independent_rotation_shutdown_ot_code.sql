-- Train-2 (plan f7c739f0), Section Head release 14 Oct 2026: independent strict 3 on / 1 off for every member and the
-- shutdown overtime code (4 h per 12 h duty, computed in the app / sd-plan-approve). The Night Controller's (a0fa) extra
-- OFF day on 26 Oct is removed (strict 3/1 again); the change is recorded in the plan note and the audit log.
-- Backup of the previous version (314 working days): backup_20261014e.sd_days / sd_plans (taken first).
-- Applied with execute_sql in two batches (the single migration hit the tool timeout); 154 rows changed, 313 working days.
-- Not approved: the plan stays draft / To Verify; Oracle figures stay unknown.
create schema if not exists backup_20261014e;
create table if not exists backup_20261014e.sd_plans as select * from public.sd_plans where id = 'f7c739f0-881a-4633-8886-6758f6604469';
create table if not exists backup_20261014e.sd_days as select d.* from public.sd_days d join public.sd_members m on m.id = d.member_id where m.plan_id = 'f7c739f0-881a-4633-8886-6758f6604469';
revoke all on schema backup_20261014e from public, anon, authenticated;

with v(emp, p) as (values
  ('e143cdb1-fbf4-43aa-bf86-0e8a34b545b3'::uuid, 'LLL.LLL.LLL.LLL.LLL.LLL.LLL.LL'),
  ('acfb9a71-119b-413e-8f42-7816b43cda3d'::uuid, '.LLL.LLL.LLL.LLL.LLL.LLL.LLL.L'),
  ('d0afdcfd-224e-48a9-b296-cccdc1e9b1cb'::uuid, 'LLL.LLL.LLL.LLL.LLL.LLL.LLL.LL'),
  ('2ce36422-0b35-4c7a-8cee-e4dea07f2383'::uuid, 'LL.LLL.LLL.LLL.LLL.LLL.LLL.LLL'),
  ('ca232dd9-2970-48b3-ac42-3c0056ceabb3'::uuid, '.LLL.LLL.LLL.LLL.LLL.LLL.LLL.L'),
  ('1f6ded01-4d4d-4525-a4a2-a2820d888fe0'::uuid, '.LLL.LLL.LLL.LLL.LLL.LLL.LLL.L'),
  ('6a2e4c7f-5422-4e12-a1d6-6d33a0bed549'::uuid, 'L.LLL.LLL.LLL.LLL.LLL.LLL.LLL.'),
  ('a0fae7c1-2238-42ee-b872-8179dc97f3f8'::uuid, 'LLL.LLL.LLL.LLL.LLL.LLL.LLL.LL'),
  ('f308ac65-f35d-4393-8268-15ae40070b91'::uuid, '..LL.LLL.LLL.LLL.LLL.LLL.LLL.L'),
  ('358ffc05-fae2-4ae4-ac50-ba3becc7f2bb'::uuid, 'LLL.LLL.LLL.LLL.LLL.LLL.LLL.LL'),
  ('f27f2d9a-0f41-4d95-b2a8-cda3a3314316'::uuid, '.LLL.LLL.LLL.LLL.LLL.LLL.LLL.L'),
  ('061dce34-f3ca-4196-b5e2-b2d886aaf994'::uuid, '.LLL.LLL.LLL.LLL.LLL.LLL.LLL.L'),
  ('aa2db1cc-a033-46f3-9c2b-825242f51fe8'::uuid, 'L.LLL.LLL.LLL.LLL.LLL.LLL.LLL.'),
  ('58dbc570-0846-4b4e-99bf-98f809c4c1c1'::uuid, 'LL.LLL.LLL.LLL.LLL.LLL.LLL.LLL'))
update public.sd_days d set works = substr(v.p, (d.work_date - date '2026-10-18') + 1, 1) = 'L',
  hours = case when substr(v.p, (d.work_date - date '2026-10-18') + 1, 1) = 'L' then 12 end
from public.sd_members m, v
where m.id = d.member_id and v.emp = m.employee_id and m.plan_id = 'f7c739f0-881a-4633-8886-6758f6604469' and m.status = 'active'
  and d.work_date between date '2026-10-18' and date '2026-11-16'
  and d.works is distinct from (substr(v.p, (d.work_date - date '2026-10-18') + 1, 1) = 'L');

update public.sd_plans set note = concat_ws(' | ', note, '14 Oct 2026: recalculated on the independent 3 on / 1 off rotation and the shutdown overtime code (4 h per 12 h duty). The 26 Oct extra OFF day for the Night Controller (a0fa) is removed: back on strict 3/1. Previous version kept in backup_20261014e.')
where id = 'f7c739f0-881a-4633-8886-6758f6604469' and approval_status = 'draft' and note not like '%26 Oct extra OFF day%';
