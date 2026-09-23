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
| `20260923073637_import_leave_updates` | `commit_import_batch` step 5b: an unresolved grid absence whose dates moved in a newer workbook is updated in place (only while still unresolved, pending review and untyped); classified records are never touched |
| `20260923081416_leave_plans_and_names` | Original vs current leave plan flags on `leave_records` (+ `rescheduled` status, links), `leave_plan_changes` history table, `leave_current_v`; `employees.full_name` → `official_name` plus `display_name`; commit function steps 5b–5d (dates moved, rescheduled, cancelled) |
| `20260923131508_leave_short_codes` | `absence_types.short_code` (PV, UL, SL, MED, HAJJ, SHORT, PCP, MARR, ESC …); Personal QB relabelled Personal Compassion Leave; new Marriage Leave and Escort Leave types |
| `20260923133431_long_course_code` | Long Course gets its own short code `LCOURSE` (Course stays `COURSE`); Special Leave stays `SPEC` |
| `20260923142500_import_monthly_sheets_real_leave` | `commit_import_batch`: replacement records take their source kind from the plan (monthly sheets), one block may be split into several taken pieces, new step 5e `not_taken` (leave not marked on the monthly sheets leaves the current plan, kept in history; hand-entered records never touched) |
| `20260923143335_controller_assignments` | Stage H: `controller_assignments` (shift cover and Morning rotation) with the rules in the database: Grade 15+ Controllers only, max 2 months, no overlapping assignments per person (a VR cannot cover two shifts at once), one cover per crew per day, one Morning rotation at a time, no covering your own crew, cancelled rows kept and locked, no delete policy, audit trigger. Adds `btree_gist` |
| `20260923151023_controller_rules_cover_length` | Stage H correction: the 2-month maximum now applies to Morning rotation only; shift cover lasts the actual period unless `controller_rules.shift_cover_max_days` is set (null by default, Section Head only, audited) |
| `20260923151145_audit_non_uuid_ids` | `audit_row_change` tolerates non-uuid ids (entity_id null; full row still recorded) |
| `20260923153659_import_keeps_manual_roles` | A role or crew set by hand is never replaced by a workbook import: `employee_directory_v` adds `role_source` / `role_note`; `commit_import_batch` step 3 leaves a manual current role in place (the import row becomes a review note instead of deleting or closing it) |
| `20260923155805_stage_e_manual_leave` | Stage E: leave entered or corrected by hand. `leave_records.hand_corrected`; `leave_plan_changes` gains change kind `corrected` and `by_hand`; `leave_save()` (add, or correct one current record: in place for a hand entry or a type-only fix, otherwise a hand-entered replacement with the imported record kept as `rescheduled` history) and `leave_cancel()` (out of the plan as `cancelled`), both staff-only, audited, refusing overlaps and requiring a reason for corrections; `commit_import_batch` steps 5c/5d/5e leave hand-corrected records alone |

## Edge Functions

| Function | Purpose |
|---|---|
| `manage-users` | Users & access screen. Creates, edits (name, username, role, password, sign-in on/off) and deletes logins through the Auth admin API, which needs the service key and so cannot run in the browser. Every call checks the caller's own session: only an active Section Head is allowed. It refuses to disable, demote or delete the caller's own login, or to leave no active Section Head. Each change writes an `audit_log` row (`entity_table = user_accounts`); passwords are never logged. Deployed with gateway JWT verification off because the function verifies the token itself. `rules.ts` is a byte-identical copy of `src/core/users/rules.ts` (a test enforces it). |

## Initial load (23 Sep 2026)

Two import batches were committed through `commit_import_batch()` acting as the Manpower Coordinator login:

| Batch | Source | Result |
|---|---|---|
| `11111111-…-0001` | `ARD's U-12 Manpower 2026.xlsx` (PV Scheduled + Jan–Dec grids) | 60 employees (48 KNPC, 12 contractors), 60 role assignments, 60 qualification records, 230 approved planned-leave records, 3 unresolved absences for review |
| `11111111-…-0002` | `Promotion October 2026.xlsm.xlsx` (as of 01-OCT-2026) | 48 employees updated with grade / position / dates / education, 96 performance rows (2025, 2026), 96 sick-leave totals, 49 Area-4 rows ignored as outside Section 1 |

Every operational row references its batch and its workbook / sheet / cell.

## Second workbook import (23 Sep 2026)

Batch `a4b7c9d1-3e5f-4a6b-8c9d-0e1f2a3b4c5d`, file "ARD's U-12 Manpower 2026.xlsx" (supersedes "(1)"), staged as the
Manpower Coordinator and committed with `commit_import_batch` after Section Head approval. Rules applied:
"PV Scheduled" = original annual plan (baseline, frozen; differences flagged, never rewritten), "PV Scheduled Updated" =
current approved plan, monthly sheets = operational record compared against the current plan plus roster Off days.
Result: 8 reschedules (originals kept with status `rescheduled`, linked to the new blocks), 1 addition to the current plan
(one contractor Panel Operator, 8–13 Mar; absent from the previous workbook, so the baseline was not modified), 0 cancellations,
2 unresolved absences re-dated with a `source_data_changed` history row (one D-crew and one A-crew Field Operator),
59 new unresolved absences (unclassified, pending review, with sheet/cell and roster context in the note).
Only the 74 acting rows were staged; the 405 unchanged preview rows are counted in the batch summary.


## Unresolved absences resolved by rule (23 Sep 2026)

Data change only (no schema change, so no migration file). Applied in one transaction as the Section Head login;
every `leave_records` change is in `audit_log` and every plan change has a `leave_plan_changes` row.

Section Head rule: **when the monthly sheets and "PV Scheduled Updated" disagree, the monthly sheet is the real leave.**

- 62 unresolved absences (marks on the monthly sheets outside the current plan) → `approved`, `review_status = resolved`.
  Type follows the sheet colour key: 42 planned (incl. 11 cells whose colour is not in the key), 14 rescheduled,
  4 unscheduled, 2 special leave. 51 get an `added` history row; 11 are linked as the new dates of a moved block.
- 23 current-plan blocks with no marks on the monthly sheets → `rescheduled`, out of the current plan
  (11 linked to the dates they moved to, 12 with no matching new dates).
- 18 current-plan blocks only partly marked → `rescheduled`; the marked days become a new current record
  (`source_kind = monthly_grid`, linked via `rescheduled_from`).
- The baseline ("PV Scheduled") flags were not changed.

Result: 0 unresolved; 271 current approved records, identical to the monthly sheets on every working day
(the only differences are roster Off days next to leave, which are never counted). 2026 evaluation: 12 confirmed
shortage duties (Panel 2/3: A crew 10–15 Feb, C crew 7–12 May), 224 Controller-coverage-required duties, 859 final Amber.

## Morning Controller post and D Shift cover (23 Sep 2026)

Data change only, entered as the Section Head login (the same writes the profile's "Correct role / crew" sheet and
the Controllers screen make); all three rows are in `audit_log`.

Section Head: the Morning Controller post is empty until the rotations start in 2027; the Controller the workbook lists
as Morning Controller is acting as an additional Vacation Relief Controller meanwhile, and is covering D Shift.

- Role: the imported `morning_controller` row is closed on 22 Sep (kept as history); a manual `vr_controller` row starts
  23 Sep with that reason as its note. With no Morning Controller recorded the post shows as empty, with no flag.
  A later workbook import cannot switch it back (migration `20260923153659`).
- `controller_assignments`: shift cover of D Shift, 8–23 Sep 2026, covering the D Controller's leave (8–21 Sep;
  D is Off 22–23 Sep; back 24 Sep).
- VR planning now has two VR Controllers: the overlapping December gaps (C 1–14 Dec, B 7–20 Dec) are both covered
  and "Additional Controller required" no longer appears; B's suggested VR carries a note that they are on leave
  17–20 Dec.

