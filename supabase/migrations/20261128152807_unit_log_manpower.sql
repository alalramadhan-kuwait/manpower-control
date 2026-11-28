-- Who was on shift, from the log's own Manpower section (owner, 28 Nov 2026: "who is the controller … compare the
-- schedule planned, who was there"). One entry per person: role, employee number, name, position, area. The app
-- compares it with the planned roster; nothing is changed in the roster from it.
alter table public.unit_shift_logs add column manpower jsonb not null default '[]'::jsonb;
comment on column public.unit_shift_logs.manpower is 'People in the log''s Manpower section: [{role, empNo, name, position, area}], as written in the log.';
