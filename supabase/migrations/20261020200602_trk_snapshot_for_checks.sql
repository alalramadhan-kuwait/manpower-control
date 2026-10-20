-- A read-only snapshot of one tracker (steps, equipment, activities of the latest baseline, points, IATs, settings) for
-- checking reports and rules against live data outside the app. Callable only with the one-time token in lu_meta
-- (key snapshot_token), and closed again (execute revoked) after use.
create or replace function public.trk_snapshot(p_token text, p_tracker uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b int;
begin
  if p_token is null or p_token is distinct from (select value->>'token' from public.lu_meta where key = 'snapshot_token') then raise exception 'Not allowed.'; end if;
  select max(baseline) into b from public.trk_activities where tracker_id = p_tracker;
  return jsonb_build_object(
    'tracker', (select to_jsonb(t) from public.trk_trackers t where t.id = p_tracker),
    'steps', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.trk_steps s where s.tracker_id = p_tracker),
    'equipment', (select coalesce(jsonb_agg(to_jsonb(e)), '[]') from public.trk_equipment e where e.tracker_id = p_tracker),
    'activities', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.trk_activities a where a.tracker_id = p_tracker and a.baseline = b),
    'points', (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from public.trk_points p where p.tracker_id = p_tracker and not p.removed),
    'iats', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.trk_iat i where i.tracker_id = p_tracker));
end $$;
revoke execute on function public.trk_snapshot(text, uuid) from anon, authenticated, public;
