-- Rules page: who may change a rule, the ranges, the history, where each rule is written, and that the old direct paths
-- are closed. Runs as the Section Head, a Manpower Coordinator and anon inside ONE transaction that always rolls back
-- (the block ends with an exception carrying the results), so nothing changes. Expected after migration app_rules:
-- every line PASS.
do $$
declare
  head uuid := (select auth_user_id from public.user_profiles where role_code = 'section_head' and is_active limit 1);
  coord uuid := (select auth_user_id from public.user_profiles where role_code = 'manpower_coordinator' and is_active limit 1);
  out text := ''; n int; v jsonb; sd_open uuid; sd_done uuid;
begin
  sd_open := (select id from public.sd_plans where status = 'active' and end_date >= current_date and approval_status <> 'approved' limit 1);
  sd_done := (select id from public.sd_plans where approval_status = 'approved' limit 1);

  -- coordinator: refused
  perform set_config('request.jwt.claims', json_build_object('sub', coord, 'role', 'authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.app_rule_set('trk.stale', '{"critical":5,"normal":12,"small":24}', 'test'); out := out || 'FAIL coordinator changed a rule' || E'\n';
  exception when others then out := out || 'PASS coordinator refused' || E'\n'; end;
  begin update public.app_rules set value = '{"panelSeats":6}' where key = 'leave.pv_seats'; get diagnostics n = row_count;
    out := out || case when n = 0 then 'PASS coordinator cannot write app_rules directly' else 'FAIL coordinator wrote app_rules' end || E'\n';
  exception when others then out := out || 'PASS coordinator cannot write app_rules directly' || E'\n'; end;
  select count(*) into n from public.app_rules; out := out || case when n >= 21 then 'PASS coordinator reads the rules' else 'FAIL coordinator reads ' || n end || E'\n';

  -- Section Head
  perform set_config('request.jwt.claims', json_build_object('sub', head, 'role', 'authenticated')::text, true);
  begin perform public.app_rule_set('trk.stale', '{"critical":5,"normal":12,"small":24}', ''); out := out || 'FAIL change without reason accepted' || E'\n';
  exception when others then out := out || 'PASS reason required' || E'\n'; end;
  begin perform public.app_rule_set('trk.stale', '{"critical":500,"normal":12,"small":24}', 'test'); out := out || 'FAIL out of range accepted' || E'\n';
  exception when others then out := out || 'PASS out of range refused' || E'\n'; end;
  begin perform public.app_rule_set('sd.ot_month', '{"warn":90,"hard":80}', 'test'); out := out || 'FAIL warn above hard accepted' || E'\n';
  exception when others then out := out || 'PASS warn above hard refused' || E'\n'; end;
  begin perform public.app_rule_set('vac.periods', '{"min":4,"max":5}', 'test'); out := out || 'FAIL nothing changed accepted' || E'\n';
  exception when others then out := out || 'PASS nothing changed refused' || E'\n'; end;
  begin perform public.app_rule_set('vac.periods', '{"min":4,"max":5,"x":1}', 'test'); out := out || 'FAIL extra part accepted' || E'\n';
  exception when others then out := out || 'PASS extra part refused' || E'\n'; end;
  begin perform public.app_rule_set('chk.shift_times', '{"M":"7am","A":"15:00","N":"23:00","hours":8,"dayDutyStart":"07:00","dayDutyHours":8}', 'test'); out := out || 'FAIL bad time accepted' || E'\n';
  exception when others then out := out || 'PASS bad time refused' || E'\n'; end;
  begin perform public.app_rule_set('nope.rule', '{"a":1}', 'test'); out := out || 'FAIL unknown rule accepted' || E'\n';
  exception when others then out := out || 'PASS unknown rule refused' || E'\n'; end;

  begin perform public.app_rule_set('trk.stale', '{"critical":5,"normal":12,"small":24}', 'test change');
    out := out || case when (select value->>'critical' from public.app_rules where key = 'trk.stale') = '5' and exists (select 1 from public.app_rule_changes where key = 'trk.stale' and reason = 'test change' and old_value->>'critical' = '6')
      and (select updated_by from public.app_rules where key = 'trk.stale') = head then 'PASS app_rules rule changed, history kept' else 'FAIL app_rules change' end || E'\n';
  exception when others then out := out || 'FAIL app_rules change: ' || sqlerrm || E'\n'; end;
  begin perform public.app_rule_set('vac.periods', '{"min":3,"max":6}', 'test');
    out := out || case when public.pv_rule('max') = 6 then 'PASS the vacation plan reads the periods rule' else 'FAIL pv_rule' end || E'\n';
  exception when others then out := out || 'FAIL vac.periods: ' || sqlerrm || E'\n'; end;
  begin perform public.app_rule_set('crew.section.train_1', '{"panel":2,"field":3}', 'test');
    out := out || case when (select panel_min || '/' || field_min from public.unit_sections where code = 'train_1') = '2/3' then 'PASS section minimum written to unit_sections' else 'FAIL section' end || E'\n';
  exception when others then out := out || 'FAIL section: ' || sqlerrm || E'\n'; end;
  begin perform public.app_rule_set('crew.mode.full_operation', '{"controller":1,"panel":4,"field":7}', 'test');
    out := out || case when (select panel_min || '/' || field_min from public.operating_modes where code = 'full_operation') = '4/7' then 'PASS mode minimum written to operating_modes' else 'FAIL mode' end || E'\n';
  exception when others then out := out || 'FAIL mode: ' || sqlerrm || E'\n'; end;
  begin perform public.app_rule_set('ctl.cover_max', '{"days":30}', 'test');
    out := out || case when (select shift_cover_max_days from public.controller_rules where id = 1) = 30 then 'PASS cover length written to controller_rules' else 'FAIL cover' end || E'\n';
  exception when others then out := out || 'FAIL cover: ' || sqlerrm || E'\n'; end;
  begin perform public.app_rule_set('chk.min_rest', '{"hours":10}', 'test');
    out := out || case when (select enabled and (params->>'hours')::int = 10 from public.validation_rules where code = 'min_rest_hours') then 'PASS min rest switched on in validation_rules' else 'FAIL min rest' end || E'\n';
  exception when others then out := out || 'FAIL min rest: ' || sqlerrm || E'\n'; end;
  begin perform public.app_rule_set('sd.ot_month', '{"warn":70,"hard":78}', 'test');
    out := out || case when (sd_open is null or (select max_overtime = 70 and max_overtime_hard = 78 from public.sd_plans where id = sd_open))
      and (sd_done is null or (select max_overtime <> 70 or max_overtime is null from public.sd_plans where id = sd_done))
      then 'PASS overtime reaches open plans only' || case when sd_open is null then ' (no open plan to check)' else '' end else 'FAIL overtime plans' end || E'\n';
  exception when others then out := out || 'FAIL overtime: ' || sqlerrm || E'\n'; end;
  -- the history cannot be rewritten, the old direct paths are closed
  begin update public.app_rule_changes set reason = 'x'; get diagnostics n = row_count; out := out || case when n = 0 then 'PASS history not editable' else 'FAIL history edited' end || E'\n';
  exception when others then out := out || 'PASS history not editable' || E'\n'; end;
  begin update public.unit_sections set panel_min = 9 where code = 'train_2'; out := out || 'FAIL direct unit_sections update allowed' || E'\n';
  exception when others then out := out || 'PASS direct unit_sections update closed' || E'\n'; end;
  begin update public.controller_rules set shift_cover_max_days = 9 where id = 1; out := out || 'FAIL direct controller_rules update allowed' || E'\n';
  exception when others then out := out || 'PASS direct controller_rules update closed' || E'\n'; end;

  -- anon
  execute 'reset role'; perform set_config('request.jwt.claims', '{"role":"anon"}', true); execute 'set local role anon';
  begin select count(*) into n from public.app_rules; out := out || case when n = 0 then 'PASS anon reads nothing' else 'FAIL anon reads rules' end || E'\n';
  exception when others then out := out || 'PASS anon reads nothing' || E'\n'; end;
  begin perform public.app_rule_set('trk.stale', '{"critical":5,"normal":12,"small":24}', 'test'); out := out || 'FAIL anon changed a rule' || E'\n';
  exception when others then out := out || 'PASS anon refused' || E'\n'; end;
  execute 'reset role';
  raise exception E'RESULTS (rolled back)\n%', out;
end $$;
