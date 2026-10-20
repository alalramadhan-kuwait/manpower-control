-- E-12-229 has no separate soda-ash neutralization: both sides are done by the loops S111 (tube) and S318 (shell).
-- Its own entry is taken off (kept in the table, flagged removed, no items, not a handover condition).
alter table public.trk_points add column if not exists removed boolean not null default false;
update public.trk_points set removed = true, items = '{}', before_ho = false
 where kind = 'neut' and ref = 'E-12-229' and step_id is null;
