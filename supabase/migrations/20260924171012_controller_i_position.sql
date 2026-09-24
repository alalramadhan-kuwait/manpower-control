-- Controller I: the senior controller grade listed per crew on the TIME SHEET.
-- Category 'other' so it is shown on profiles but never counted as a crew's shift Controller.
insert into public.positions (code, label, category, sort_order)
values ('controller_i', 'Controller I', 'other', 13)
on conflict (code) do nothing;
