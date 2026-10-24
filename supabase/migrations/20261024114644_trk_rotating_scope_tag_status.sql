-- Rotating scope verification (live tracker). No activity is moved, merged or removed; P6 ids, hours, dates, baseline,
-- progress and history unchanged. Item descriptions now say how far each tag is verified:
--   P-12-2085-GR1  Train-2 line number derived from the verified Train-1 line P-12-1085-GR1-12" (V-112 -> C-101,
--                  P&ID 1-R-12-0-117); the Train-2 sheet has not been read and no suction strainer tag is in the line-up.
--   C-12-201-E-01A/B  tags from the operations isolation procedure; not on a P&ID in the line-up (vendor LO package).
--   C-12-201-F-03A/B  tag from the equipment list only; the dry-gas filter in the same P6 line (A7700) has no tag.
-- A leftover 'not tracked' reason is cleared on items that are tracked.
do $$
declare t uuid := '406998dc-a9ce-47ca-9a4f-fe74845b4b6a';
begin
  update public.trk_equipment set description = v.d, updated_by_name = 'system (rotating scope)'
    from (values
      ('P-12-2085-GR1', 'C-201 suction line from V-12-212 and its suction strainer · TAG UNVERIFIED: line no. derived from Train-1 P-12-1085 (P&ID 1-R-12-0-117); Train-2 sheet not read; strainer has no tag'),
      ('C-12-201-E-01A/B', 'C-201 LO coolers A and B (one P6 line for both) · TAG UNVERIFIED on P&ID: from the isolation procedure'),
      ('C-12-201-F-03A/B', 'C-201 lube oil filters + dry-gas filter (one P6 line, A7700) · TAG UNVERIFIED on P&ID; dry-gas filter has no tag')) v(tag, d)
   where tracker_id = t and trk_equipment.tag = v.tag;
  update public.trk_equipment set disabled_reason = null
   where tracker_id = t and tracked and disabled_reason = 'not tracked';
end $$;
