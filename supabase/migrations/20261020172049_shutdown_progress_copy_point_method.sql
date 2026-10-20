-- copies (test from template, new shutdown) carry the neutralization method (soak / spray)
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
  insert into public.trk_activities (tracker_id, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, baseline, detail, seq)
  select p_dst, activity_id, grp, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked, disabled_reason, 1, detail, seq
    from public.trk_activities a where tracker_id = p_src and baseline = (select max(baseline) from public.trk_activities where tracker_id = p_src);
  insert into public.trk_points (tracker_id, kind, grp, ref, name, detail, fo, step_id, items, requires, method, removed, before_ho, sort, status, in_at, out_at, fill_at, soak_at, drain_at, done_at, soak_h, remark)
  select p_dst, kind, grp, ref, name, detail, fo, step_id, items, requires, method, removed, before_ho, sort, case when p_progress then status else 'open' end,
         case when p_progress then in_at end, case when p_progress then out_at end, case when p_progress then fill_at end, case when p_progress then soak_at end,
         case when p_progress then drain_at end, case when p_progress then done_at end, soak_h, case when p_progress then remark end
    from public.trk_points where tracker_id = p_src;
end $$;
