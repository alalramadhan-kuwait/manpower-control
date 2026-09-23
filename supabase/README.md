# Database — area4-manpower-control

Supabase project `fhnqaurtryfmmomvzrpl` (organisation `timekeeper-ops`, region `ap-northeast-1`).
It is a **separate project** from every Time Keeper database: separate Postgres, Auth, Storage and API keys.

`migrations/` must be able to rebuild the database in order. Every migration applied through the
Supabase MCP or dashboard gets a matching file here, named with the version the database recorded.

| Version | Purpose |
|---|---|
| `20260923060911_stage_a_foundation` | Roles, RLS helpers, organisation, employees, role assignments, qualifications, performance, sick totals, absence types, leave records, import batches/rows, audit log, `commit_import_batch()`, seed data |
