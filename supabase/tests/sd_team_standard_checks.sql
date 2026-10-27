-- Shutdown team standard: open latest-rule train plans keep the standard places, older-rule plans keep theirs, a change of
-- the rule reaches the open plans. One transaction that always rolls back. Expected after sd_team_standard: every line PASS.
do $$
declare
  head uuid := (select auth_user_id from public.user_profiles where role_code = 'section_head' and is_active limit 1);
  cur uuid := (select id from sd_plans where rules_version = 2 and kind = 'train' and status = 'active' and approval_status <> 'approved' and end_date >= current_date order by start_date limit 1);
  old1 uuid := (select id from sd_plans where coalesce(rules_version, 1) = 1 order by start_date limit 1);
  t uuid := (select id from sd_teams where plan_id = cur order by sort limit 1);
  out text := ''; r text; n int;
begin
  out := out || case when public.sd_team_standard() = '{"controller":1,"senior":1,"good":1}'::jsonb then 'PASS standard from the latest rule is 1 · 1 · 1' else 'FAIL standard ' || public.sd_team_standard()::text end || E'\n';
  update sd_teams set senior_n = 3, good_n = 0, new_n = 1 where id = t;
  select controller_n||'/'||senior_n||'/'||good_n||'/'||new_n||'/'||ramp_senior_n into r from sd_teams where id = t;
  out := out || case when r = '1/1/1/1/1' then 'PASS open plan keeps the standard; New FO training place still per plan' else 'FAIL current ' || r end || E'\n';
  update sd_teams set senior_n = 5 where plan_id = old1 and sort = 0;
  select senior_n into n from sd_teams where plan_id = old1 and sort = 0;
  out := out || case when n = 5 then 'PASS older-rule plan keeps its own numbers' else 'FAIL older plan ' || n end || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', head, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  perform public.app_rule_set('sd.team_min', '{"controller":1,"experienced":1,"qualifiedFo":3}', 'test');
  execute 'reset role';
  select controller_n||'/'||senior_n||'/'||good_n||'/'||ramp_good_n into r from sd_teams where id = t;
  out := out || case when r = '1/1/2/2' then 'PASS changing the rule reaches the open plan (Good FO 2)' else 'FAIL follow ' || r end || E'\n';
  select count(*) into n from sd_teams where plan_id = old1 and good_n = 2 and senior_n = 5;
  out := out || case when n = 0 then 'PASS older-rule plan not touched by the rule change' else 'FAIL older touched' end || E'\n';
  raise exception E'RESULTS (rolled back)\n%', out;
end $$;
