-- The Section Head adds a procedure activity to an item that the bar chart does not list (e.g. a gas test before the
-- basket removal); it is tracked like the bar-chart ones (started / finished).
create policy trk_activities_insert on public.trk_activities for insert with check (public.app_is_section_head());
