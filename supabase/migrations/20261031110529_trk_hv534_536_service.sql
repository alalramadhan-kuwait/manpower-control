-- HV-534/535/536 service from the owner (31 Oct 2026): recycle gas filter F-12-202 bypass / inlet / outlet.
with v(tag, new) as (values
 ('12-HV-0534','F-202 bypass (FC) · shell: remove, clean, inspect, hydrotest'),
 ('12-HV-0535','F-202 inlet (FO) · shell: remove, clean, inspect, hydrotest'),
 ('12-HV-0536','F-202 outlet (FO) · shell: remove, clean, inspect, hydrotest'))
update public.trk_equipment e set description = v.new
from v where e.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and e.tag = v.tag and e.description = 'Control valve shell – remove, clean, inspect, hydrotest';
