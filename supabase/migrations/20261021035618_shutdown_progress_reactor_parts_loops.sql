-- Reactors and loops.
-- 1. An item that a loop covers is neutralized by the loop: its own soda-ash point (ref = the item, no step) is retired,
--    now and whenever a loop picks the item up later. Sprays (heater tube OD, reactor body) are not soda-ash fills and stay.
-- 2. The soda ash put inside a reactor only soaks the catalyst wet. The reactor body is neutralized by a spray after the
--    catalyst is dumped: one spray point per reactor, after the dumping steps, not needed for hand over.
-- 3. A reactor has parts neutralized on their own: the R-205 addition, withdrawal, quench and inlet lines and the piping
--    between the reactors. Their loops carry part_of = the reactor(s), to show them with it without holding its hand over.
alter table public.trk_points add column if not exists part_of text[] not null default '{}';
alter table public.trk_points add column if not exists after_acts text[] not null default '{}';

create or replace function public.trk_points_into_loops() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.kind <> 'neut' or new.removed then return null; end if;
  if new.step_id is not null then
    update public.trk_points p set removed = true, items = '{}', before_ho = false
     where p.tracker_id = new.tracker_id and p.kind = 'neut' and p.step_id is null and not p.removed and coalesce(p.method, 'soak') <> 'spray'
       and cardinality(p.items) = 1 and p.ref = p.items[1] and p.items[1] = any(new.items);
  elsif coalesce(new.method, 'soak') <> 'spray' and cardinality(new.items) = 1 and new.ref = new.items[1]
    and exists (select 1 from public.trk_points l where l.tracker_id = new.tracker_id and l.kind = 'neut' and l.step_id is not null and not l.removed and new.items[1] = any(l.items)) then
    update public.trk_points set removed = true, items = '{}', before_ho = false where id = new.id;
  end if;
  return null;
end $$;
create or replace trigger trk_points_into_loops after insert or update of items, step_id, removed on public.trk_points for each row execute function public.trk_points_into_loops();

-- the items loops already cover
update public.trk_points p set removed = true, items = '{}', before_ho = false
 where p.kind = 'neut' and p.step_id is null and not p.removed and coalesce(p.method, 'soak') <> 'spray' and cardinality(p.items) = 1 and p.ref = p.items[1]
   and exists (select 1 from public.trk_points l where l.tracker_id = p.tracker_id and l.kind = 'neut' and l.step_id is not null and not l.removed and p.items[1] = any(l.items));

-- a point can wait for work steps (after_acts) as well as blinds (requires)
create or replace function public.trk_point_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare missing text[]; waiting text[];
begin
  if new.kind <> 'neut' or old.status <> 'open' or new.status = 'open' or cardinality(new.requires) + cardinality(new.after_acts) = 0 then return new; end if;
  select coalesce(array_agg(r order by r), '{}') into missing from unnest(new.requires) r
   where not exists (select 1 from public.trk_points b where b.tracker_id = new.tracker_id and b.kind = 'blind' and b.ref = r and public.trk_point_complete(b));
  select coalesce(array_agg(distinct a.activity), '{}') into waiting from public.trk_activities a
   where a.tracker_id = new.tracker_id and a.activity_id = any(new.after_acts) and a.equipment_key = any(new.items) and a.actual_finish is null
     and coalesce(a.disabled_reason, '') = '' and a.baseline = (select max(x.baseline) from public.trk_activities x where x.tracker_id = new.tracker_id);
  if cardinality(missing) + cardinality(waiting) = 0 then return new; end if;
  if not public.app_is_section_head() then
    if cardinality(missing) > 0 then raise exception 'Blinds not in yet: %. Ask M & I to install them first.', array_to_string(missing, ', '); end if;
    raise exception 'Not before: %.', array_to_string(waiting, ', ');
  end if;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  values (new.tracker_id, 'point', new.ref, 'override', array_to_string(missing || waiting, ', '), 'started early', auth.uid(), public.trk_who());
  return new;
end $$;

-- reactors: the soda ash soaks the catalyst, the body is sprayed after dumping
update public.trk_points set name = ref || ' catalyst soak (soda ash)'
 where kind = 'neut' and step_id is null and ref ~ '^R-12-20[1-5]$' and not removed;
insert into public.trk_points (tracker_id, kind, ref, name, grp, sort, items, before_ho, status, method, after_acts)
select s.tracker_id, 'neut', s.ref || ' body', s.ref || ' body spray (after dumping)', s.grp, s.sort + 1, array[s.ref], false, 'open', 'spray',
       coalesce((select array_agg(a.activity_id order by a.activity_id) from public.trk_activities a where a.tracker_id = s.tracker_id and a.equipment_key = s.ref
                  and a.activity ~* 'dump' and coalesce(a.disabled_reason, '') = '' and a.baseline = (select max(x.baseline) from public.trk_activities x where x.tracker_id = s.tracker_id)), '{}')
  from public.trk_points s
 where s.kind = 'neut' and s.step_id is null and s.ref ~ '^R-12-20[1-5]$' and not s.removed
   and not exists (select 1 from public.trk_points q where q.tracker_id = s.tracker_id and q.ref = s.ref || ' body');

-- the reactor parts neutralized on their own
update public.trk_points p set part_of = v.parts from (values
  ('S111', array['R-12-205', 'R-12-201']), ('S112', array['R-12-205']), ('S114', array['R-12-205']), ('S115', array['R-12-205']), ('S117', array['R-12-205']),
  ('S113', array['R-12-201', 'R-12-202', 'R-12-203', 'R-12-204'])) v(ref, parts)
 where p.kind = 'neut' and p.ref = v.ref;
