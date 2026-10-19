-- Isolation and neutralization, entered once: the critical blinds (segregation points) and the neutralization loops and
-- items. Each row is linked to its items and its guideline step. A row updated here ticks the step when all its rows
-- are done, hands over an item when all its blinds are in and its neutralization (before handover) is done, and moves
-- the item's soda-ash bar-chart lines. A handover step done hands over the items, and the last item handed over of a
-- step ticks the step.

create table public.trk_points (
  id uuid primary key default gen_random_uuid(),
  tracker_id uuid not null references public.trk_trackers(id),
  kind text not null check (kind in ('blind', 'neut')),
  ref text not null, name text not null, detail text, fo text, step_id text, items text[] not null default '{}',
  before_ho boolean not null default true, sort int not null default 0,
  status text not null default 'open' check (status in ('open', 'in', 'out', 'filling', 'soaking', 'draining', 'done')),
  in_at timestamptz, out_at timestamptz, fill_at timestamptz, soak_at timestamptz, drain_at timestamptz, done_at timestamptz,
  soak_h numeric, remark text,
  updated_by uuid, updated_by_name text, updated_at timestamptz,
  unique (tracker_id, kind, ref)
);
alter table public.trk_points enable row level security;
create policy trk_points_read on public.trk_points for select using (public.app_current_role() is not null);
create policy trk_points_update on public.trk_points for update using (public.trk_can_update()) with check (public.trk_can_update());
create policy trk_points_head on public.trk_points for insert with check (public.app_is_section_head());

-- complete = blind in (or already out) / neutralization drained
create or replace function public.trk_point_complete(p public.trk_points) returns boolean language sql immutable as $$
  select case when p.kind = 'blind' then p.status in ('in', 'out') else p.status = 'done' end
$$;

-- who, when, and the time of each state (filled when reached, cleared when taken back, kept when corrected)
create or replace function public.trk_point_stamp() returns trigger language plpgsql set search_path = public as $$
declare r int := array_position(array['open', 'filling', 'soaking', 'draining', 'done'], new.status);
begin
  if new.kind = 'blind' then
    if new.status in ('in', 'out') and new.in_at is null then new.in_at := now(); end if;
    if new.status = 'out' and new.out_at is null then new.out_at := now(); end if;
    if new.status = 'open' then new.in_at := null; new.out_at := null; end if;
    if new.status = 'in' then new.out_at := null; end if;
  else
    if r >= 2 and new.fill_at is null then new.fill_at := now(); end if;
    if r >= 3 and new.soak_at is null then new.soak_at := now(); end if;
    if r >= 4 and new.drain_at is null then new.drain_at := now(); end if;
    if r >= 5 and new.done_at is null then new.done_at := now(); end if;
    if r < 2 then new.fill_at := null; end if;
    if r < 3 then new.soak_at := null; end if;
    if r < 4 then new.drain_at := null; end if;
    if r < 5 then new.done_at := null; end if;
  end if;
  new.updated_by := auth.uid(); new.updated_by_name := public.trk_who(); new.updated_at := now();
  return new;
end $$;
create trigger trk_points_stamp before update on public.trk_points for each row execute function public.trk_point_stamp();

create or replace function public.trk_point_sync() returns trigger language plpgsql security definer set search_path = public as $$
declare was boolean := public.trk_point_complete(old); now_c boolean := public.trk_point_complete(new); v_tag text; total int; done int;
begin
  if new.status is not distinct from old.status and new.fill_at is not distinct from old.fill_at and new.soak_at is not distinct from old.soak_at
     and new.drain_at is not distinct from old.drain_at and new.done_at is not distinct from old.done_at then return null; end if;
  if new.status is distinct from old.status then
    insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
    values (new.tracker_id, 'point', new.ref, new.kind, old.status, new.status, auth.uid(), public.trk_who());
  end if;
  -- the guideline step: done when all its rows are complete, in progress when one has started
  if new.step_id is not null then
    select count(*), count(*) filter (where public.trk_point_complete(p)) into total, done from public.trk_points p where p.tracker_id = new.tracker_id and p.step_id = new.step_id;
    if total > 0 and done = total then
      update public.trk_steps set status = 'done' where tracker_id = new.tracker_id and step_id = new.step_id and status not in ('done', 'na');
    elsif was and not now_c then
      update public.trk_steps set status = 'in_progress' where tracker_id = new.tracker_id and step_id = new.step_id and status = 'done';
    elsif new.status <> 'open' then
      update public.trk_steps set status = 'in_progress' where tracker_id = new.tracker_id and step_id = new.step_id and status = 'not_started';
    end if;
  end if;
  -- the items: handed over when all their blinds are in and their neutralization before handover is done
  foreach v_tag in array new.items loop
    select count(*), count(*) filter (where public.trk_point_complete(p)) into total, done from public.trk_points p
     where p.tracker_id = new.tracker_id and v_tag = any(p.items) and (p.kind = 'blind' or p.before_ho);
    if total > 0 and done = total then
      update public.trk_equipment e set stage = 1 where e.tracker_id = new.tracker_id and e.tag = v_tag and e.stage = 0;
    elsif was and not now_c and (new.kind = 'blind' or new.before_ho) then
      update public.trk_equipment e set stage = 0 where e.tracker_id = new.tracker_id and e.tag = v_tag and e.stage = 1;
    end if;
  end loop;
  -- the soda-ash bar-chart lines of the items follow the neutralization
  if new.kind = 'neut' then
    update public.trk_activities a set
        actual_start = case when a.activity ~* 'soda ash soaking' then new.soak_at when a.activity ~* 'soda ash draining' then new.drain_at else new.fill_at end,
        actual_finish = case when a.activity ~* 'soda ash filling' then new.soak_at when a.activity ~* 'soda ash soaking' then new.drain_at else new.done_at end
      from public.trk_equipment e
     where e.tracker_id = new.tracker_id and e.tag = any(new.items) and a.tracker_id = new.tracker_id and a.equipment_key = coalesce(e.barchart_key, e.tag)
       and a.tracked and a.activity ~* '(neutrali|soda ash (filling|soaking|draining))';
  end if;
  return null;
end $$;
create trigger trk_points_sync after update on public.trk_points for each row execute function public.trk_point_sync();

-- the last item of a handover step handed over ticks the step
create or replace function public.trk_eq_sync_step() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage >= 1 and old.stage < 1 and new.ho_step is not null
     and not exists (select 1 from public.trk_equipment e where e.tracker_id = new.tracker_id and e.ho_step = new.ho_step and e.tracked and e.stage < 1) then
    update public.trk_steps set status = 'done' where tracker_id = new.tracker_id and step_id = new.ho_step and status not in ('done', 'na');
  end if;
  return null;
end $$;
create trigger trk_equipment_sync_step after update on public.trk_equipment for each row execute function public.trk_eq_sync_step();

-- reset and publish carry the rows (the progress only into a reset test)
create or replace function public.trk_copy(p_src uuid, p_dst uuid, p_progress boolean) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.trk_steps (tracker_id, step_id, fo, gate, gate_name, short_name, step_text, procedure, prereq, est_hours, note, equipment_covered, target_at, status, pending_reason, remark)
  select p_dst, step_id, fo, gate, gate_name, short_name, step_text, procedure, prereq, est_hours, note, equipment_covered, target_at,
         case when p_progress then status else 'not_started' end, case when p_progress then pending_reason end, case when p_progress then remark end
    from public.trk_steps where tracker_id = p_src;
  insert into public.trk_equipment (tracker_id, tag, grp, description, fo, ho_step, procedure, barchart_key, ops_item, critical, tracked, disabled_reason, planned_ho, planned_finish, sort, stage, pending_reason, remark)
  select p_dst, tag, grp, description, fo, ho_step, procedure, barchart_key, ops_item, critical, tracked, disabled_reason, planned_ho, planned_finish, sort,
         case when p_progress then stage else 0 end, case when p_progress then pending_reason end, case when p_progress then remark end
    from public.trk_equipment where tracker_id = p_src;
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, baseline)
  select p_dst, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, 1
    from public.trk_activities a where tracker_id = p_src and baseline = (select max(baseline) from public.trk_activities where tracker_id = p_src);
  insert into public.trk_points (tracker_id, kind, ref, name, detail, fo, step_id, items, before_ho, sort, status, in_at, out_at, fill_at, soak_at, drain_at, done_at, soak_h, remark)
  select p_dst, kind, ref, name, detail, fo, step_id, items, before_ho, sort, case when p_progress then status else 'open' end,
         case when p_progress then in_at end, case when p_progress then out_at end, case when p_progress then fill_at end, case when p_progress then soak_at end,
         case when p_progress then drain_at end, case when p_progress then done_at end, soak_h, case when p_progress then remark end
    from public.trk_points where tracker_id = p_src;
end $$;

-- the seed of the active trackers: the 28 segregation points of the pack (status of 19-Oct, or the step done) ...
insert into public.trk_points (tracker_id, kind, ref, name, fo, step_id, items, sort, status, in_at)
select t.id, 'blind', v.ref, v.name, s.fo, v.step, v.items, v.n,
       case when v.blinded or s.status = 'done' then 'in' else 'open' end,
       case when v.blinded or s.status = 'done' then coalesce(s.done_at, timestamptz '2026-10-19 07:00+03') end
  from public.trk_trackers t
  cross join (values
    (1, 'SEG-01', 'E-12-210 S/S O/L', 'S312', array['E-12-210A/B'], true),
    (2, 'SEG-02', '12-LV-572', 'S310', array[]::text[], true),
    (3, 'SEG-03', 'H-12-103 TR-II pass', 'S309', array[]::text[], true),
    (4, 'SEG-04', '12-PV-644', 'S311', array[]::text[], true),
    (5, 'SEG-05', 'R-12-204 O/L', 'S107', array['R-12-204'], true),
    (6, 'SEG-06', 'E-12-202 S/S O/L', 'S213', array['E-202 to E-203'], false),
    (7, 'SEG-07', '12-TV-667 U/S', 'S213', array[]::text[], false),
    (8, 'SEG-08', 'Make-up H2 B/L BVs', 'S206', array[]::text[], true),
    (9, 'SEG-09', 'H.P. purge gas B/L BV', 'S209', array[]::text[], true),
    (10, 'SEG-10', 'V-12-212 drain to V-12-114', 'S208', array['V-12-212'], true),
    (11, 'SEG-11', 'C-12-201 gas to V-12-126', 'S213', array['C-12-201'], false),
    (12, 'SEG-12', 'E-12-205 S/S I/L', 'S213', array['E-12-205'], false),
    (13, 'SEG-13', 'E-12-205 T/S O/L', 'S213', array['E-12-205'], false),
    (14, 'SEG-14', 'C-12-201 anti-surge', 'S213', array['C-12-201'], false),
    (15, 'SEG-15', 'V-12-207 gas to V-12-126', 'S213', array['V-12-207'], false),
    (16, 'SEG-16', 'R-12-205 (ADD/WDL)', 'S108', array['R-12-205'], false),
    (17, 'SEG-17', 'V-12-236 sour water', 'S210', array['V-12-236'], true),
    (18, 'SEG-18', 'H.P. flare header', 'S317', array[]::text[], false),
    (19, 'SEG-19', 'L.P. flare header', 'S316', array[]::text[], false),
    (20, 'SEG-20', 'R. fuel gas line', 'S315', array[]::text[], false),
    (21, 'SEG-21', 'E-216A/B S/S I/L & O/L', 'S313', array['E-12-216A', 'E-12-216B'], true),
    (22, 'SEG-22', 'E-12-203 inlet & HV-548B', null, array['12-HV-0548B'], false),
    (23, 'SEG-23', 'PDT-011/017', 'S108', array[]::text[], false),
    (24, 'SEG-24', 'Quench oil to R-12-205', 'S202', array['R-12-205'], false),
    (25, 'SEG-25', 'Injection water', 'S301', array[]::text[], true),
    (26, 'SEG-26', 'BFW', null, array[]::text[], true),
    (27, 'SEG-27', 'Super heated steam', null, array[]::text[], true),
    (28, 'SEG-28', 'P-12-205 HPRT PSV-630 to rich amine header', 'S212', array['P-12-205'], false)) v(n, ref, name, step, items, blinded)
  left join public.trk_steps s on s.tracker_id = t.id and s.step_id = v.step
 where t.status = 'active';

-- ... the neutralization loops (guideline gate 7, and the withdrawal line) with the items they cover ...
insert into public.trk_points (tracker_id, kind, ref, name, detail, fo, step_id, items, before_ho, sort, status, done_at, soak_h)
select t.id, 'neut', s.step_id, s.short_name, s.step_text, s.fo, s.step_id,
       array(select x from unnest(string_to_array(coalesce(s.equipment_covered, ''), '; ') || coalesce(v.extra, array[]::text[])) x
              where exists (select 1 from public.trk_equipment e where e.tracker_id = t.id and e.tag = x)),
       true, v.n, case when s.status = 'done' then 'done' else 'open' end, case when s.status = 'done' then coalesce(s.done_at, s.updated_at) end,
       case when s.step_text ~* 'soak 4 h' then 4 end
  from public.trk_trackers t
  cross join (values (1, 'S111', null::text[]), (2, 'S112', null), (3, 'S113', null), (4, 'S114', null), (5, 'S115', null), (6, 'S118', null), (7, 'S117', null),
    (8, 'S214', null), (9, 'S215', null), (10, 'S216', null), (11, 'S217', null), (12, 'S218', null),
    (13, 'S318', null), (14, 'S320', array['V-12-213', 'V-12-209']), (15, 'S321', array['E-12-216A', 'E-12-216B'])) v(n, step, extra)
  join public.trk_steps s on s.tracker_id = t.id and s.step_id = v.step
 where t.status = 'active';

-- ... and the items neutralized on their own (bar chart), not inside a loop
insert into public.trk_points (tracker_id, kind, ref, name, fo, items, before_ho, sort)
select t.id, 'neut', e.tag, e.tag || ' neutralization (soda ash)', e.fo, array[e.tag], e.tag not like 'H-12-%', 100 + e.sort
  from public.trk_trackers t join public.trk_equipment e on e.tracker_id = t.id
 where t.status = 'active' and e.tag in ('R-12-201', 'R-12-202', 'R-12-203', 'R-12-204', 'R-12-205', 'E-12-204', 'E-12-205', 'E-12-229', 'H-12-201', 'H-12-202', '12-VC-0105');
