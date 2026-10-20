-- Heater tube OD neutralization is sprayed after the burners are stopped: no filling, soaking or draining. A point's
-- method says how it is done (soak = fill, soak, drain · spray = start, done). H-12-201 and H-12-202 are spray.
alter table public.trk_points add column if not exists method text not null default 'soak';
update public.trk_points set method = 'spray', soak_h = null, soak_at = null, drain_at = null,
       name = replace(name, 'neutralization (soda ash)', 'tube OD neutralization (soda ash spray)')
 where kind = 'neut' and ref in ('H-12-201', 'H-12-202') and step_id is null;
