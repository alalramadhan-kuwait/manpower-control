-- Train-2 tracker: the two parts of the shutdown from the bar chart (WO 19029097): operations shutdown jobs
-- 16-Oct 07:00 → 20-Oct 07:00 (96 h), M & I 20-Oct 07:00 → 7-Nov 07:00 (432 h).
update public.trk_trackers set settings = settings || '{"opsStart":"2026-10-16T07:00:00+03:00","miStart":"2026-10-20T07:00:00+03:00","miEnd":"2026-11-07T07:00:00+03:00"}'::jsonb
 where event_id = '2e94a02b-e34b-4e8f-9ae1-5a80294719df';
