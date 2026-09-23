-- Short leave codes for compact display (Day Overview, employee lists).
alter table public.absence_types add column if not exists short_code text;

-- Personal leave is shown as Personal Compassion Leave (PCP); the internal code stays.
update public.absence_types set label = 'Personal Compassion Leave' where code = 'personal_qb';

insert into public.absence_types (code, label, reduces_manpower, requires_approval, is_active, sort_order) values
  ('marriage_leave', 'Marriage Leave', true, true, true, 22),
  ('escort_leave',   'Escort Leave',   true, true, true, 23)
on conflict (code) do nothing;

update public.absence_types t set short_code = v.short_code
from (values
  ('annual_leave_planned',     'PV'),
  ('annual_leave_rescheduled', 'PV'),
  ('annual_leave_unscheduled', 'UL'),
  ('leave_extension',          'EXT'),
  ('personal_qb',              'PCP'),
  ('short_leave',              'SHORT'),
  ('marriage_leave',           'MARR'),
  ('escort_leave',             'ESC'),
  ('sick_leave',               'SL'),
  ('long_sick',                'SL'),
  ('medical_absence',          'MED'),
  ('hajj_leave',               'HAJJ'),
  ('study_leave',              'STUDY'),
  ('course',                   'COURSE'),
  ('long_course',              'COURSE'),
  ('special_leave',            'SPEC'),
  ('other_known_absence',      'OTHER')
) as v(code, short_code)
where t.code = v.code;

alter table public.absence_types alter column short_code set not null;
