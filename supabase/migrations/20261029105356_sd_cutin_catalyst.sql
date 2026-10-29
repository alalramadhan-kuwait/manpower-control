-- Cut-in estimate v3 (owner, 29 Oct 2026): the R-105 catalyst decides whether R-105 gives heat during the heat-up.
-- Train-1's Oct-26 start-up ran on fresh catalyst (no exotherm, R-105 inlet raised to 634 °F).
update public.sd_startup_step set cutin = cutin || '{"catalyst": "fresh"}'::jsonb where id = 'fc1ca5e8-ad2f-4884-8b66-abba72fabd70' and cutin is not null;
