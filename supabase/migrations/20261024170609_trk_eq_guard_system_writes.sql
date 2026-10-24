-- the scope / details guard applies to app users and links; direct database work (migrations, no user, no link) passes
create or replace function public.trk_eq_guard() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare r text := public.app_current_role(); lnk uuid := public.trk_access_tracker();
begin
  if (new.disabled_reason is distinct from old.disabled_reason and (coalesce(new.disabled_reason, '') like 'out of scope%' or coalesce(old.disabled_reason, '') like 'out of scope%'))
     or new.description is distinct from old.description or new.grp is distinct from old.grp or new.system is distinct from old.system then
    if not (coalesce(r in ('section_head', 'engineer'), false) or (r is null and lnk is not null and old.tracker_id = lnk) or (auth.uid() is null and lnk is null)) then
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
