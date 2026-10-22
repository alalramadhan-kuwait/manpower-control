-- S216 (E-205 T/S to V-208) and S218 (EA-201/E-207/wash water RTJ) are one loop in the P&ID lineup
-- (E-205 T/S O/L to EA-201 to E-207 to V-208 H/C inlet). Section Head decision 22 Oct: this loop is not neutralized.
-- Both guideline steps not applicable, both loops out of the isolation list and the handover.
update public.trk_steps set status = 'na', pending_reason = null,
  remark = 'Not neutralized (Section Head, 22 Oct): S216 and S218 are one loop, E-205 T/S O/L to EA-201 to E-207 to V-208 H/C inlet'
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and step_id in ('S216', 'S218');
update public.trk_points set removed = true, before_ho = false,
  remark = 'Not neutralized (Section Head, 22 Oct): same loop as ' || case ref when 'S216' then 'S218' else 'S216' end
 where tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and kind = 'neut' and ref in ('S216', 'S218');
