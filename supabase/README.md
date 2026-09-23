# Database — area4-manpower-control

Supabase project `fhnqaurtryfmmomvzrpl` (organisation `timekeeper-ops`, region `ap-northeast-1`).
It is a **separate project** from every Time Keeper database: separate Postgres, Auth, Storage and API keys.

`migrations/` must be able to rebuild the database in order. Every migration applied through the
Supabase MCP or dashboard gets a matching file here, named with the version the database recorded.

| Version | Purpose |
|---|---|
| `20260923060911_stage_a_foundation` | Roles, RLS helpers, organisation, employees, role assignments, qualifications, performance, sick totals, absence types, leave records, import batches/rows, audit log, `commit_import_batch()`, seed data |
| `20260923061353_stage_a_directory_view` | `employee_directory_v` read model (security_invoker) |
| `20260923064931_stage_a_hardening` | Advisor fixes: function search_path, revoke anon execute on role helpers, hide trigger functions from the API |

## Initial load (23 Sep 2026)

Two import batches were committed through `commit_import_batch()` acting as the Manpower Coordinator login:

| Batch | Source | Result |
|---|---|---|
| `11111111-…-0001` | `ARD's U-12 Manpower 2026.xlsx` (PV Scheduled + Jan–Dec grids) | 60 employees (48 KNPC, 12 contractors), 60 role assignments, 60 qualification records, 230 approved planned-leave records, 3 unresolved absences for review |
| `11111111-…-0002` | `Promotion October 2026.xlsm.xlsx` (as of 01-OCT-2026) | 48 employees updated with grade / position / dates / education, 96 performance rows (2025, 2026), 96 sick-leave totals, 49 Area-4 rows ignored as outside Section 1 |

Every operational row references its batch and its workbook / sheet / cell.
