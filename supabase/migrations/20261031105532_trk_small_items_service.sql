-- The service of the small items (owner, 31 Oct 2026: "add the service or related equipment of each … for the small
-- items I don't remember the service"). From the Unit-12 P&ID lineup (Train-2 tags generated from Train-1, +400 rule).
-- Format: service · the work. Only items whose description still holds the old wording are changed.
with v(tag, old, new) as (values
 ('12-HV-0546A','Control valve shell – remove, clean, inspect, hydrotest','Hot feed E-216A/B → E-229 (P-12-2029, 8") · shell: remove, clean, inspect, hydrotest'),
 ('12-HV-0546B','Control valve shell – remove, clean, inspect, hydrotest','Resid feed E-216A/B tube-side bypass to E-229 (6") · shell: remove, clean, inspect, hydrotest'),
 ('12-HV-0548','Control valve shell – remove, clean, inspect, hydrotest','Resid feed E-203 → E-216A/B (P-12-2052, 8"; HV-548A on the lineup) · shell: remove, clean, inspect, hydrotest'),
 ('12-HV-0548B','Control valve shell – remove, clean, inspect, hydrotest','Resid feed E-203 shell bypass, P-203 → E-216A/B (4") · shell: remove, clean, inspect, hydrotest'),
 ('12-HV-0580','Control valve shell – remove, clean, inspect, hydrotest','V-212 recycle gas depressuring to flare (BD-12-2013, 10") · shell: remove, clean, inspect, hydrotest'),
 ('12-LV-0531','Control valve shell – remove, clean, inspect, hydrotest','V-206 desulfurized oil to LP hot separator V-213 (P-12-2191, 10"/12") · shell: remove, clean, inspect, hydrotest'),
 ('12-LV-0553B','Control valve shell – remove, clean, inspect, hydrotest','T-201 rich amine to the hydraulic turbine (P-12-2068, 10") · shell: remove, clean, inspect, hydrotest'),
 ('12-VC-0105','XV-12-542 d/s NRV','Emergency purge gas E-202 → resid feed at E-229, d/s XV-542 (P-12-2028, 4") · check valve'),
 ('12-VC-0106','FV-12-0548 d/s NRV','Recycle gas H-202 → R-201 feed d/s of OCR, d/s FV-548 (P-12-2036 / 2408, 6") · check valve'),
 ('12-VC-0107','FV-12-1427 d/s NRV','Hot recycle gas H-202 → R-201 guard & OCR R-205, d/s FV-1427 (P-12-2298, 8") · check valve'),
 ('12-VC-0108','FV-12-1426 d/s NRV','Unheated recycle gas E-202 → R-201, d/s FV-1426 (P-12-2306 / 2420, 6") · check valve'),
 ('P-12-2057-HRW1','Process piping inspection','HPWS effluent gas E-205 → air cooler EA-201 (12") · piping inspection'),
 ('P-12-2059&P-12-2065','Process piping inspection','HPWS off-gas EA-201 → E-207, and E-207 → V-208 (16") · piping inspection'),
 ('WP-12-2017-HRE5-1','Process piping inspection','Hot injection water from H-201 to the injection water manifold (3") · piping inspection'))
update public.trk_equipment e set description = v.new
from v where e.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and e.tag = v.tag and e.description = v.old;
