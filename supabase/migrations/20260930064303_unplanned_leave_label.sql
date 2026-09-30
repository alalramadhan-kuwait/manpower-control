-- Leave entered by hand is not part of the PV plan: the type called Unscheduled Leave (UL) is now Unplanned Leave.
-- Only the label changes; the code (annual_leave_unscheduled), the short code (UL) and every record stay as they are.
update public.absence_types set label = 'Unplanned Leave' where code = 'annual_leave_unscheduled';
