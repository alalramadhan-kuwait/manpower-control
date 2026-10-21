-- Field jobs inside a neutralization (crane lifts of control valves, blinding, elbows and spools) are timed work steps,
-- started and finished like the equipment work steps. The rest stay ticks.
alter table public.trk_point_step add column if not exists kind text not null default 'check' check (kind in ('check', 'step'));
alter table public.trk_point_step add column if not exists start_at timestamptz;
alter table public.trk_point_step add column if not exists start_by_name text;

create or replace function public.trk_point_step_stamp() returns trigger language plpgsql security definer set search_path = public as $$
declare r text;
begin
  select p.ref into r from public.trk_points p where p.id = new.point_id;
  if new.start_at is distinct from old.start_at then
    new.start_by_name := case when new.start_at is null then null else public.trk_who() end;
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'point', r || ' step ' || new.seq, case when new.start_at is null then 'step start undone' else 'step started' end,
            old.start_at::text, coalesce(new.start_at::text, new.text), auth.uid(), public.trk_who());
  end if;
  if new.done_at is distinct from old.done_at then
    new.done_by := auth.uid(); new.done_by_name := public.trk_who();
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'point', r || ' step ' || new.seq, case when new.done_at is null then 'step undone' else 'step done' end,
            old.done_at::text, coalesce(new.done_at::text, new.text), auth.uid(), public.trk_who());
  end if;
  return new;
end $$;

update public.trk_point_step s set kind = 'step'
  from public.trk_points p
 where p.id = s.point_id and (s.crane or (p.ref, s.seq) in (
   ('S111', 5), ('S112', 3), ('S114', 4), ('S114', 5), ('S115', 2), ('S115', 3), ('S115', 6), ('S117', 2), ('S117', 3),
   ('S118', 1), ('S217', 4), ('S218', 2), ('S218', 6), ('S218', 12)));
