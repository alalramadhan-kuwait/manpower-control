-- Check valves: the valve they sit after is enough (owner, 31 Oct 2026: "It is enough to say d/s XV-542").
with v(tag, new) as (values
 ('12-VC-0105','d/s XV-542 · check valve'),
 ('12-VC-0106','d/s FV-548 · check valve'),
 ('12-VC-0107','d/s FV-1427 · check valve'),
 ('12-VC-0108','d/s FV-1426 · check valve'))
update public.trk_equipment e set description = v.new
from v where e.tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and e.tag = v.tag and e.description like '%· check valve';
