-- The Calendar shows the unit before the title: the five-year plan events keep the title short (no repeated unit).
update public.unit_events set title = case when title like 'RMP MRTA%' then 'RMP MRTA' else 'SD · Cat change' end
where source_ref = 'O-TS(MAB)-OP-26-0347' and tentative;
