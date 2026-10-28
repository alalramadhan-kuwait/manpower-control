-- A hold in the start-up (owner, 28 Oct 2026): time the unit waited on something outside the start-up itself (e.g.
-- the sulfur block clearance through Operations Planning). It sits between the steps with its own from / to and
-- reason, has no plan hours and is never counted as late or on time. The shutdown end still follows it.
alter table public.sd_startup_step add column kind text not null default 'step' check (kind in ('step','hold'));
