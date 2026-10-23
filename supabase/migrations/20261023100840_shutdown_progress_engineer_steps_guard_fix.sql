-- The P6-text capture read new.activity on every table (plpgsql does not short-circuit): its own block now.
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
  if tg_op = 'UPDATE' then
    if tg_table_name = 'trk_activities' then
      if new.activity is distinct from old.activity and old.activity_id not like 'ENG-%' and old.p6_activity is null then
        new.p6_activity := old.activity;
      end if;
    end if;
  end if;
  new.updated_by := auth.uid(); new.updated_by_name := public.trk_who(); new.updated_at := now();
  return new;
end $function$;
