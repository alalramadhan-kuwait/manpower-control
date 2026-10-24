-- Equipment list: where an item is shown. Items whose work is only cleaning, servicing, filter / oil change or routine
-- rotating maintenance (no independent inspection or handover of their own) are listed under "Rotating scope" instead of
-- the main Equipment list. Display only: steps, P6 ids, hours, progress, handover, history and calculations unchanged.
alter table public.trk_equipment add column if not exists list text check (list is null or list in ('rotating'));
comment on column public.trk_equipment.list is 'Where the item is listed: null = Equipment, rotating = Rotating scope. Display only.';
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
    if tg_op = 'UPDATE' and new.list is distinct from old.list then
      insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name) values (new.tracker_id, 'equipment', new.tag, 'list', old.list, new.list, auth.uid(), who); end if;
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

create or replace function public.trk_eq_guard() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare r text := public.app_current_role(); lnk uuid := public.trk_access_tracker(); sys boolean := auth.uid() is null and lnk is null;
begin
  if new.disabled_reason is distinct from old.disabled_reason and (coalesce(new.disabled_reason, '') like 'out of scope%' or coalesce(old.disabled_reason, '') like 'out of scope%')
     and not (sys or coalesce(r = 'section_head', false)) then
    raise exception 'Only the Section Head takes an item out of scope or restores it' using errcode = '42501';
  end if;
  if (new.description is distinct from old.description or new.grp is distinct from old.grp or new.system is distinct from old.system or new.list is distinct from old.list)
     and not (sys or coalesce(r in ('section_head', 'engineer'), false) or (r is null and lnk is not null and old.tracker_id = lnk)) then
    raise exception 'Only the Section Head or an Engineer changes an item''s name, group, system or list' using errcode = '42501';
  end if;
  if coalesce(new.disabled_reason, '') like 'out of scope%' and length(trim(substr(new.disabled_reason, 14))) < 3 then
    raise exception 'Write the reason for taking the item out of scope' using errcode = '23514';
  end if;
  if coalesce(new.disabled_reason, '') like 'out of scope%' and new.tracked then new.tracked := false; end if;
  return new;
end $function$;
revoke execute on function public.trk_eq_guard() from public, anon;

-- C-12-201 compressor system and the other rotating machines: routine-only items (step by step review, 24 Oct)
update public.trk_equipment set list = 'rotating'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and list is null
   and tag in ('C-12-201-E-01A/B', 'P-12-2085-GR1', 'C-12-201-ST on-site checks', 'C-12-201 LO system', 'C-12-201-E-03', 'C-12-201-EJ-01',
               'C-12-201-F-03A/B', 'P-12-203', 'P-12-205', 'P-12-207A/B');
