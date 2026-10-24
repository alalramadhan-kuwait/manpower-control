# App knowledge — ARDS Operations (Area 4 · Unit 12)

Confirmed facts about what exists. Update this file whenever something is confirmed new (CLAUDE.md §1.7).
Last full review: 24 Oct 2026.

## 1. Modules

| Module | Logic | Screens | Main tables |
|---|---|---|---|
| Roster | `src/core/roster` (8-day cycle, anchor 2 Mar 2026 = B M1) | Calendar, Week | — |
| Manpower rules | `src/core/manpower` (Controller 1 / Panel 3 / Field 6 minimums, GREEN/AMBER/RED) | Today (`features/day`) | employees, employee_role_assignments, employee_qualifications |
| Leave plan & PV | `src/core/leave`, `pv`, `plan` | Leave planning, PV cycles | leave_records, leave_plan_changes, pv_plans, pv_plan_blocks |
| Requests | `src/core/requests`, `entry` | Requests (Approvals / Leave to approve / Shift moves, + New) | request_*, leave_requests, leave_change_requests, approval_requests |
| Leave approval (replaces Oracle) | `src/core/oracle` (`isPlanPv`, `lapsedLeave`) | Requests › Leave | leave_records.approved_* / declined_* / fix_* ; `approval_state()` |
| Shift movements | — | Profile, Requests | crew_movements |
| Controllers | `src/core/controllers` | Controllers board, Morning plan | controller_assignments, controller_rules, controller_leave_approvals |
| Operating modes | `src/core/modes` | Operation | operating_modes, operation_periods, unit_sections, unit_events |
| Shutdown teams | `src/core/shutdown` | Shutdown list, SD plan, schedule/overtime/memo documents | sd_plans, sd_teams, sd_members, sd_days, sd_phases, sd_exceptions |
| **Shutdown Progress Tracker** | `src/core/tracker` (`index.ts`, `qty.ts`) | TrackerPage (desktop: Today, Isolation, Equipment/Timing, Sequence, IATs, Report, Admin), EngineerApp (`?sd=` link: Dashboard, Equipment, Handover, SD scope, Hot work) | trk_trackers, trk_equipment, trk_activities, trk_steps, trk_points, trk_point_step, trk_qty_scope/entry/estimate, trk_event, trk_iat, trk_update, trk_forecast, trk_shift_log, trk_ask, trk_log, trk_access, trk_link, trk_measure; line-up lu_* |
| Audit & notifications | `src/core/audit`, `notifications` | History, bell | audit_log (immutable), app_activity |
| Imports | `src/core/import` | Import Center | import_batches, import_rows (Employee Number is the only match key) |

Edge functions: `manage-users` (Section Head), `request-gate` (staff), `sd-plan-approve` (Section Head),
`shift-alerts` (cron or staff). Not redeployable from the cloud session (no token).

## 2. Tracker — how it works

- **Items** (`trk_equipment`, tag, group, stage 0–6: Not HO → HO → Cleaning → Inspection → Repair → Box-up → Returned)
  and **steps** (`trk_activities`, from the P6 bar chart: planned start/finish, duration h, actual start/finish).
  P6 lines may be split into our own steps (`<id>-1…n`, the P6 line kept `tracked=false, disabled_reason='split'`).
- **Operations phase** (`trk_steps`, gates S1xx–S3xx) until the critical handover (R-12-205 HO), then **M&I**.
- **Progress** (`miWeighted`): physical % weighted by step hours; a running step counts 0 (range low–high);
  plan % by P6 dates; forecast per item from actual starts, durations and planned adjacency; controlling item = latest
  forecast; critical = float ≤ 3 days. Marked **unverified** while P6 logic links (`trk_link`) are not imported.
- **Drums** (`qty.ts`): insert-only entries, corrections point at the corrected entry; forecast by removal rate.
- **Handover/isolation** (`trk_points`): blinds and neutralization loops with field steps and soak timers.
- **Reports**: shift report (WhatsApp, plant format) and Team leader report (`leaderReportText`), both from live data.
- **History**: log triggers on activities, equipment, steps, IATs, points, qty entries, shift logs, events (`trk_log`).
- **Status updates from plant reports** are entered as data migrations (`shutdown_progress_*`), recorded as "system".

## 3. Permissions

### 3.1 Today (audited 24 Oct 2026)

| Role code | Active logins | App access |
|---|---|---|
| `section_head` | 1 | Everything; Head-only: user admin, approvals (leave, requests, PV, SD readiness/exceptions), controller rules, tracker Admin/Publish/Reset/links |
| `manpower_coordinator` | 2 | Everything except the Head-only actions (staff = `app_is_staff()`) |
| `controller` | 0 | **None** — role inactive in `app_roles`, blocked by the app gate, though `trk_can_update()` would allow tracker edits |
| `employee` | 0 | None |
| Engineer link (`trk_access`, no login) | 2 active | Tracker only: read all, update steps/points/IATs/events/drums/shift notes; no admin, no structure, no manpower data |

Database helpers: `app_current_role()`, `app_is_section_head()`, `app_is_staff()`, `trk_can_read()`,
`trk_can_update()`, `trk_access_id()`. RLS is on for every table; business actions go through security-definer RPCs.

### 3.2 Target model (three levels + assignments)

| | L1 Section Head | L2 Engineer / Asst. SH | L3 Controller | + Manpower assignment |
|---|---|---|---|---|
| Users, roles, assignments | manage | view | — | — |
| Tracker: read, update steps, drums, issues, IATs | ✓ | ✓ | ✓ (own unit) | — |
| Tracker: structure, import, publish, reset, links | ✓ | structure/import | — | — |
| Tracker: correct others' entries / backdate | ✓ | ✓ | own entries | — |
| Manpower view (Today, calendar, rosters) | ✓ | ✓ | ✓ | ✓ |
| Leave / requests: enter, correct, send | ✓ | ✓ | own requests | ✓ (all) |
| Leave / requests: approve, reject | ✓ | — (unless delegated) | — | — |
| Shift moves, controller covers | ✓ approve | propose | — | ✓ enter |
| Shutdown teams plan | ✓ approve | ✓ edit | view | ✓ edit |
| Audit history | ✓ | ✓ | own | manpower area |

To build: role `engineer` (L2), activate `controller` (L3), an assignments table (`manpower`, later others) checked by
`app_can(task)`; today's `manpower_coordinator` logins become Controller/Engineer + Manpower assignment. Pending
approval (see §7).

### 3.3 Permission gaps found

1. ~~Engineer links reach every tracker; no expiry~~ — fixed 24 Oct (part A): own tracker only, `expires_at`.
2. ~~`trk_split_lines` open to anon~~ — fixed 24 Oct (part A): Section Head only.
3. Hard delete possible: staff on employees, role assignments, qualifications, leave_records, sd_*, holidays; Head on
   user_profiles and auth users (`manage-users` delete); table DELETE grants to `anon`/`authenticated` on most tables.
4. Some Head-only UI actions are open to staff in RLS (e.g. `crew_movements` update).
5. The app gate reads `profile.role_code` rather than the server's `app_current_role()`.

## 4. Approved rules and calculations (change only with authorization)

- Manpower minimums and classification (README Stage B/C); roster cycle; leave counts only when approved for planned PV.
- Tracker: P6 baseline fixed; physical % weighted by hours, running = 0; most advanced status wins on report updates.
- Durations shown in hours (rule from 24 Oct 2026; several tracker screens still show days — gap T9).

## 5. Design standards

`.claude/skills/refinery-enterprise-design/SKILL.md`: tokens in `src/index.css` (`brand-*`, `status-*`, `crew-*`,
`whatsapp`, `knpc-*`), type scale 9–20 px by purpose, Undo toast for routine actions, WhatsApp text rules.

## 6. Shutdown Progress Tracker — readiness (24 Oct 2026)

Live tracker: 84 tracked items, 910 tracked steps (281 finished, 24 running). Unit tests: 73 pass (engine, reports,
drums). No UI, RLS or link-access tests.

| # | Gap | Level |
|---|---|---|
| T1 | ~~Links reach every tracker, no expiry, `trk_split_lines` open~~ (fixed, part A). Open: function execute and DELETE grants for anon / delete on operational tables (part B, prepared) | P0 |
| T2 | Concurrent edits overwrite silently (no version check; Undo writes old values blindly); polling 30 s / 2 min | P0 |
| T3 | Stage vs steps drift (C-201-ST, LO system at Not HO with work done; 139 steps with no stage; stage sync only on finish) | P0 |
| T4 | Engineer view records "now" only — no backdated start/finish for late reports | P0 |
| T5 | Progress entered through migrations ("system"), not by people in the app — no field attribution | P0 (process) |
| T6 | No offline queue: a write with no network fails | P1 |
| T7 | Forecast "unverified": P6 links/float not imported (`trk_link` empty); forecasts not saved | P1 |
| T8 | Hard-coded to this shutdown (R-12-205, REACTORS, 3-day threshold, TR-2 template); no create/close flow | P1 |
| T9 | Days instead of hours in tracker text (banner, float, report footer, engineer chips) | P1 |
| T10 | No stale-work alert (3 steps running > 24 h with no update) | P1 |
| T11 | No UI / RLS / engineer-flow tests | P1 |
| T12 | No active TEST tracker; TEST clock per device | P2 |
| T13 | 22 tracked loops/lines with no steps inflate counts | P2 |
| T14 | Exports: CSV and print only; no DSR PDF/Excel | P2 |
| T15 | No history for `trk_ask` and link changes | P2 |

## 8. Equipment technical information — assessment (24 Oct 2026, not built)

Standard: CLAUDE.md §6. To be built after the tracker priorities.

**What exists**

| Data | Rows | Holds |
|---|---|---|
| `lu_equipment` (P&ID line-up) | 465 | Plant asset master: tag, plant tag, name, service, type/subtype, section, train, P&ID sheets, confidence, note |
| `lu_streams` (line-up) | 749 | Connections: from → to, fluid, line no(s), size, valves (json), P&ID sheets, confidence, source |
| `trk_equipment` (per tracker) | 96 on live | Shutdown items: tag, group, description, procedure, stage, remark — per shutdown, not a master |
| `trk_iat` | 10 | IATs: number, job, line, line class, material, finding, recommendation, status, ops label |
| `trk_points` | — | Blinds and loops: ref, name, items, status |

**Missing:** a home for component details (RTJ size/rating/gasket, NRV size/flow direction, PSV set pressure …);
category-specific fields; verified vs unverified with source; attachments; history for technical edits; one search
across all of it; a link from a shutdown item (`trk_equipment`) to the plant asset (`lu_equipment`).

**Approach (no new module, no schema change per type)**
1. `tech_categories`: name + field definitions (`[{key, label, unit, type}]`) — a new category is a new row.
2. `tech_items`: category, name, tag (optional), description, location, `attrs` (json, only the category's fields),
   source / reference, verified (by, at), status active / archived, `supersedes` for revisions.
3. `tech_item_assets`: links to one or more assets (`lu_equipment` tag, `lu_streams` line, `trk_equipment` item).
4. History by trigger (old → new, who, when); attachments in Storage linked to the item; soft archive only.
5. `trk_equipment` gets its plant asset (`lu_equipment` tag) so every shutdown reuses the same technical data.
6. IATs stay their own workflow records and appear in the asset's technical list through their link (no copy).
7. UI: a "Technical" section in the existing item sheet / item page and the existing search; category admin inside
   Admin. Permissions: L1/L2 add, correct, verify, archive; L3 add (unverified) and suggest corrections.

## 9. Equipment relationships & shared handover steps — requirement (24 Oct 2026, assess later)

Requirement: relations between items (shared piping, isolation boundaries, blinds, preparation, handover); one shared
activity shown under several items without copies; clear "ready before" dependencies; a shared step's status the same
everywhere; completing a shared step never marks an item handed over; authorized editing with history; physical,
procedural and schedule relations kept apart; **isolation is never inferred from database connections — only from
verified P&IDs and approved procedures.**

Example reported by Operations: E-12-204 / E-12-205 shell side connected with no intermediate isolation. The line-up
has E-205 shell out → E-204 shell in on `P-12-2056-HR2-10"-Ih` (P&ID 113, tee to the TV-667 bypass) with no spectacle
blind listed on that line, while the neighbouring lines list one — confidence "check" (not verified). To be confirmed
on the approved P&ID and isolation procedure before any use.

**What exists:** `trk_points` (blinds, loops) already link one record to many items (`items[]`, e.g. S215 → E-204 and
E-205), with `requires[]` (blinds before a loop), `part_of[]` and links to steps; handover stays per item
(`trk_steps`, stage) and is not set by a point. `lu_streams` holds physical connections (unverified). `trk_equipment
.combine` merges display only (E-216A/B). `trk_link` (P6 logic) is empty.

**Missing:** M&I steps (`trk_activities`) belong to one item only, so a shared step needs a copy; no typed relation
between items (physical / procedural / schedule) with source and verification; no "waiting on" view for M&I steps.

**Smallest change (when approved):** a `trk_relation` table (item ↔ item, kind physical | procedural | schedule, note,
source reference, verified by/at, soft archive, logged); `trk_activities.shared_with` (other item keys) so one step
shows under each related item, counted once in progress on its owner (no calculation change); "Related" and "Waiting
on" lines in the item sheet. No automatic handover and no isolation logic.

## 7. Decisions log

| Date | Decision |
|---|---|
| 24 Oct 2026 | Leave approval in the app replaces Oracle status; only planned/rescheduled PV need approval |
| 24 Oct 2026 | Report updates: take the most advanced of report / Excel / tracker |
| 24 Oct 2026 | Durations in hours; Team leader report (option B) added |
| 24 Oct 2026 | Three user levels + Manpower assignment approved; engineer login is the target, links kept restricted with expiry meanwhile |
| 24 Oct 2026 | Equipment technical information standard adopted (CLAUDE.md §6); flexible categories; build after the tracker |
