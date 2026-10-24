-- Scope follows the existing rule that only the Section Head changes the equipment setup (tracked on / off):
-- out of scope and restore are the Section Head's; name, group and system may also be edited by Engineers (and
-- engineer links). Direct database work (no user, no link) passes. Out of scope needs a reason.
create or replace function public.trk_eq_guard() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare r text := public.app_current_role(); lnk uuid := public.trk_access_tracker(); sys boolean := auth.uid() is null and lnk is null;
begin
  if new.disabled_reason is distinct from old.disabled_reason and (coalesce(new.disabled_reason, '') like 'out of scope%' or coalesce(old.disabled_reason, '') like 'out of scope%')
     and not (sys or coalesce(r = 'section_head', false)) then
    raise exception 'Only the Section Head takes an item out of scope or restores it' using errcode = '42501';
  end if;
  if (new.description is distinct from old.description or new.grp is distinct from old.grp or new.system is distinct from old.system)
     and not (sys or coalesce(r in ('section_head', 'engineer'), false) or (r is null and lnk is not null and old.tracker_id = lnk)) then
    raise exception 'Only the Section Head or an Engineer changes an item''s name, group or system' using errcode = '42501';
  end if;
  if coalesce(new.disabled_reason, '') like 'out of scope%' and length(trim(substr(new.disabled_reason, 14))) < 3 then
    raise exception 'Write the reason for taking the item out of scope' using errcode = '23514';
  end if;
  if coalesce(new.disabled_reason, '') like 'out of scope%' and new.tracked then new.tracked := false; end if;
  return new;
end $function$;
revoke execute on function public.trk_eq_guard() from public, anon;
