-- Train-2 (plan f7c739f0), Section Head approval 14 Oct 2026: the independent shutdown rotation, strict 3 on / 1 off
-- with 12-hour duties for every employee (staggered offsets). One documented exception: Night Controller a0fa has one
-- extra day off on 26 Oct, then 3 on / 1 off again, because strict 3/1 would put him at 84 h in November (over the 80 h
-- limit), not because of his crew rest days. 314 working days; minimum held every minute. Not approved: draft /
-- To Verify. Previous rows kept in backup_20261014d.
create schema if not exists backup_20261014d;
create table backup_20261014d.sd_days as select d.* from public.sd_days d join public.sd_members m on m.id = d.member_id where m.plan_id = 'f7c739f0-881a-4633-8886-6758f6604469';
revoke all on schema backup_20261014d from public, anon, authenticated;
do $$
declare v_plan constant uuid := 'f7c739f0-881a-4633-8886-6758f6604469'; v_n int;
begin
  perform 1 from public.sd_plans where id = v_plan and status = 'active' and rules_version = 2 and approval_status = 'draft';
  if not found then raise exception 'Train-2 plan not an active draft on the current rules'; end if;
  update public.sd_days d set works = substr(v.p, (d.work_date - date '2026-10-18') + 1, 1) = 'L',
    hours = case when substr(v.p, (d.work_date - date '2026-10-18') + 1, 1) = 'L' then 12 end
  from public.sd_members sm, (values
    ('e143cdb1-fbf4-43aa-bf86-0e8a34b545b3'::uuid, '.LLL.LLL.LLL.LLL.LLL.LLL.LLL.L'),
    ('acfb9a71-119b-413e-8f42-7816b43cda3d'::uuid, 'LLL.LLL.LLL.LLL.LLL.LLL.LLL.LL'),
    ('d0afdcfd-224e-48a9-b296-cccdc1e9b1cb'::uuid, 'L.LLL.LLL.LLL.LLL.LLL.LLL.LLL.'),
    ('2ce36422-0b35-4c7a-8cee-e4dea07f2383'::uuid, 'LLL.LLL.LLL.LLL.LLL.LLL.LLL.LL'),
    ('ca232dd9-2970-48b3-ac42-3c0056ceabb3'::uuid, 'LLL.LLL.LLL.LLL.LLL.LLL.LLL.LL'),
    ('1f6ded01-4d4d-4525-a4a2-a2820d888fe0'::uuid, 'LLL.LLL.LLL.LLL.LLL.LLL.LLL.LL'),
    ('6a2e4c7f-5422-4e12-a1d6-6d33a0bed549'::uuid, 'LL.LLL.LLL.LLL.LLL.LLL.LLL.LLL'),
    ('a0fae7c1-2238-42ee-b872-8179dc97f3f8'::uuid, 'LLL.LLL..LLL.LLL.LLL.LLL.LLL.L'),
    ('f308ac65-f35d-4393-8268-15ae40070b91'::uuid, '...LLL.LLL.LLL.LLL.LLL.LLL.LLL'),
    ('358ffc05-fae2-4ae4-ac50-ba3becc7f2bb'::uuid, 'L.LLL.LLL.LLL.LLL.LLL.LLL.LLL.'),
    ('f27f2d9a-0f41-4d95-b2a8-cda3a3314316'::uuid, 'LLL.LLL.LLL.LLL.LLL.LLL.LLL.LL'),
    ('061dce34-f3ca-4196-b5e2-b2d886aaf994'::uuid, '.LLL.LLL.LLL.LLL.LLL.LLL.LLL.L'),
    ('aa2db1cc-a033-46f3-9c2b-825242f51fe8'::uuid, 'L.LLL.LLL.LLL.LLL.LLL.LLL.LLL.'),
    ('58dbc570-0846-4b4e-99bf-98f809c4c1c1'::uuid, 'LL.LLL.LLL.LLL.LLL.LLL.LLL.LLL')
  ) as v(emp, p)
  where d.member_id = sm.id and sm.plan_id = v_plan and sm.status = 'active' and sm.employee_id = v.emp
    and d.work_date between date '2026-10-18' and date '2026-11-16';
  get diagnostics v_n = row_count;
  if v_n <> 420 then raise exception 'expected 420 day rows, got %', v_n; end if;
  select count(*) into v_n from public.sd_days d join public.sd_members m on m.id = d.member_id where m.plan_id = v_plan and m.status = 'active' and d.works;
  if v_n <> 314 then raise exception 'expected 314 working days, got %', v_n; end if;
end $$;
