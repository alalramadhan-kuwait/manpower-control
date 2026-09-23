-- Course and Long Course are kept apart (different duration and manpower impact).
update public.absence_types set short_code = 'LCOURSE' where code = 'long_course';
