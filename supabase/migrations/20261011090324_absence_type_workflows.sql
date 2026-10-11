-- How each absence type is entered (approved by the Section Head, 12 Oct 2026): record (applies at once), record_notify
-- (applies at once and the Section Head is told), approval (waits for the Section Head). Planned / rescheduled PV stay
-- unconfigured on purpose: they come from the PV plan and the reschedule request, never from the entry page.
update public.absence_types set workflow = 'record_notify' where code in ('sick_leave', 'long_sick', 'injury', 'medical_absence', 'death_leave', 'escort_leave');
update public.absence_types set workflow = 'record' where code in ('short_leave');
update public.absence_types set workflow = 'approval' where code in ('annual_leave_unscheduled', 'personal_qb', 'leave_extension', 'marriage_leave', 'hajj_leave', 'study_leave', 'course', 'long_course', 'special_leave', 'unpaid_leave', 'other_known_absence');
