-- A step measured by a count (owner, 31 Oct 2026: "add the total RT required and total completed … from this
-- percentage … the progress on this step"): total, done and what is counted (joints). The step's progress is done /
-- total; the forecast takes its remaining planned hours in that share. Every change is logged.
alter table public.trk_activities add column if not exists count_total integer, add column if not exists count_done integer, add column if not exists count_unit text;
alter table public.trk_activities add constraint trk_activities_count_check check (
  (count_total is null or count_total between 1 and 100000) and (count_done is null or count_done >= 0)
  and (count_done is null or count_total is null or count_done <= count_total) and (count_unit is null or length(count_unit) <= 30));
comment on column public.trk_activities.count_total is 'A counted step: how many in all (e.g. RT joints); progress = count_done / count_total';
comment on column public.trk_activities.count_done is 'A counted step: how many done so far';
comment on column public.trk_activities.count_unit is 'A counted step: what is counted (e.g. joints)';

create or replace function public.trk_log_activity_count() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.count_total is distinct from old.count_total or new.count_done is distinct from old.count_done or new.count_unit is distinct from old.count_unit then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'activity', new.equipment_key || ' · ' || new.activity_id, 'count',
      case when old.count_total is null then null else coalesce(old.count_done, 0) || '/' || old.count_total || coalesce(' ' || old.count_unit, '') end,
      case when new.count_total is null then null else coalesce(new.count_done, 0) || '/' || new.count_total || coalesce(' ' || new.count_unit, '') end,
      auth.uid(), public.trk_who());
  end if;
  return new;
end $$;
revoke all on function public.trk_log_activity_count() from public, anon;
create trigger trk_activities_log_count after update of count_total, count_done, count_unit on public.trk_activities
  for each row execute function public.trk_log_activity_count();
