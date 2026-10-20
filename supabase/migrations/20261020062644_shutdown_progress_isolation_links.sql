-- Isolation links (reviewed table): each neutralization loop or soda-ash item names the blinds that must be in before it
-- can start (requires) and the equipment it colours (items). A loop with a blind missing is locked (only the Section
-- Head can start it, logged as an override). An item is handed over automatically only when its neutralization before
-- handover is done AND every blind linked to it is in, and a blind going in re-checks its items.

alter table public.trk_points add column if not exists requires text[] not null default '{}';

update public.trk_points p set items = v.items, requires = v.req
  from (values
    ('S111', array['R-205 to E-229','E-229 sample point','12-VC-0106','12-VC-0108','FV-1426 d/s'], array['SEG-16','SEG-24','SEG-23']),
    ('S112', array[]::text[], array['SEG-16','SEG-24']),
    ('S113', array['R-201 to R-202','R-202 to R-203','R-203 to R-204','R-204 to V-206'], array['SEG-05']),
    ('S114', array[]::text[], array['SEG-16','SEG-24']),
    ('S115', array['12-VC-0107','H-201 O/L to R-205 I/L'], array[]::text[]),
    ('S117', array['R-205 withdrawal line d/s KV-7B/8B'], array[]::text[]),
    ('S118', array['H-202 O/L','FV-1427'], array[]::text[]),
    ('S214', array['V-12-206','V-12-207'], array['SEG-07','SEG-15']),
    ('S215', array['E-202 to E-203','C-12-201'], array['SEG-06','SEG-07','SEG-11','SEG-14']),
    ('S216', array['E-12-205','V-12-208'], array['SEG-07','SEG-12','SEG-13']),
    ('S217', array['V-206 to V-213','V-207 to V-213'], array['SEG-07']),
    ('S218', array['Wash water to EA-201','E-205 to EA-201','E-12-207'], array['SEG-07']),
    ('S318', array['E-12-216A','E-12-216B','E-12-229'], array[]::text[]),
    ('S320', array['V-12-213','V-12-209','E-12-210A/B'], array['SEG-01','SEG-02','SEG-04']),
    ('S321', array['E-12-216A','E-12-216B'], array['SEG-21']),
    ('R-12-204', array['R-12-204'], array['SEG-05']),
    ('R-12-205', array['R-12-205'], array['SEG-16','SEG-24']),
    ('E-12-205', array['E-12-205'], array['SEG-12','SEG-13'])
  ) v(ref, items, req)
 where p.kind = 'neut' and p.ref = v.ref;

-- the item is ready for handover: its neutralization before handover all done and every blind linked to it in
create or replace function public.trk_item_ready(p_tracker uuid, p_tag text) returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.trk_points p where p.tracker_id = p_tracker and p_tag = any(p.items) and p.kind = 'neut' and p.before_ho)
     and not exists (select 1 from public.trk_points p where p.tracker_id = p_tracker and p_tag = any(p.items)
                       and ((p.kind = 'neut' and p.before_ho) or p.kind = 'blind') and not public.trk_point_complete(p))
$$;

-- a loop cannot start before its blinds are in (the Section Head may, and it is logged)
create or replace function public.trk_point_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare missing text[];
begin
  if new.kind <> 'neut' or old.status <> 'open' or new.status = 'open' or cardinality(new.requires) = 0 then return new; end if;
  select coalesce(array_agg(r order by r), '{}') into missing from unnest(new.requires) r
   where not exists (select 1 from public.trk_points b where b.tracker_id = new.tracker_id and b.kind = 'blind' and b.ref = r and public.trk_point_complete(b));
  if cardinality(missing) = 0 then return new; end if;
  if not public.app_is_section_head() then
    raise exception 'Blinds not in yet: %. Ask M & I to install them first.', array_to_string(missing, ', ');
  end if;
  insert into public.trk_log (tracker_id, kind, ref, field, old_value, new_value, by_user, by_name)
  values (new.tracker_id, 'point', new.ref, 'override', array_to_string(missing, ', '), 'started without blinds', auth.uid(), public.trk_who());
  return new;
end $$;
create or replace trigger trk_point_guard before update on public.trk_points for each row execute function public.trk_point_guard();

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
  -- the items: handed over when ready (neutralized and blinds in), back when a neutralization is taken back
  if (new.kind = 'neut' and new.before_ho) or new.kind = 'blind' then
    foreach v_tag in array new.items loop
      if now_c and public.trk_item_ready(new.tracker_id, v_tag) then
        update public.trk_equipment e set stage = 1 where e.tracker_id = new.tracker_id and e.tag = v_tag and e.stage = 0;
      elsif new.kind = 'neut' and was and not now_c then
        update public.trk_equipment e set stage = 0 where e.tracker_id = new.tracker_id and e.tag = v_tag and e.stage = 1;
      end if;
    end loop;
  end if;
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
  insert into public.trk_points (tracker_id, kind, grp, ref, name, detail, fo, step_id, items, requires, before_ho, sort, status, in_at, out_at, fill_at, soak_at, drain_at, done_at, soak_h, remark)
  select p_dst, kind, grp, ref, name, detail, fo, step_id, items, requires, before_ho, sort, case when p_progress then status else 'open' end,
         case when p_progress then in_at end, case when p_progress then out_at end, case when p_progress then fill_at end, case when p_progress then soak_at end,
         case when p_progress then drain_at end, case when p_progress then done_at end, soak_h, case when p_progress then remark end
    from public.trk_points where tracker_id = p_src;
end $$;
