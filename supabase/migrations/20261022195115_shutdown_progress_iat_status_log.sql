-- IAT status set in the app (New IAT, To start, In progress, Hold, Completed, Cancelled) and its remark: logged with who and when
create or replace function public.trk_iat_status_log()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.sheet_status is distinct from old.sheet_status then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'iat', new.iat_no, 'iat status', old.sheet_status, new.sheet_status, auth.uid(), public.trk_who());
  end if;
  if new.remark is distinct from old.remark then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'iat', new.iat_no, 'iat remark', old.remark, new.remark, auth.uid(), public.trk_who());
  end if;
  return new;
end $function$;

create or replace trigger trk_iat_status_log after update of sheet_status, remark on public.trk_iat
  for each row execute function public.trk_iat_status_log();
