-- A reschedule of a leave kept in several parts (e.g. two monthly-sheet records 24 Oct – 8 Nov and 9 – 16 Nov) used to be
-- refused when the new dates fell past the first part or before the last ("Correct it in the Leave plan"). Now one leave
-- with the new dates replaces every part: the first part is rescheduled through leave_save (so its history, versions and
-- the plan-change log are the same as a one-record reschedule) and the other parts are superseded by that new record.
-- Trimming or extending the first and last part works as before. Nothing else changes.
create or replace function public.change_request_decide(p_id uuid, p_approve boolean, p_remarks text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  r public.leave_change_requests; v_recs public.leave_records[]; v_n integer; v_first public.leave_records; v_last public.leave_records;
  v_ids uuid[]; v_note text; v_c public.leave_records; v_new uuid; v_rest uuid[]; i integer;
begin
  if not public.app_is_section_head() then raise exception 'Only the Section Head can approve or not approve a change.' using errcode = 'insufficient_privilege'; end if;
  if p_approve is null then raise exception 'Choose Approved or Not approved.' using errcode = 'check_violation'; end if;
  select * into r from public.leave_change_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found.' using errcode = 'no_data_found'; end if;
  if r.status <> 'requested' then raise exception 'This request is already closed (%).', r.status using errcode = 'check_violation'; end if;
  if p_approve then
    v_note := concat_ws(' · ', 'Change request approved by the Section Head', r.remark, nullif(trim(coalesce(p_remarks, '')), ''));
    if r.replan then
      select * into v_c from public.leave_records where id = r.record_ids[1] and status = 'cancelled' and superseded_by is null;
      if v_c.id is null then raise exception 'The leave changed since this request was made. Do not approve it: ask for the change again.' using errcode = 'check_violation'; end if;
      v_ids := array[public.leave_save(null, v_c.employee_id, coalesce(v_c.absence_type_code, 'annual_leave_planned'), r.new_start, r.new_end, v_note)];
      update public.leave_records set change_reason = v_note where id = v_ids[1];
      update public.leave_records set superseded_by = v_ids[1] where id = v_c.id;
    else
      select array_agg(l order by l.start_date) into v_recs from public.leave_records l
       where l.id = any (r.record_ids) and l.in_current_plan and l.status in ('approved', 'planned');
      v_n := coalesce(array_length(v_recs, 1), 0);
      if v_n <> array_length(r.record_ids, 1) then raise exception 'The leave changed since this request was made. Do not approve it: ask for the change again.' using errcode = 'check_violation'; end if;
      v_first := v_recs[1]; v_last := v_recs[v_n];
      v_ids := array(select l.id from unnest(v_recs) l);
      if v_n = 1 then
        v_ids[1] := public.leave_save(v_first.id, null, coalesce(v_first.absence_type_code, 'annual_leave_planned'), r.new_start, r.new_end, v_note);
      elsif r.new_start > v_first.end_date or r.new_end < v_last.start_date then
        -- the new dates do not keep the first and last part: one leave with the new dates replaces every part
        v_rest := array(select l.id from unnest(v_recs) l where l.id <> v_first.id);
        update public.leave_records set in_current_plan = false, status = 'rescheduled', hand_corrected = true,
          note = concat_ws(' | ', note, 'Replaced by a new version: ' || v_note)
        where id = any (v_rest);
        v_new := public.leave_save(v_first.id, null, coalesce(v_first.absence_type_code, 'annual_leave_planned'), r.new_start, r.new_end, v_note);
        update public.leave_records set superseded_by = v_new where id = any (v_rest);
        for i in 2..v_n loop
          insert into public.leave_plan_changes (employee_id, change_kind, original_record_id, current_record_id, from_start, from_end, to_start, to_end, note, by_hand)
          values (v_recs[i].employee_id, 'corrected', v_recs[i].id, v_new, v_recs[i].start_date, v_recs[i].end_date, r.new_start, r.new_end,
                  format('Corrected by hand (dates; part %s of %s joined into one leave): %s', i, v_n, v_note), true);
        end loop;
        v_ids := array[v_new];
      else
        if r.new_start <> v_first.start_date then v_ids[1] := public.leave_save(v_first.id, null, coalesce(v_first.absence_type_code, 'annual_leave_planned'), r.new_start, v_first.end_date, v_note); end if;
        if r.new_end <> v_last.end_date then v_ids[v_n] := public.leave_save(v_last.id, null, coalesce(v_last.absence_type_code, 'annual_leave_planned'), v_last.start_date, r.new_end, v_note); end if;
      end if;
    end if;
    update public.leave_records set dates_estimated = r.estimated where id = any (v_ids) and dates_estimated is distinct from r.estimated;
    perform public.leave_set_oracle(v_ids, 'not_submitted', null);
  end if;
  update public.leave_change_requests set status = case when p_approve then 'approved' else 'not_approved' end,
    decision_remarks = nullif(trim(coalesce(p_remarks, '')), ''), decided_by = auth.uid(), decided_at = now(),
    result_record_id = case when p_approve then v_ids[1] end, updated_at = now()
  where id = p_id;
  return case when p_approve then v_ids[1] end;
end $$;
revoke execute on function public.change_request_decide(uuid, boolean, text) from public, anon, authenticated;
