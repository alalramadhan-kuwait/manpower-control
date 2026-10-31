-- An added step's estimated hours (owner, 31 Oct 2026): shown with the step only; it is not the plan duration, so
-- it changes neither the progress % nor the end forecast.
alter table public.trk_activities add column if not exists est_h numeric;
alter table public.trk_activities add constraint trk_activities_est_h_check check (est_h is null or (est_h > 0 and est_h <= 2000));
comment on column public.trk_activities.est_h is 'Estimated hours of a step added in the app (display only; not in the % or the forecast)';
