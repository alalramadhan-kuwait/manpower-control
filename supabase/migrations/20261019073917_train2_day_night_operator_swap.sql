-- Train-2 SD 2026, as the instruction memo: the Experienced FO of the Night place works the Day place for the whole
-- shutdown and the Good FO of the Day place works the Night place. The days stay with the places (Day place: off 20, 24,
-- 28 Oct ..., 8 h on 31 Oct; Night place: off 19, 23, 27, 31 Oct ...); each person keeps his level.
-- One active place per person and plan: the Day place is set aside while the two are exchanged.
-- (As applied, the Experienced FO was found by his employee number; here by his place, the same person.)
do $$
declare v_exp uuid := (select employee_id from public.sd_members where id = '64597d14-d33e-411e-80bb-4db9d08eca14');
        v_good uuid := (select employee_id from public.sd_members where id = '52448e84-aa49-45f4-b71b-c96bd9eb0b03');
begin
  update public.sd_members set status = 'removed' where id = '52448e84-aa49-45f4-b71b-c96bd9eb0b03';
  update public.sd_members set employee_id = v_good, slot = 'good' where id = '64597d14-d33e-411e-80bb-4db9d08eca14';
  update public.sd_members set employee_id = v_exp, slot = 'senior', status = 'active' where id = '52448e84-aa49-45f4-b71b-c96bd9eb0b03';
end $$;
