-- The change log covers every edit (Section Head, 23 Oct: see who edits what). Added: an item's note, a work step
-- renamed / added / taken off, an issue's text edited, the shift's bed temperatures and notes.
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
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'tracked', old.tracked::text, new.tracked::text, auth.uid(), who); end if;
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
begin
  if tg_op = 'INSERT' then
    -- a step added from the field (a bar-chart import is not logged line by line)
    if new.activity_id like 'ENG-%' then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', r, 'step added', null, new.activity, auth.uid(), who); end if;
    return new;
  end if;
  if new.actual_start is distinct from old.actual_start then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', r, 'actual_start', old.actual_start::text, new.actual_start::text, auth.uid(), who); end if;
  if new.actual_finish is distinct from old.actual_finish then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', r, 'actual_finish', old.actual_finish::text, new.actual_finish::text, auth.uid(), who); end if;
  if new.activity is distinct from old.activity then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', r, 'renamed', old.activity, new.activity, auth.uid(), who); end if;
  if new.tracked is distinct from old.tracked then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'activity', r, case when new.tracked then 'step on' else 'step off' end, null, new.activity, auth.uid(), who); end if;
  return new;
end $function$;
create or replace trigger trk_activities_log_insert after insert on public.trk_activities for each row execute function public.trk_log_activity();

create or replace function public.trk_event_stamp() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if tg_op = 'INSERT' then
    new.by_user := auth.uid(); new.by_name := public.trk_who();
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'event', coalesce(new.equipment_key, new.category), 'event', null, new.text, auth.uid(), public.trk_who());
  else
    new.updated_at := now();
    if new.ended_at is distinct from old.ended_at then
      new.ended_by_name := case when new.ended_at is null then null else public.trk_who() end;
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
      values (new.tracker_id, 'event', coalesce(new.equipment_key, new.category), case when new.ended_at is null then 'event reopened' else 'event ended' end, null, new.text, auth.uid(), public.trk_who());
    end if;
    if new.text is distinct from old.text then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
      values (new.tracker_id, 'event', coalesce(new.equipment_key, new.category), 'event edited', old.text, new.text, auth.uid(), public.trk_who());
    end if;
  end if;
  return new;
end $function$;

-- the shift's bed temperatures and notes
create or replace function public.trk_shift_log_log() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare r text := new.shift_date::text || ' ' || new.shift; o_temps jsonb; o_notes text;
begin
  if tg_op = 'UPDATE' then o_temps := old.temps; o_notes := old.notes; end if;
  if new.temps is distinct from o_temps and new.temps is not null and new.temps <> '{}'::jsonb then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'shift', r, 'temperatures', o_temps::text, new.temps::text, auth.uid(), public.trk_who());
  end if;
  if coalesce(new.notes, '') is distinct from coalesce(o_notes, '') then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'shift', r, 'notes', o_notes, new.notes, auth.uid(), public.trk_who());
  end if;
  return new;
end $function$;
create or replace trigger trk_shift_log_log after insert or update on public.trk_shift_log for each row execute function public.trk_shift_log_log();
