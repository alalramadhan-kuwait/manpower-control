-- Engineers edit an item's work steps (Section Head, 23 Oct): rename a step, put the steps in order, add steps and
-- take off the ones they added. The bar chart stays the P6 one: a renamed P6 line keeps its P6 text (p6_activity),
-- an added step (ENG-…) has no planned dates so it counts in neither the M & I % nor the forecast, and the P6 lines'
-- dates, stage, item and on / off stay the Section Head's.
alter table public.trk_activities add column if not exists p6_activity text;

create or replace function public.trk_stamp() returns trigger language plpgsql set search_path to 'public' as $function$
declare head boolean := public.app_is_section_head() or (auth.uid() is null and public.trk_access_id() is null);
begin
  if tg_op = 'UPDATE' and not head then
    -- the setup is the Section Head's
    if tg_table_name = 'trk_steps' then
      if new.prereq is distinct from old.prereq or new.target_at is distinct from old.target_at
          or new.short_name is distinct from old.short_name or new.step_text is distinct from old.step_text or new.gate is distinct from old.gate then
        raise exception 'Only the Section Head changes the steps (pre-requisites, target, name).'; end if;
    elsif tg_table_name = 'trk_equipment' then
      if new.tracked is distinct from old.tracked or new.critical is distinct from old.critical
          or new.planned_ho is distinct from old.planned_ho or new.planned_finish is distinct from old.planned_finish
          or new.ho_step is distinct from old.ho_step or new.ops_item is distinct from old.ops_item then
        raise exception 'Only the Section Head changes the equipment setup.'; end if;
    elsif tg_table_name = 'trk_activities' then
      if new.stage is distinct from old.stage or new.equipment_key is distinct from old.equipment_key
          or new.planned_start is distinct from old.planned_start or new.planned_finish is distinct from old.planned_finish
          or (new.tracked is distinct from old.tracked and old.activity_id not like 'ENG-%') then
        raise exception 'Only the Section Head changes the bar chart.'; end if;
    end if;
  end if;
  -- a renamed bar-chart line keeps its P6 text
  if tg_op = 'UPDATE' and tg_table_name = 'trk_activities' and new.activity is distinct from old.activity
      and old.activity_id not like 'ENG-%' and old.p6_activity is null then
    new.p6_activity := old.activity;
  end if;
  new.updated_by := auth.uid(); new.updated_by_name := public.trk_who(); new.updated_at := now();
  return new;
end $function$;

create or replace trigger trk_activities_stamp before insert or update on public.trk_activities for each row execute function public.trk_stamp();

-- a step added by those who update the tracker: on an item of the tracker, no planned dates
create policy trk_activities_add_step on public.trk_activities for insert
  with check (public.trk_can_update() and activity_id like 'ENG-%' and planned_start is null and planned_finish is null and not detail
    and exists (select 1 from public.trk_equipment e where e.tracker_id = trk_activities.tracker_id and coalesce(e.barchart_key, e.tag) = trk_activities.equipment_key));
