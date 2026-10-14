-- Train-2 shutdown (plan f7c739f0, current rules, created in the app 14 Oct 2026), on the Section Head's instruction:
--   0. backup of every row touched (schema backup_20261014)
--   1. five pending annual leaves not approved by the Section Head: cancelled with history (the effect of leave_cancel:
--      status cancelled, out of the current plan, note, leave_plan_changes row). Oracle status NOT changed.
--   2. 3 on / 1 off for the whole shutdown (cycle_until = end date), as in the reviewed schedule.
--   3. the members' days set to the reviewed schedule (full 12-hour coverage); the previous rows stay in the backup.
--   4. the Section Head's conditional rest-day-pair exception for the Night Controller on 18-19 Oct.
-- Not approved: the plan stays draft / To Verify until the Oracle overtime and sick-leave figures are entered.
-- Applied once to production; the guards make a re-run fail rather than repeat it.
create schema if not exists backup_20261014;
create table backup_20261014.sd_plans as select * from public.sd_plans where id = 'f7c739f0-881a-4633-8886-6758f6604469';
create table backup_20261014.sd_days as select d.* from public.sd_days d join public.sd_members m on m.id = d.member_id where m.plan_id = 'f7c739f0-881a-4633-8886-6758f6604469';
create table backup_20261014.leave_records as select * from public.leave_records where id in ('095d90b2-94d8-430c-9c1d-3164d155b1b2','5f16b16b-0180-4e80-af82-fa5879cd2627','197d7bd0-63a8-4292-bcb7-48a243bc2cd0','1e83029b-dac8-4c90-ae2a-9f9397b068f9','2aae6396-3651-4fb6-b3a5-a7a7d6663afe');
revoke all on schema backup_20261014 from public, anon, authenticated;

do $$
declare
  v_head   constant uuid := '839d8dd0-58d6-4d7c-bd12-a248ad262074';
  v_plan   constant uuid := 'f7c739f0-881a-4633-8886-6758f6604469';
  v_reason constant text := 'Not approved by the Section Head: conflicts with the Train-2 shutdown (18 Oct - 16 Nov 2026). Recorded in the app on his instruction, 14 Oct 2026. Oracle not changed (still not submitted).';
  v_n int;
begin
  perform 1 from public.sd_plans where id = v_plan and status = 'active' and rules_version = 2 and approval_status = 'draft';
  if not found then raise exception 'Train-2 plan not active / not a draft on the current rules'; end if;

  with c as (
    update public.leave_records set in_current_plan = false, status = 'cancelled', hand_corrected = true,
      note = concat_ws(' | ', note, 'Cancelled by hand: ' || v_reason)
    where id in ('095d90b2-94d8-430c-9c1d-3164d155b1b2','5f16b16b-0180-4e80-af82-fa5879cd2627','197d7bd0-63a8-4292-bcb7-48a243bc2cd0','1e83029b-dac8-4c90-ae2a-9f9397b068f9','2aae6396-3651-4fb6-b3a5-a7a7d6663afe')
      and in_current_plan and status in ('approved','planned')
    returning *)
  insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, from_start, from_end, note, by_hand, created_by)
  select employee_id, 'cancelled', id, start_date, end_date, 'Cancelled by hand: ' || v_reason, true, v_head from c;
  get diagnostics v_n = row_count;
  if v_n <> 5 then raise exception 'expected 5 leave records, got %', v_n; end if;

  update public.sd_plans set cycle_until = end_date where id = v_plan;

  -- the reviewed days (18 Oct - 16 Nov, one character per day: L = 12-hour duty, . = off), set on the existing rows
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
    ('a0fae7c1-2238-42ee-b872-8179dc97f3f8'::uuid, 'LLL.LLL..LL.LLL..LL.LLL..LL.LL'),
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

  insert into public.sd_exceptions (plan_id, employee_id, kind, reason, approved_by, approved_at)
  values (v_plan, 'a0fae7c1-2238-42ee-b872-8179dc97f3f8', 'rest_day_pair',
    'Conditional Section Head exception: works both crew-B rest days 18-19 Oct 2026, the only Night Controller available (the VR Controller is on Oracle-approved leave to 19 Oct). Valid only while the 6-days-in-a-row limit, the shift-transition rest and the 72 h monthly limit including the Oracle overtime are all met; otherwise withdrawn and another Grade-15+ Controller assigned.',
    v_head, now());
end $$;
