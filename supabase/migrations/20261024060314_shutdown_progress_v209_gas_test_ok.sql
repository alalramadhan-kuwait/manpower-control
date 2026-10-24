-- Live tracker: V-209 "Last gas test failed" resolved; the 24 Oct report says the gas test is OK.
update trk_event set ended_at = now()
 where id = '52711b60-311d-495d-9a92-c4cb77ce4102' and tracker_id = '406998dc-a9ce-47ca-9a4f-fe74845b4b6a' and ended_at is null;
