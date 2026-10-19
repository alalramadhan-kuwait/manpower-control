-- Train-2 SD 2026 matched to the signed overtime sheet (issued 14 Oct 2026): the signatures as signed, the days that
-- differed from the sheet, and a new plan with no signatures takes those of the latest plan that has them.
-- The move of two field operators to the other group from 1 Nov is the next migration.

create or replace function public.sd_plan_default_signatures() returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(jsonb_array_length(new.signatures), 0) = 0 then
    new.signatures := coalesce((select p.signatures from public.sd_plans p where jsonb_array_length(p.signatures) > 0
      order by p.created_at desc limit 1), '[]'::jsonb);
  end if;
  return new;
end $$;
create trigger sd_plans_default_signatures before insert on public.sd_plans for each row execute function public.sd_plan_default_signatures();

-- signatures of plan f7c739f0 set to the two signatories of the signed sheet (Team Leader, Operations, Area-4 and
-- Manager, Operations - MAB). The names are kept out of the repo: they are in sd_plans.signatures.

-- five days as on the sheet: one works 18 Oct, one off 21 Oct and 12 h on 30 Oct, one 12 h on 31 Oct, one off 15 Nov (locked)
insert into public.sd_days (member_id, work_date, works, hours, locked) values
  ('bc0f1ba5-37e7-4f1d-b4c3-c5f658392493', '2026-10-18', true, 12, true),
  ('bb40e77d-927b-4f01-9385-5bb577e3e600', '2026-10-21', false, null, true),
  ('bb40e77d-927b-4f01-9385-5bb577e3e600', '2026-10-30', true, 12, true),
  ('52448e84-aa49-45f4-b71b-c96bd9eb0b03', '2026-10-31', true, 12, true),
  ('a1d90d2f-2745-4a3b-9d66-30dd25e414a4', '2026-11-15', false, null, true)
on conflict (member_id, work_date) do update set works = excluded.works, hours = excluded.hours, locked = true, unavailable = false;
