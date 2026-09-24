-- Controller I and UD Engineers are not tracked in this app (Section Head, 24 Sep 2026).
-- Removes the unused controller_i position added in 20260924171012; skipped if anyone still holds it.
delete from public.positions p
where p.code = 'controller_i'
  and not exists (select 1 from public.employee_role_assignments a where a.position_id = p.id);
