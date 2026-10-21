-- FV-1427 drop (S115 step 3) needs a crane (Section Head, 21 Oct). Field jobs added on a loop by the Section Head
-- (scaffolding and the like) are logged when added.
update public.trk_point_step s set crane = true, kind = 'step'
  from public.trk_points p where p.id = s.point_id and p.ref = 'S115' and s.seq = 3;

create or replace function public.trk_point_step_added() returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select p.ref into r from public.trk_points p where p.id = new.point_id;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  values (new.tracker_id, 'point', r, 'step added', null, new.text, auth.uid(), public.trk_who());
  return new;
end $$;
create trigger trk_point_step_added after insert on public.trk_point_step for each row execute function public.trk_point_step_added();
