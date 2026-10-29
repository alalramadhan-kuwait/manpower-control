-- A panel reading on the black oil cut-in can be the black oil feed (KBPD) instead of a temperature (owner, 29 Oct
-- 2026): the SOP table is re-timed from the row where that much black oil goes in.
alter table public.sd_startup_reading add column if not exists black numeric check (black between 0 and 200);
alter table public.sd_startup_reading alter column temp drop not null;
alter table public.sd_startup_reading add constraint sd_startup_reading_value check (temp is not null or black is not null);
comment on column public.sd_startup_reading.black is 'Black oil feed, KBPD (a cut-in reading); the SOP row where it is reached re-times the table';
-- Train-1, 29 Oct 12:30 PM: feed 25 KBPD, all black oil (owner)
insert into public.sd_startup_reading (step_id, at, temp, black, holding, note)
select '3a3b3800-0f24-4770-8566-e6efdfbaa095', '2026-10-29T09:30:00Z', null, 25, false, 'Feed 25 KBPD, all black oil'
where not exists (select 1 from public.sd_startup_reading where step_id = '3a3b3800-0f24-4770-8566-e6efdfbaa095' and at = '2026-10-29T09:30:00Z' and black = 25);
