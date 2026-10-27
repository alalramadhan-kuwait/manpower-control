-- Shutdown manpower is one standard (owner, 27 Oct 2026: "Standard", "Follow the latest SD rules"). The latest rules
-- (final, 14 Oct 2026): every minute of each 12-hour team shift has 1 qualified Controller, 1 Experienced FO and 2
-- qualified FOs (Experienced or Good); a New FO never counts. So the places of each team are 1 Controller, 1 Senior FO
-- and qualified − experienced Good FO, the same on full and reduced days, from the Rules page rule 'sd.team_min'.
-- Applies to train shutdown plans on the latest rules (rules_version 2) that are not approved and not finished; the
-- New FO place stays a per-plan training choice. Plans on the older rules, approved or finished plans keep theirs.

create or replace function public.sd_team_standard() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'controller', coalesce((value->>'controller')::int, 1),
    'senior', coalesce((value->>'experienced')::int, 1),
    'good', greatest(coalesce((value->>'qualifiedFo')::int, 2) - coalesce((value->>'experienced')::int, 1), 0))
  from public.app_rules where key = 'sd.team_min'
$$;
revoke execute on function public.sd_team_standard() from public, anon;
grant execute on function public.sd_team_standard() to authenticated, service_role;

-- every insert or change of a team of an open latest-rule train plan keeps the standard places
create or replace function public.sd_team_keep_standard() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare s jsonb;
begin
  if exists (select 1 from public.sd_plans p where p.id = new.plan_id and coalesce(p.rules_version, 1) >= 2 and p.kind = 'train'
             and coalesce(p.approval_status, 'draft') <> 'approved' and p.end_date >= current_date) then
    s := public.sd_team_standard();
    if s is not null then
      new.controller_n := (s->>'controller')::int; new.senior_n := (s->>'senior')::int; new.good_n := (s->>'good')::int;
      new.ramp_controller_n := (s->>'controller')::int; new.ramp_senior_n := (s->>'senior')::int; new.ramp_good_n := (s->>'good')::int;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.sd_team_keep_standard() from public, anon;
create trigger sd_teams_standard before insert or update on public.sd_teams for each row execute function public.sd_team_keep_standard();

-- a change of the rule reaches the open plans (only the teams that differ, so nothing else is touched)
create or replace function public.app_rules_sd_team_follow() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare s jsonb := public.sd_team_standard();
begin
  update public.sd_teams t set controller_n = t.controller_n
  from public.sd_plans p
  where p.id = t.plan_id and coalesce(p.rules_version, 1) >= 2 and p.kind = 'train' and coalesce(p.approval_status, 'draft') <> 'approved' and p.end_date >= current_date
    and (t.controller_n, t.senior_n, t.good_n, t.ramp_controller_n, t.ramp_senior_n, t.ramp_good_n)
        is distinct from ((s->>'controller')::int, (s->>'senior')::int, (s->>'good')::int, (s->>'controller')::int, (s->>'senior')::int, (s->>'good')::int);
  return null;
end $$;
revoke execute on function public.app_rules_sd_team_follow() from public, anon;
create trigger app_rules_sd_team_follow after update of value on public.app_rules for each row when (new.key = 'sd.team_min' and new.value is distinct from old.value)
  execute function public.app_rules_sd_team_follow();
