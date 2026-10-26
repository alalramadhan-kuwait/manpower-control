-- the Put back list: no access without a login, no delete for anyone (the default grants of a new table removed)
revoke all on public.trk_return_item from anon;
revoke delete, truncate, references, trigger on public.trk_return_item from authenticated;
