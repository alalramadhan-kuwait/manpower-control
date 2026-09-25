-- Stage J audit history: the screen lists audit_log newest first (optionally without import rows),
-- so index the time order. Each workbook import adds about a thousand rows.
create index if not exists audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index if not exists audit_log_manual_occurred_idx on public.audit_log (occurred_at desc) where batch_id is null;
