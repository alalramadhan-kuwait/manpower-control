-- Equipment scope and editing (equipment screen):
--  · Out of scope = tracked off with disabled_reason 'out of scope: <reason>'; Restore = back on. Nothing is deleted;
--    the item's P6 activities stay as they are (the app leaves them out of the applicable scope while it is out).
--  · A step Not required keeps its reason: disabled_reason 'not required: <reason>'.
--  · History: scope, name / description, group and system changes on an item, and the reason of a step turned off,
--    go to trk_log like the other edits.
--  · Scope and detail changes are for the Section Head and Engineers (logins and engineer links); controllers and the
--    coordinator keep the field updates they have today. An out-of-scope change needs a reason.
create or replace function public.trk_log_change() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare who text := public.trk_who();
begin
  if tg_table_name = 'trk_steps' then
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'step', new.step_id, 'status', old.status, new.status, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.pending_reason is distinct from old.pending_reason then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'step', new.step_id, 'pending', old.pending_reason, new.pending_reason, auth.uid(), who); end if;
  elsif tg_table_name = 'trk_equipment' then
    if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'stage', old.stage::text, new.stage::text, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.pending_reason is distinct from old.pending_reason then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'pending', old.pending_reason, new.pending_reason, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.remark is distinct from old.remark then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'note', old.remark, new.remark, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.blinds_in_at is distinct from old.blinds_in_at then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'blinds_in', old.blinds_in_at::text, new.blinds_in_at::text, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.blinds_out_at is distinct from old.blinds_out_at then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'blinds_out', old.blinds_out_at::text, new.blinds_out_at::text, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.tracked is distinct from old.tracked then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason) values (new.tracker_id, 'equipment', new.tag, 'tracked', old.tracked::text, new.tracked::text, auth.uid(), who, new.disabled_reason); end if;
    if tg_op = 'UPDATE' and new.disabled_reason is distinct from old.disabled_reason then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'scope', old.disabled_reason, new.disabled_reason, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.description is distinct from old.description then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'description', old.description, new.description, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.grp is distinct from old.grp then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'group', old.grp, new.grp, auth.uid(), who); end if;
    if tg_op = 'UPDATE' and new.system is distinct from old.system then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'system', old.system, new.system, auth.uid(), who); end if;
  elsif tg_table_name = 'trk_iat' then
    if tg_op = 'INSERT' then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'iat', new.tag, 'iat', null, 'open ' || new.iat_no, auth.uid(), who);
    elsif new.status is distinct from old.status then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'iat', new.tag, 'iat', old.status || ' ' || old.iat_no, new.status || ' ' || new.iat_no, auth.uid(), who); end if;
  end if;
  return new;
end $function$;

create or replace function public.trk_log_activity() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare who text := public.trk_who(); r text := new.equipment_key || ' · ' || new.activity_id;
  why text := case when tg_op = 'UPDATE' then nullif(trim(coalesce(new.time_reason, '')), '') end;
begin
  if tg_op = 'INSERT' then
    -- a step added from the field (a bar-chart import is not logged line by line)
    if new.activity_id like 'ENG-%' then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', r, 'step added', null, new.activity, auth.uid(), who); end if;
    return new;
  end if;
  if new.actual_start is distinct from old.actual_start then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason) values (new.tracker_id, 'activity', r, 'actual_start', old.actual_start::text, new.actual_start::text, auth.uid(), who, why); end if;
  if new.actual_finish is distinct from old.actual_finish then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason) values (new.tracker_id, 'activity', r, 'actual_finish', old.actual_finish::text, new.actual_finish::text, auth.uid(), who, why); end if;
  if new.activity is distinct from old.activity then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', r, 'renamed', old.activity, new.activity, auth.uid(), who); end if;
  if new.tracked is distinct from old.tracked then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name, reason) values (new.tracker_id, 'activity', r, case when new.tracked then 'step on' else 'step off' end, null, new.activity, auth.uid(), who,
      case when new.tracked then null else new.disabled_reason end); end if;
  return new;
end $function$;

-- who may change an item's scope and details; an out-of-scope change needs a reason
create or replace function public.trk_eq_guard() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare r text := public.app_current_role();
begin
  if (new.disabled_reason is distinct from old.disabled_reason and (coalesce(new.disabled_reason, '') like 'out of scope%' or coalesce(old.disabled_reason, '') like 'out of scope%'))
     or new.description is distinct from old.description or new.grp is distinct from old.grp or new.system is distinct from old.system then
    if not (coalesce(r in ('section_head', 'engineer'), false) or (r is null and old.tracker_id = public.trk_access_tracker())) then
      raise exception 'Only the Section Head or an Engineer can change an item''s scope or details' using errcode = '42501';
    end if;
  end if;
  if coalesce(new.disabled_reason, '') like 'out of scope%' and length(trim(substr(new.disabled_reason, 14))) < 3 then
    raise exception 'Write the reason for taking the item out of scope' using errcode = '23514';
  end if;
  if coalesce(new.disabled_reason, '') like 'out of scope%' and new.tracked then new.tracked := false; end if;
  return new;
end $function$;
revoke execute on function public.trk_eq_guard() from public, anon;
create or replace trigger trk_equipment_guard before update on public.trk_equipment for each row execute function public.trk_eq_guard();
