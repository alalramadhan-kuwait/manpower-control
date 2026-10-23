-- One record for the same blind in two places.
-- 1) A procedure step can follow segregation blinds (link_points): S118 step 1 "Blinds in: E-202 S/S O/L and TV-667 U/S"
--    follows SEG-06 and SEG-07.
-- 2) A segregation blind and an item's own blind step are kept in step (link_acts on the blind, both ways):
--    SEG-22 "E-12-203 inlet & HV-548B" and the HV-0548B "Blind" step.
alter table public.trk_point_step add column if not exists link_points uuid[];
alter table public.trk_points add column if not exists link_acts uuid[];

create or replace function public.trk_blind_to_acts() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'blind' and coalesce(array_length(new.link_acts, 1), 0) > 0 and new.in_at is distinct from old.in_at then
    update public.trk_activities set actual_finish = new.in_at,
      actual_start = case when new.in_at is null then null else coalesce(actual_start, new.in_at) end
     where id = any (new.link_acts) and actual_finish is distinct from new.in_at;
  end if;
  return new;
end $$;
create or replace trigger trk_blind_to_acts after update of in_at on public.trk_points for each row execute function public.trk_blind_to_acts();

create or replace function public.trk_acts_to_blind() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.actual_finish is distinct from old.actual_finish then
    update public.trk_points set in_at = new.actual_finish, status = case when new.actual_finish is null then 'open' else 'in' end
     where kind = 'blind' and tracker_id = new.tracker_id and new.id = any (link_acts) and status in ('open', 'in') and in_at is distinct from new.actual_finish;
  end if;
  return new;
end $$;
create or replace trigger trk_acts_to_blind after update of actual_finish on public.trk_activities for each row execute function public.trk_acts_to_blind();

-- the links, live tracker
update public.trk_point_step s set link_points = (select array_agg(b.id order by b.ref) from public.trk_points b where b.tracker_id = s.tracker_id and b.kind = 'blind' and b.ref in ('SEG-06', 'SEG-07'))
 from public.trk_points p where p.id = s.point_id and p.ref = 'S118' and s.seq = 1 and s.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a';
update public.trk_points b set link_acts = (select array_agg(a.id) from public.trk_activities a where a.tracker_id = b.tracker_id and a.equipment_key = '12-HV-0548B' and a.activity_id = 'A6350-3')
 where b.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and b.kind = 'blind' and b.ref = 'SEG-22';
-- bring the HV-0548B blind step in line with SEG-22 (installed)
update public.trk_activities a set actual_start = coalesce(a.actual_start, b.in_at), actual_finish = b.in_at, actual_note = 'Same blind as SEG-22'
  from public.trk_points b
 where b.tracker_id = a.tracker_id and b.kind = 'blind' and b.ref = 'SEG-22' and a.id = any (b.link_acts) and b.in_at is not null and a.actual_finish is null
   and a.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a';
