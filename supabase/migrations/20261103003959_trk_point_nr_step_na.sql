-- A guideline step whose neutralization loops are all not required (N/R or N2) is N/A, not late (owner, 3 Nov 2026:
-- "No rtj in this loop so it is not required to neutralize"); marked required again, an N/A step reopens.
create or replace function public.trk_point_requirement_step() returns trigger language plpgsql security definer set search_path = public as $$
declare total int; off int;
begin
  if new.kind <> 'neut' or new.step_id is null or new.requirement is not distinct from old.requirement then return null; end if;
  select count(*), count(*) filter (where p.requirement in ('not_required', 'n2')) into total, off
    from public.trk_points p where p.tracker_id = new.tracker_id and p.step_id = new.step_id and not p.removed;
  if total > 0 and off = total then
    update public.trk_steps set status = 'na', pending_reason = null where tracker_id = new.tracker_id and step_id = new.step_id and status not in ('done', 'na');
  elsif new.requirement not in ('not_required', 'n2') then
    update public.trk_steps set status = 'not_started' where tracker_id = new.tracker_id and step_id = new.step_id and status = 'na';
  end if;
  return null;
end $$;
revoke all on function public.trk_point_requirement_step() from public, anon;
create trigger trk_points_requirement_step after update of requirement on public.trk_points
  for each row execute function public.trk_point_requirement_step();

-- the steps already in that state (S118: H-202 in/out, no RTJ)
update public.trk_steps s set status = 'na', pending_reason = null
 where s.status not in ('done', 'na') and exists (select 1 from public.trk_points p where p.tracker_id = s.tracker_id and p.step_id = s.step_id and p.kind = 'neut' and not p.removed)
   and not exists (select 1 from public.trk_points p where p.tracker_id = s.tracker_id and p.step_id = s.step_id and p.kind = 'neut' and not p.removed and p.requirement not in ('not_required', 'n2'));
