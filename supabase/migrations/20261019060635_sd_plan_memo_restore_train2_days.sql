-- The instruction memo of a shutdown plan (Turnaround Manpower Coverage): its date, who signs it and the cc list, kept
-- on the plan; a new plan takes the signer and cc of the latest plan that has them.
-- Train-2 SD 2026: the five days set from the signed sheet on 19 Oct go back to the plan as it was (the plan is the
-- updated one: the transfer-rule days of 18 Oct and the day moved on 18 Oct were made after the sheet was issued).

alter table public.sd_plans add column if not exists memo jsonb not null default '{}'::jsonb;

create or replace function public.sd_plan_default_signatures() returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(jsonb_array_length(new.signatures), 0) = 0 then
    new.signatures := coalesce((select p.signatures from public.sd_plans p where jsonb_array_length(p.signatures) > 0
      order by p.created_at desc limit 1), '[]'::jsonb);
  end if;
  if new.memo is null or new.memo = '{}'::jsonb then
    new.memo := coalesce((select jsonb_strip_nulls(jsonb_build_object('signer', p.memo->'signer', 'cc', p.memo->'cc')) from public.sd_plans p
      where p.memo ? 'signer' order by p.created_at desc limit 1), '{}'::jsonb);
  end if;
  return new;
end $$;

-- memo of plan f7c739f0: date 2026-10-15, the Section Head as signer, cc Refinery Shift Leader, Controller-I (Area-4),
-- Operations Area-4 Controller (the signer's name is kept out of the repo: it is in sd_plans.memo)

update public.sd_days d set works = v.works, hours = v.hours, locked = v.locked, unavailable = false
  from (values
    ('bc0f1ba5-37e7-4f1d-b4c3-c5f658392493'::uuid, '2026-10-18'::date, false, null::numeric, false),
    ('bb40e77d-927b-4f01-9385-5bb577e3e600'::uuid, '2026-10-21'::date, true, 12::numeric, true),
    ('bb40e77d-927b-4f01-9385-5bb577e3e600'::uuid, '2026-10-30'::date, true, 8::numeric, true),
    ('52448e84-aa49-45f4-b71b-c96bd9eb0b03'::uuid, '2026-10-31'::date, true, 8::numeric, true),
    ('a1d90d2f-2745-4a3b-9d66-30dd25e414a4'::uuid, '2026-11-15'::date, true, 12::numeric, false)
  ) v(member_id, work_date, works, hours, locked)
 where d.member_id = v.member_id and d.work_date = v.work_date;
