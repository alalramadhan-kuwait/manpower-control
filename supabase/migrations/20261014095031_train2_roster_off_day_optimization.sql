-- Train-2 (plan f7c739f0), Section Head approval 14 Oct 2026: the planner's roster-OFF-day rule applied to the live plan.
-- A 12 h duty on a roster OFF day stays only where the minimum needs that person; otherwise moved to a roster duty day
-- or given back (42 duties: 41 given back, 1 moved). Full minimum every minute; no rest rule broken. Not approved:
-- the plan stays draft / To Verify until the Oracle figures are entered. Previous days kept in backup_20261014b.
create schema if not exists backup_20261014b;
create table backup_20261014b.sd_days as select d.* from public.sd_days d join public.sd_members m on m.id = d.member_id where m.plan_id = 'f7c739f0-881a-4633-8886-6758f6604469';
revoke all on schema backup_20261014b from public, anon, authenticated;

do $$
declare v_plan constant uuid := 'f7c739f0-881a-4633-8886-6758f6604469'; v_n int;
begin
  perform 1 from public.sd_plans where id = v_plan and status = 'active' and rules_version = 2 and approval_status = 'draft';
  if not found then raise exception 'Train-2 plan not active / not a draft on the current rules'; end if;
  update public.sd_days d set works = substr(v.p, (d.work_date - date '2026-10-18') + 1, 1) = 'L',
    hours = case when substr(v.p, (d.work_date - date '2026-10-18') + 1, 1) = 'L' then 12 end
  from public.sd_members sm, (values
    ('e143cdb1-fbf4-43aa-bf86-0e8a34b545b3'::uuid, '.LLL..LL.LLL..LL.LLL..LL.LLL..'),
    ('acfb9a71-119b-413e-8f42-7816b43cda3d'::uuid, 'LL..LLL.LL..LLL.LL..LLL.LL..LL'),
    ('d0afdcfd-224e-48a9-b296-cccdc1e9b1cb'::uuid, 'LLLL..LLL.LL..LLL.LL..LLL.LL..'),
    ('2ce36422-0b35-4c7a-8cee-e4dea07f2383'::uuid, 'LLL.LL..LLL.LL..LLL.LL..LLL.LL'),
    ('ca232dd9-2970-48b3-ac42-3c0056ceabb3'::uuid, 'LL..LLL.LL..LLL.LL..LLL.LL..LL'),
    ('1f6ded01-4d4d-4525-a4a2-a2820d888fe0'::uuid, 'LLL.LLL.LLL.LLL.LLL.LLL.LLL.LL'),
    ('6a2e4c7f-5422-4e12-a1d6-6d33a0bed549'::uuid, 'LL.LLL.LLL.LLL.LLL.LLL.LLL.LLL'),
    ('a0fae7c1-2238-42ee-b872-8179dc97f3f8'::uuid, 'LLL.LLL...L.LLL...L.LLL...L.LL'),
    ('f308ac65-f35d-4393-8268-15ae40070b91'::uuid, '...LLL.LLL.LLL.LLL.LLL.LLL.LLL'),
    ('358ffc05-fae2-4ae4-ac50-ba3becc7f2bb'::uuid, 'L.LL..LLL.LL..LLL.LL..LLL.LL..'),
    ('f27f2d9a-0f41-4d95-b2a8-cda3a3314316'::uuid, 'LL..LLL.LL..LLL.LL..LLL.LL..LL'),
    ('061dce34-f3ca-4196-b5e2-b2d886aaf994'::uuid, '..LL.LLL..LL.LLL..LL.LLL..LL.L'),
    ('aa2db1cc-a033-46f3-9c2b-825242f51fe8'::uuid, 'L.LL..LLL.LL..LLL.LL..LLL.LL..'),
    ('58dbc570-0846-4b4e-99bf-98f809c4c1c1'::uuid, 'LL..LL.LLL..LL.LLL..LL.LLL..LL')
  ) as v(emp, p)
  where d.member_id = sm.id and sm.plan_id = v_plan and sm.status = 'active' and sm.employee_id = v.emp
    and d.work_date between date '2026-10-18' and date '2026-11-16';
  get diagnostics v_n = row_count;
  if v_n <> 420 then raise exception 'expected 420 day rows, got %', v_n; end if;
  select count(*) into v_n from public.sd_days d join public.sd_members m on m.id = d.member_id where m.plan_id = v_plan and m.status = 'active' and d.works;
  if v_n <> 271 then raise exception 'expected 271 working days, got %', v_n; end if;
end $$;
