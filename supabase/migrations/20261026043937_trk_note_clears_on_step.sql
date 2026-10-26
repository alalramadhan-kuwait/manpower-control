-- An item's status note is cleared when one of its steps starts or finishes after the note was written (owner,
-- 26 Oct 2026: the old note stayed after the work moved on). A note written in the same transaction as the step
-- (a report entered) stays. The cleared note remains in the change log.
alter table public.trk_equipment add column if not exists remark_at timestamptz;
update public.trk_equipment set remark_at = updated_at where remark is not null and remark_at is null;

create or replace function public.trk_equipment_remark_at() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.remark is distinct from old.remark then new.remark_at := case when new.remark is null then null else now() end; end if;
  return new;
end $$;
revoke execute on function public.trk_equipment_remark_at() from public, anon;
create trigger trk_equipment_remark_at before update of remark on public.trk_equipment
  for each row execute function public.trk_equipment_remark_at();

create or replace function public.trk_step_clears_note() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.tracked and not coalesce(new.detail, false)
     and ((new.actual_finish is not null and new.actual_finish is distinct from old.actual_finish)
       or (new.actual_start is not null and new.actual_start is distinct from old.actual_start)) then
    update public.trk_equipment e set remark = null, updated_at = now()
     where e.tracker_id = new.tracker_id and coalesce(e.barchart_key, e.tag) = new.equipment_key
       and e.remark is not null and coalesce(e.remark_at, '-infinity'::timestamptz) < now();
  end if;
  return null;
end $$;
revoke execute on function public.trk_step_clears_note() from public, anon, authenticated;
create trigger trk_step_clears_note after update of actual_start, actual_finish on public.trk_activities
  for each row execute function public.trk_step_clears_note();

-- V-12-209: its steps were finished in the app (26 Oct 06:29) after the night logbook note was written
update public.trk_equipment set remark = null
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and tag = 'V-12-209' and remark = 'No activity; grit blasting and painting pending';
