-- Blinds are installed by M & I after the operations handover: grouped as segregation, HP critical (S213) and
-- equipment (the item's blind line in the bar chart). An item is handed over by operations when its neutralization
-- before handover is done (the blinds no longer hold it), a blind line finished still means the item is handed over,
-- and the handover no longer finishes the blind line (it is M & I work). Deblinding stays with stage 6.

alter table public.trk_points add column grp text;
update public.trk_points set grp = case when step_id = 'S213' then 'hp_critical' else 'segregation' end where kind = 'blind';

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
  -- the items: handed over when their neutralization before handover is done
  if new.kind = 'neut' and new.before_ho then
    foreach v_tag in array new.items loop
      select count(*), count(*) filter (where public.trk_point_complete(p)) into total, done from public.trk_points p
       where p.tracker_id = new.tracker_id and v_tag = any(p.items) and p.kind = 'neut' and p.before_ho;
      if total > 0 and done = total then
        update public.trk_equipment e set stage = 1 where e.tracker_id = new.tracker_id and e.tag = v_tag and e.stage = 0;
      elsif was and not now_c then
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

-- the stage finishes the deblind lines (stage 6), and taking the stage back reopens the blind or deblind lines past it
create or replace function public.trk_eq_sync_lines() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('trk.sync', true), '') = 'eq' or new.stage is not distinct from old.stage then return null; end if;
  perform set_config('trk.sync', 'eq', true);
  update public.trk_activities a set actual_start = coalesce(a.actual_start, new.blinds_out_at), actual_finish = new.blinds_out_at
   where a.tracker_id = new.tracker_id and a.equipment_key = coalesce(new.barchart_key, new.tag) and a.activity ~* 'blind'
     and a.stage = 6 and new.stage >= 6 and a.actual_finish is null and new.blinds_out_at is not null;
  update public.trk_activities a set actual_finish = null, actual_start = case when a.actual_start = a.actual_finish then null else a.actual_start end
   where a.tracker_id = new.tracker_id and a.equipment_key = coalesce(new.barchart_key, new.tag) and a.activity ~* 'blind'
     and a.stage in (1, 6) and new.stage < a.stage and a.actual_finish is not null;
  perform set_config('trk.sync', '', true);
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
  insert into public.trk_points (tracker_id, kind, grp, ref, name, detail, fo, step_id, items, before_ho, sort, status, in_at, out_at, fill_at, soak_at, drain_at, done_at, soak_h, remark)
  select p_dst, kind, grp, ref, name, detail, fo, step_id, items, before_ho, sort, case when p_progress then status else 'open' end,
         case when p_progress then in_at end, case when p_progress then out_at end, case when p_progress then fill_at end, case when p_progress then soak_at end,
         case when p_progress then drain_at end, case when p_progress then done_at end, soak_h, case when p_progress then remark end
    from public.trk_points where tracker_id = p_src;
end $$;
