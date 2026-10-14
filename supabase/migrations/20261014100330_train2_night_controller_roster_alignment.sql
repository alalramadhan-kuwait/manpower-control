-- Train-2 (plan f7c739f0), Section Head approval 14 Oct 2026: Night Controller a0fa aligned to his crew-B roster
-- (3 on / 1 off / 2 on / roster OFF pair), +2 days on roster duty days, every night still has a Controller.
-- Not approved: draft / To Verify. Previous rows kept in backup_20261014c.
create schema if not exists backup_20261014c;
create table backup_20261014c.sd_days as select d.* from public.sd_days d join public.sd_members m on m.id = d.member_id
  where m.plan_id = 'f7c739f0-881a-4633-8886-6758f6604469' and m.employee_id = 'a0fae7c1-2238-42ee-b872-8179dc97f3f8';
revoke all on schema backup_20261014c from public, anon, authenticated;
do $$
declare v_plan constant uuid := 'f7c739f0-881a-4633-8886-6758f6604469'; v_p constant text := 'LLL.LLL...LLL.LL..LLL.LL..LLL.'; v_n int;
begin
  perform 1 from public.sd_plans where id = v_plan and status = 'active' and approval_status = 'draft';
  if not found then raise exception 'Train-2 plan not an active draft'; end if;
  update public.sd_days d set works = substr(v_p, (d.work_date - date '2026-10-18') + 1, 1) = 'L',
    hours = case when substr(v_p, (d.work_date - date '2026-10-18') + 1, 1) = 'L' then 12 end
  from public.sd_members sm
  where d.member_id = sm.id and sm.plan_id = v_plan and sm.status = 'active' and sm.employee_id = 'a0fae7c1-2238-42ee-b872-8179dc97f3f8'
    and d.work_date between date '2026-10-18' and date '2026-11-16';
  get diagnostics v_n = row_count;
  if v_n <> 30 then raise exception 'expected 30 rows, got %', v_n; end if;
  select count(*) into v_n from public.sd_days d join public.sd_members m on m.id = d.member_id where m.plan_id = v_plan and m.status = 'active' and d.works;
  if v_n <> 273 then raise exception 'expected 273 working days, got %', v_n; end if;
end $$;
