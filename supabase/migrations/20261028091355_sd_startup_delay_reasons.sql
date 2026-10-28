-- Why a start-up step was late (owner, 28 Oct 2026): a step over its standard or started late carries a reason, and
-- so does the waiting time before it (no step running). One quick choice each, with an optional short note.
alter table public.sd_startup_step
  add column delay_reason text check (delay_reason in ('equipment','maintenance','process','safety','other')),
  add column delay_note text,
  add column wait_reason text check (wait_reason in ('equipment','maintenance','process','safety','other')),
  add column wait_note text;
