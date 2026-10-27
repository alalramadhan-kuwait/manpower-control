# App knowledge — ARDS Operations (Area 4 · Unit 12)

Confirmed facts about what exists. Update this file whenever something is confirmed new (CLAUDE.md §1.7).
Last full review: 24 Oct 2026.

## 1. Modules

| Module | Logic | Screens | Main tables |
|---|---|---|---|
| Roster | `src/core/roster` (8-day cycle, anchor 2 Mar 2026 = B M1) | Calendar, Week | — |
| Manpower rules | `src/core/manpower` (Controller 1 / Panel 3 / Field 6 minimums, GREEN/AMBER/RED) | Today (`features/day`) | employees, employee_role_assignments, employee_qualifications |
| Leave plan & PV | `src/core/leave`, `pv`, `plan`, `vacation` | Manpower › Leave (Annual plan · Plan next year · PV cycles) | leave_records, leave_plan_changes, pv_plans, pv_plan_blocks, pv_allocs, pv_alloc_rows, pv_alloc_events, pv_server_checks, pv_form_uploads, pv_day_rotation, sick_imports, employee_civil_ids |
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
- **Status updates from plant reports**: pasted in the app (Progress › 📋 Paste, Update Intelligence) and applied as proposals; see §11. Earlier ones were data migrations (`shutdown_progress_*`), recorded as "system".

## 3. Permissions

### 3.1 Today (audited 24 Oct 2026)

| Role code | Active logins | App access |
|---|---|---|
| `section_head` | 1 | Everything; Head-only: user admin, approvals (leave, requests, PV, SD readiness/exceptions), controller rules, tracker Admin/Publish/Reset/links |
| `manpower_coordinator` | 2 | Everything except the Head-only actions (staff = `app_is_staff()`); unchanged |
| `engineer` (L2, active 24 Oct) | 0 | Whole app + tracker structure (`app_is_manager()`); no logins, approvals, publish/reset/links |
| `controller` (L3, active 24 Oct) | 0 | Tracker only (tracker-only screen); with the Manpower assignment the whole app like the Coordinator |
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

**Built 24 Oct 2026:** roles `engineer` and `controller` active; `user_assignments` (task `manpower`; Section Head
gives and ends, kept with who/when, audited); `app_has_task()`, `app_is_staff()` (Head, Coordinator, Engineer,
Controller + Manpower), `app_is_manager()` (Head, Engineer). The two Coordinator logins keep their role; moving them
to Controller/Engineer + Manpower is a Section Head decision in Users & access. Verified by
`supabase/tests/tracker_access_and_integrity_checks.sql` (28 checks, rolled back).

### 3.3 Permission gaps found

1. ~~Engineer links reach every tracker; no expiry~~ — fixed 24 Oct (part A): own tracker only, `expires_at`.
2. ~~`trk_split_lines` open to anon~~ — fixed 24 Oct (part A): Section Head only.
3. ~~Hard delete on operational tables~~ — fixed 24 Oct (part B). Still allowed by design: drafts, shutdown day grid,
   future-dated role/qualification corrections, holidays; auth logins can be deleted by the Section Head (`manage-users`).
4. Some Head-only UI actions are open to staff in RLS (e.g. `crew_movements` update).
5. The app gate reads `profile.role_code` rather than the server's `app_current_role()`.

## 4. Approved rules and calculations (change only with authorization)

- Manpower minimums and classification (README Stage B/C); roster cycle; leave counts only when approved for planned PV.
- Tracker: P6 baseline fixed; physical % weighted by hours, running = 0; most advanced status wins on report updates.
- Durations shown in hours (rule from 24 Oct 2026; several tracker screens still show days — gap T9).

## 5. Design standards

`.claude/skills/refinery-enterprise-design/SKILL.md`: tokens in `src/index.css` (`brand-*`, `status-*`, `crew-*`,
`whatsapp`), type scale 9–20 px by purpose, Undo toast for routine actions, WhatsApp text rules.

## 6. Shutdown Progress Tracker — readiness (24 Oct 2026)

Live tracker: 84 tracked items, 910 tracked steps (281 finished, 24 running). Unit tests: 73 pass (engine, reports,
drums). No UI, RLS or link-access tests.

| # | Gap | Level |
|---|---|---|
| T1 | ~~Link scope, expiry, `trk_split_lines`, anon function execution, hard delete on operational tables~~ — fixed 24 Oct (parts A and B), verified | done |
| T2 | ~~Concurrent edits overwrite silently; blind Undo~~ — fixed 24 Oct (field-level check on save, safe Undo, conflict message + reload) | done |
| T3 | ~~Stage vs steps drift~~ — 24 Oct: steps no longer raise a not-handed-over item; stage review list on Today (C-201-ST flagged: blinded, HO not recorded) | done (review open) |
| T4 | ~~No backdated times~~ — 24 Oct: time field on engineer steps; Section Head, Engineers and links enter any past time, Controllers/Coordinator 48 h; a reason for a correction or over 48 h back, kept in `trk_log` with who and when (no approval step, Section Head instruction) | done |
| T5 | Progress entered through migrations ("system"), not by people in the app — no field attribution | P0 (process) |
| T6 | Offline: a "No connection" bar on every screen and saves refused while offline (24 Oct, done). Offline queue not built (Section Head decision). Assessment: the app shell is cached (PWA), data is not; a save with no network fails with an error. Smallest safe step: an offline banner and blocked buttons, last data kept for reading. Full step: an outbox (IndexedDB) replayed on reconnect through the same field-level check, so a stale offline change is refused, not overwriting; the time chosen is kept, entry time = when it reaches the server | P1 |
| T7 | P6 relationships (assessed 24 Oct): `trk_link` exists (FS/SS/FF, source p6/confirmed) but is empty; the bar-chart export has no predecessor columns, so the forecast chains steps by planned adjacency within an item only. Needed: the P6 relationships export (predecessor, successor, type, lag) to import as `source='p6'` and check against the bar chart; using them in the forecast is a calculation change (needs approval) | P1 |
| T8 | Hard-coded to this shutdown (R-12-205, REACTORS, 3-day threshold, TR-2 template); no create/close flow | P1 |
| T9 | ~~Days in tracker text~~ — 24 Oct: all tracker screens and reports show hours (`daysAsHours`); calculations unchanged | done |
| T10 | ~~No stale-work alert~~ — 24 Oct: alert card on the engineer Dashboard and desktop Today (critical 6 h, others 12 h, small jobs 24 h) | done |
| T11 | Tests: unit (core), `supabase/tests/tracker_access_and_integrity_checks.sql` (28 access/integrity checks), `scripts/e2e-tracker.mjs` (screens, read-only), `scripts/e2e-tracker-conflict.mjs` (two people, TEST tracker). `scripts/e2e-tracker-desktop.mjs` (desktop + phone, every tab, report sheet; needs a Section Head login) | done |
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

## 6a. Handover vs M&I classification (fixed 24 Oct 2026)

C-12-201-ST showed "HO LATE · −4 stages" though Operations had handed it over (blinded 20 Oct 13:00). Cause: its blind
line was loaded by a migration (no stage sync) and its handover step S223 is shared and still open, so the item stayed
"Not HO" and the screen read that as a late handover. Fix: handover evidence = stage, HO step done, blinds in, or the
item's own finished blind / handover line; "HO LATE" only without any of them past the planned handover; delays of
handed-over items are "M&I LATE" with the step and department; the stage variance chip reads "M&I −n stages · h".
Audit: no other item had handover evidence while showing Not HO. C-12-201 LO system still shows HO LATE (no evidence
of its own; shares S223) — to be verified on site.

## 6a2. Neutralization: routine updates and N/R (24 Oct 2026)

Routine loop updates failed with "Give a reason for correcting a time…": a loop's time change is copied by
`trk_point_sync` onto its soda-ash steps and the time guard treated the copy as a person's correction. Fixed: copies
made inside another trigger are exempt from the reason and 48 h rules (future / order checks stay); Undo of linked
step times sends a reason. Loops have a requirement: Required, Pending decision, N/R (reason, only before the loop
starts, stamped and logged). N/R loops are left out of the Neutralized x/y count, the Isolation badge, open-loop lists
and "Not started" in the report (listed as "Not required (N/R)"); an item whose only open loops are N/R reads "ready …
N/R (confirm)" — the handover itself is still confirmed the normal way.

## 6a3. Rotating scope mapping (24 Oct 2026)

The P6 bar chart puts some lines under the main machine although they belong to other equipment. Corrected for
C-12-201-ST (rows moved, not copied; ids, hours, P6 dates kept; moves in `trk_log`): A3768 → C-12-201-E-03 (gland
condenser), A3769 → C-12-201-EJ-01 (ejector) — tag match from the plant equipment list, not yet on a P&ID —, A3765 /
A3771 / A6640 → "C-12-201-ST on-site checks". Totals unchanged (main 29–34 % / plan 45 %, 726 lines, 25,857 h).
C-12-201 corrected the same way: A7430 → V-12-212 (K.O. / suction drum; may duplicate V-212's own demister and
cleaning lines A9730/A9740/A9750 — P6 question), A6630 + A7630 → work item P-12-2085-GR1 (suction line from V-212
and its strainer, line-up not verified), A7690 → C-12-201-E-01A/B (one line for both coolers), A7700 →
C-12-201-F-03A/B (with the dry-gas filter, no tag). Totals unchanged (main 29–34 % / plan 45 %, 726 lines, 25,857 h).
A re-import / publish from the template restores the P6 mapping.

**Mapping rule (permanent).** Each maintenance activity sits on the equipment it is done on or on an independently
tracked work scope, not under its parent compressor or turbine. Unconfirmed tags carry "TAG UNVERIFIED" and their
source in the item description. Possible duplicates are flagged for a P6 decision, never merged or deleted.

Verification (24 Oct): P-12-2085 derived from verified Train-1 P-12-1085 (sheet 117), Train-2 sheet not read; no
strainer tag in the line-up; E-01A/B from the isolation procedure (vendor package, not on a line-up P&ID); F-03A/B from
the equipment list only; dry-gas filter untagged (line-up shows only the make-up H2 feed GH-12-2007 to the seal).
Open: A7430 vs V-212 A9730/A9740/A9750; A7630 vs OPR list ROW-440 (C-201 suction strainers); F-03A/B had been switched
off by the Section Head on 21 Oct before A7700 was put on it.

## 6a4. Loop diagrams (24 Oct 2026)

Each neutralization loop's sheet has a **Loop diagram** section: "View loop diagram" opens the attached drawing full
screen (pinch, drag, double-tap, ± and Fit; PDFs in the browser viewer). The engineer's loop card has a 📐 Diagram
button when a drawing exists. The app never draws connections: with no verified drawing the loop shows **"Drawing not
available"**. Every view carries "Reference only — not an authorization for isolation, line-up or chemical work."
- Data: `trk_drawing` (loop `point_id`, equipment `items`, sheet, revision, approved source, file path, status
  current / superseded / withdrawn) + private bucket `trk-drawings` (`<tracker_id>/<uuid>.<ext>`, PNG/JPG/WEBP/PDF,
  15 MB). Read like the tracker (logins and its own engineer links; storage honours the link headers).
- Attach / withdraw: Section Head, Coordinator, Engineer. A new upload of the same loop and sheet supersedes the old
  one (kept under Earlier revisions); a wrong one is withdrawn with a reason. No update or delete rights; both logged
  in `trk_log` (kind `drawing`). Drawings with no loop but matching equipment show as "Equipment drawing (not
  loop-specific)".
- Sources checked before building (24 Oct): no drawing files existed anywhere (app, database, repo); the line-up data
  (35 P&ID sheets, Train 1 + common) has no FT/FV-681…684 and the Train-2 heater sheet was not read. FT-681 therefore
  shows "Drawing not available" until the approved sheet is attached.

### Auto-generated schematics (24 Oct 2026)

Drawing rules: `.claude/skills/refinery-process-diagram/SKILL.md` (mandatory). Generator `schematic 2.0`: status
Verified / Unverified / Unknown per diagram and per connection (line pattern, not colour only: solid = verified,
long dash = Train-2 line-up unchecked, dotted = record only, dash-dot = added by a person); numbered instrument
ranges drawn as separate passes with an unresolved split; vapour outlets leave the top of vessels; junction dots only
where pipes join or split, shared segments drawn in the weakest style; line numbers only where known; record vs
line-up direction conflicts flagged (S318 had E-216 → E-203 in the record, E-203 → E-216 in the line-up: corrected 24 Oct
from the line-up as logged corrections, route P-203 → E-203 S/S → E-216A/B T/S → E-229 S/S → H-201, with the two bypasses
the record names; connections a person adds are checked against the line-up too; skipped items are routed over); metadata block
(diagram, type, loop, equipment, generated, revision auto-<hash of the data>, generator, sources, verification) and
an automatic check (topology + overlapping labels) on every sheet.

Every neutralization loop also has **"View auto-generated schematic"** (loop sheet; "📐 Schematic (auto)" on the
engineer card when no verified drawing exists). It is built in the app each time it is opened
(`src/core/tracker/schematic.ts`) and shown in the same viewer, labelled **"Auto-generated schematic — Not a verified
P&ID"**. Rules:
- A connection is drawn only when a record names both ends: the loop name / detail / items ("A → B", "A to B",
  "through C", "A to B: X, Y"), or, when those give none, the fill step ("P-203 and P-103B to H-201 inlet"). The
  loop's own instrument group (FT/FV-681…684) is placed on the lines into the item the fill reaches.
- Each connection is matched to the P&ID line-up: **verified** (sheet read, solid blue), **unchecked** (Train-2
  generated, solid amber), or **record only** (grey dashed, "line no. unknown").
- Fill (soda ash hoses), drain (drain hoses, drained to DX), vent (overflow hoses, clear soda ash at …), isolation and
  boundary blinds are listed word for word with their procedure step / blind list, beside the route: positions along
  the pipe are not recorded, and the sheet says so. Everything missing is listed under "Unknown — not in the records".
- Corrections (`trk_loop_fix`): remove a generated element with a reason, add a connection or point (purple; "checked"
  only with the P&ID sheet), add a note; withdrawn, never deleted; logged. "Rebuild from the latest data" in the viewer.

## 6b. Operational readiness review (24 Oct 2026)

Estimate ~88 % (verified functionality). Recommendation: **ready for operational use**, with the conditions below.
- Works and verified: progress, forecast (labelled unverified), drums, handover/isolation, IATs, shift and Team leader
  reports, engineer view, earlier times with reason and history, overwrite protection, stage review, no-update alert,
  offline bar, link scope/expiry, three levels, no hard delete; 31 database checks, screen scripts, 523 unit tests.
- Conditions (not code): every shift engineer gets access (a link per person or an Engineer login) and enters
  progress in the app (in the last 48 h all entries came from the Section Head login or report loads, no field
  link); C-201-ST handover verified on site and recorded; the forecast is read as unverified until P6 links exist.
- To reach 100 %: P6 relationships export imported and checked (then the forecast loses "unverified", with approval
  for the calculation change); one or two shifts of field use with feedback; future items: offline queue, T8
  generalization, technical equipment knowledge (§8), equipment relationships (§9).

## 7. Decisions log

| Date | Decision |
|---|---|
| 24 Oct 2026 | Loop schematics are generated from the records each time (not stored); connections only where a record names both ends; corrections are recorded edits on top |
| 24 Oct 2026 | Loop diagrams are attached verified excerpts (P&ID / isometric / vendor), never drawn by the app; reference only |
| 24 Oct 2026 | Maintenance activities map to their own equipment or work scope, never by default to the parent compressor / turbine; unconfirmed tags labelled UNVERIFIED |
| 24 Oct 2026 | Leave approval in the app replaces Oracle status; only planned/rescheduled PV need approval |
| 24 Oct 2026 | Report updates: take the most advanced of report / Excel / tracker |
| 24 Oct 2026 | Durations in hours; Team leader report (option B) added |
| 24 Oct 2026 | Three user levels + Manpower assignment approved; engineer login is the target, links kept restricted with expiry meanwhile |
| 24 Oct 2026 | Equipment technical information standard adopted (CLAUDE.md §6); flexible categories; build after the tracker |
| 24 Oct 2026 | No approval for earlier times: Engineers / links correct any past time with a reason and full history |
| 24 Oct 2026 | Manpower assignment = manpower and leave work only; administrative data by role (Head, Engineer, Coordinator) |
| 24 Oct 2026 | C-201-ST: blinded, handover not recorded — flagged for operational verification only, not changed |
| 24 Oct 2026 | Daily plant reports are imported in the app (Report › Import, Section Head): paste → preview (forward-only steps, status lines, drums to the report total once per report) → Save through the normal audited saves; no direct database loads |
| 24 Oct 2026 | Equipment screen: Out of scope (Section Head, reason, Restore; records and P6 lines kept, not counted, listed apart from completed work with its share of planned hours); step Not required keeps a reason; item history, related equipment (system, other lists, P&ID connections) and technical details in folded sections; name, group and system editable by Section Head / Engineers |
| 24 Oct 2026 | C-12-201 compressor items grouped as one system (display only) |
| 24 Oct 2026 | E-216A/B drawn A → B until the approved P&ID is checked (line-up notes say B first, unverified) |
| 24 Oct 2026 | Heater protection items (FE-547A/B, FSLL-547, XV-542, pump-failure interlock) added to the FT/FV-681…684 drawing as well |
| 24 Oct 2026 | Shift engineers get personal Engineer logins (entries show who reported) |
| 24 Oct 2026 | Development tasks tracked on the Development Board artifact (outside the app), updated after every task; schematic development paused after S318 |
| 24 Oct 2026 | Offline: indicator and saving off only, no queue; P6 forecast stays unverified until real relationships; R-205 / reactor setup kept for this shutdown |
| 24 Oct 2026 | Equipment scope cleanup (step-by-step review): items whose work is only cleaning / servicing / filter or oil change, with no inspection or handover of their own, are listed under **Rotating scope** (`trk_equipment.list = 'rotating'`) instead of the main Equipment list — C-12-201-E-01A/B, -E-03, -EJ-01, -F-03A/B, LO system, ST on-site checks, P-12-2085-GR1, P-12-203, P-12-205, P-12-207A/B. Display only: steps, P6 lines, hours, progress and history unchanged, counted once. Kept in Equipment: C-12-201, C-12-201-ST, -TK-03, F-12-202, P-12-203-E-01A/B, P-12-205-TK-01 and all reactors / heaters / exchangers / vessels. Open: C-12-201-F-01B (its steps repeat F-12-202's filter steps) |
| 24 Oct 2026 | Full UI audit (two independent reviews: design, operations) → one design on the Engineer view base. Done: shared toast/icons/hero cards/equipment row/step action; Engineer view role gates (Controller); reactor empty confirmed + finishes dumping; drum total via the tracker entry; loop dumping lock in both views; compact IAT and loop cards. Reactor empty: Section Head and Engineers in both views, not Controllers (owner, 24 Oct). IAT classification = the operations label in both views (owner, 24 Oct); earlier ticks kept read-only. Holds: the Section Head reason list (14 + note) in both views, equipment and loops (owner, 25 Oct). Open (owner decisions): manpower hard deletes (holidays, users, planned days, future qualifications, drafts); later: one tracker page with role tabs replacing the two shells |
| 25 Oct 2026 | Inspection worklist Nov 2026 (Inspection & Corrosion) loaded as reference: work required shown on each item ("Inspection worklist" fold, both views). 12-PSV-0516 and 12-PSV-0587 added (worklist PSV list; added steps, no plan time). P-12-203-E-01A "Offer for Rotating" → "Offer for Inspection / NDT" (P6 text kept). C-12-201-F-01B → Rotating scope (owner). Open: worklist hydrotest for P-12-203-E-01A is 240 / 225 psig vs tracker steps 225 / 135 psig; 12-PSV-1403/1404 are in the tracker but not on the worklist; HP check valve and thermowell lists not in the file; RTJ list (236 flanges, 18 lines) not yet mapped to the tracker's RTJ items |
| 25 Oct 2026 | RTJ scope = neutralization loop scope (Section Head): the worklist's 236 RTJs are kept in `trk_rtj`, linked to their loop by line number (P&ID lineup / loop records); no RTJ progress, steps, alerts or follow-up. An RTJ is handed over when its loop's items are recorded handed over (stage), never because the loop is neutralized; handed over ≠ RTJ inspection done; new work goes on an IAT. The 16 "RTJ & injection" locations covered by a loop left the Equipment list (`covered_by`); their handover is recorded in the loop sheet. Exceptions: S216/S218 (P-12-2057, WP-20-2008: 106 RTJs) are "not neutralized" loops; 32 RTJs on VT-20-2011, P-12-2274/2275, P-12-2420 have no loop; P-12-2191 and WP-20-2008 links unverified; V-206 LT bridle is in no loop (kept in Equipment) |
| 25 Oct 2026 | Engineer steps screen: Section Head can mark a bar-chart step Not required (reason, Undo; off the timing and %, kept; "Required again" from the Not required list), the same rule as the tracker. Item status line shows the newer of the written status and the latest step start/finish (H-201 showed "Pass-2 done" after Pass 4 started) |
| 25 Oct 2026 | IT rule: no company name, logo, colours or letterhead and no refinery name in the app. Removed from screens, printouts (memo, schedule, report), Excel workbook (logo, letterhead, footer, file properties), page meta and docs; logo file deleted; classification shows Company / Contractor. Kept, not visible: the internal stored value `knpc` (56 staff records), past import/audit history, P&ID reference data (lineup sheet keys), and the historical migration files |
| 25 Oct 2026 | Engineer links (login IDs such as Aad323) no longer used: all 3 turned off (Aad323, Chb699, Test01), records and history kept; Admin no longer makes or turns on links; engineers sign in with their own login. The integrity checks switch Aad323 on only inside their rolled-back transaction |
| 25 Oct 2026 | Domain flagged as suspicious (new domain, registered 23 Oct; uncategorised; login page). App side done: landing text + Sign in button, /about.html, robots.txt + noindex, /.well-known/security.txt. Owner side: Palo Alto URL category request, SPF/DMARC/CAA records in Cloudflare, IT allowlist |
| 25 Oct 2026 | IT rule, no company login: usernames like a company ID (letters+digits e.g. abc015), staff numbers or outside emails refused and blocked at sign-in (Section Head excepted, flagged on Users); everyone sets an own app password (8+, not the username, 'not my company password' tick) at the next sign-in; a password reset by the Section Head is temporary. manage-users function v8 |
| 25 Oct 2026 | Section Head vs Engineer review answered (all recommended options): one mode first, then a simple Engineer mode. Shown-only decisions: No change / Delay in both; out of scope, loop override, add field job, waiting-step override, drum estimate, report import Section Head only; field-operator steps folded (hidden for engineers); de-blind only from the Return list; phase names Fill, Soak, Drain, Neutralized; measured % with the range as a note; change log stays in Admin; Engineer tab set with Sequence and Timing as views; mode switch for the Section Head only, labelled |
| 25 Oct 2026 | Blind list (for the startup): each item with its blinds (linked line blinds + its own blind lines); positively isolated = it has blinds and all are recorded in. To check: items opened while a blind is not recorded in, items opened with no blind in the lists, line blinds linked to no item. Read only; in Isolation (Section Head) and Handover (Engineer) |
| 25 Oct 2026 | Section Head mode uses the Engineer tabs: Dashboard · Equipment (Items / Timing) · Handover (Isolation / Sequence / Map) · SD scope · Hot work (IATs / PMRs). Small jobs, rotating scope and the OPR list moved from Equipment to SD scope; PMRs to Hot work (same shared lists as the Engineer mode, the Section Head item sheet opens). Old tab links still open. Header says which mode is open |
| 25 Oct 2026 | Blind list By blind: every blind by type (Segregation, HP critical, Equipment, Valves & PSVs) with the items it isolates (tap to open) and the loops that need it; "No item linked" flagged |
| 25 Oct 2026 | One Handover page for both modes (the Engineer one): Blocking · Neutralization · Blinds · Blind list · Return, with FO filter and the item focus from an item sheet. Added from the Section Head page: the loop opens its full sheet (steps with times, field jobs, Add job for the Section Head, diagrams, items, RTJs, note); "Start anyway" on a locked loop (Section Head only, logged); the items' own blind lines under Blinds; blind note and undo. Blinds already in are folded; de-blinding only from Return. Old Isolation page removed |
| 25 Oct 2026 | Blind list made compact: one line per item / blind, detail on tap, positive items and blinds in folded |
| 25 Oct 2026 | One Hot work page for both modes (the Engineer one): IATs (status and Operations label on the card, search, Open / On items / On lines / Material / All, label chips, completed folded, a tap opens the full IAT sheet with remark) and PMRs. Old Section Head IAT list removed |
| 25 Oct 2026 | One item sheet for both modes (the Engineer one): all steps (edit, add, order, time correction, not required), main Finish / Start, issues, inspection worklist, hold, status. Added from the Section Head sheet: flags and M & I %, drums panel (entries, correct, revise estimate for the Section Head, vessel empty), No change / Delay, isolation (opens Handover on the item), stage correction, IATs (open, label, close, add), related equipment, history, technical details and edit, out of scope (Section Head). Operations and field-operator steps folded in All steps for the Section Head only |
| 25 Oct 2026 | One Equipment list for both modes (the Engineer one): All · To update · Late (late first) · groups, systems folded, a Start / Finish on each row (blind and neutralization lines are done in Handover), reactor temperatures and issues on top. Section Head also sees items followed by handover only, and Out of scope / switched off folded at the end. Old Section Head list, events card and step list code removed |
| 25 Oct 2026 | One Dashboard for both modes (the Engineer one: no-update alert, end date, main equipment, by group, issues, team today); the Section Head mode adds stage review, the day line, Operations and M & I phases (focus, controlling item, blinds) below, and keeps Report in its header. Old Section Head no-update alert removed. Both modes now share every tab; the Section Head mode keeps Sequence, Map, Timing, Report and Admin |
| 25 Oct 2026 | One interface (owner): mode switch removed; every role opens the same tracker and the role shows or hides controls (Section Head: all, incl. Admin, Timing, Sequence, Map; Engineer: operational; Controller: update actions only, plus the app with the Manpower assignment). Equipment badge = items late or on hold = its Late / hold filter (same core rule); badges say what they count. Tested: 75 role checks (navigation, gates, main actions) on a snapshot of the live tracker, all pass |
| 25 Oct 2026 | Dashboard simplified (owner: the situation in 5 seconds, no scrolling): Shutdown end · Progress · Critical (top 3 setting the end) · Operations / M & I one line each (tap = the detail sheet) · Needs attention. By group, issues, team, stage review and operations focus folded below; blinds, neutralization and near-critical in the M & I / Operations sheets and their tabs. Same data and calculations |
| 25 Oct 2026 | Dashboard labels: the end forecast shows UNVERIFIED until the P6 activity relationships are validated (`settings.p6LinksVerified`, not set); the 36 % reads "M&I work progress · main equipment" (not overall shutdown completion). Rotating scope mapping (C-12-201 / C-12-201-ST, 10 lines) re-checked: each on its own item, once, counted |
| 26 Oct 2026 | 25 Oct 19:00 plant report entered: 24 status lines, 13 steps, drums R-205 1550 and R-202 1492 (confirmed by the Section Head). **Put back list** (owner: small parts are not equipment): Handover › Return › Put back — parts taken out (orifices, NRVs, control valves, PSVs) removed → serviced → installed, with Undo and history; the tracked valves and PSVs appear there from their own steps (removal done until refit done). Not in the M & I %. 13 parts from the report loaded (tags as written). Table `trk_return_item`; integrity checks now 46, ALL PASS |
| 26 Oct 2026 | Public pages made neutral (owner): sign-in page "Operations Portal · Secure access for authorized users", shield icon, white and navy; no organisation, site, unit or shutdown named on the sign-in page, loading screen, page title, meta, install manifest, icons, about.html, security.txt or the old engineer-link page. Sign-in logic unchanged; screens after sign-in unchanged |
| 26 Oct 2026 | Status note linked to the steps (owner): an item's note is cleared when one of its steps starts or finishes after the note was written, so the item shows the step instead of an old note; a note entered together with the step (a report) stays; the old note stays in the change log (`trk_step_clears_note`, `remark_at`) |
| 26 Oct 2026 | Calendar › List (owner): the month's leave, one row per leave — name, employee no., position, crew, leave type (short code), dates, days — sorted by start date (leave running in from the month before first); filters position (Controller / Panel / Field / Others) and crew, search by name or employee no.; tap opens the leave as in the Leave plan. Same data as the Leave plan (current plan, approved / planned). Leave planning › Annual plan links to it |
| 26 Oct 2026 | Compact Operational UI (owner): permanent design rules added to the existing design skill as §0 (`refinery-enterprise-design`, no duplicate skill): 10 principles, rules (no card per record, no nested cards, two-line rows, colour for meaning, primary action visible, folds), workflow with a before → after report (rows visible, scrolling, taps); referenced in CLAUDE.md. Project-neutral copy for other projects in `docs/skills/compact-operational-ui/` |
| 26 Oct 2026 | Calendar Stage 1 — leave status and linkage (owner, Option 2, 1A/2A): one status per leave kept as four separate facts (`src/core/leave/status.ts`): plan version (current / rescheduled / cancelled), the Section Head approval (approved_at / declined_at; plan PV only; "not approved by its first day" = the existing lapse rule), the Oracle application **only from the Oracle log** `oracle_requests` (submitted / approved / rejected; entries made for past leave on 24 Sep read "assumed"; none = "No Oracle record", never assumed), and time (upcoming / on leave / taken). `leave_records.oracle_status` / `approval_state()` mirror the in-app approval since 24 Oct and are not read as Oracle. No database change: the planned approval_state change was not needed. Calendar › List: back-to-back records joined into one leave, rescheduled marked ↻ with the dates it moved from, actual crew from the manpower engine (VR "placed in A", "with A", day duty, Controller cover), leave requests waiting for the Section Head listed dashed (request_headers submitted), a pending cancellation marked on its leave; the crew filter matches the own or the actual crew. Calculations unchanged |
| 26 Oct 2026 | Calendar Stage 2 — Leave detail and Impact preview (owner): tap a leave (or a request) in Calendar › List → one sheet: person, position, grade, actual crew; the leave with its separate facts (time, Section Head approval, Oracle from the log, moved from, joined records); leave before / after; staffing = `ImpactPreview` (`src/core/requests/preview.ts`, engine only): last / next duty, annual leaves this year, each duty Ctl / P / F before → after against the minimum with **Short** (confirmed) kept apart from **Cover needed** / **Data missing**, others of the crew off, and for Controllers: Controllers off together, nth annual leave vs the 4-a-year rule, Controllers free to cover + Assign cover; versions; actions open the existing flows only (Change dates, Cancel leave… pre-selected with the reason still required, Approve in Requests › Leave, Profile). Oracle recorded only by a person: Record › submitted / approved / rejected (`oracle_request_record`, staff, who and when kept). The same Impact block in Approvals for leave requests. No automatic approval, cancellation or record change; no database change |
| 26 Oct 2026 | Shutdown — Cancellation possible (owner): the existing rule stays (a plan PV not approved by its first day does not take the person off the crew: planned available manpower until a decision, because unapproved leave may be cancelled for a planned shutdown). Display only, no calculation change: a plan PV **not approved** that overlaps an **active shutdown plan** (`sd_plans`) is marked "Shutdown — Cancellation possible" in Calendar › List and the leave sheet, with "planned availability, not confirmed attendance". Approved leave is never marked; nothing is cancelled automatically; cancelling stays the existing Cancel leave flow (reason required, Section Head decides, history kept). Proposed (awaiting review): outside a shutdown, a started unapproved leave becomes an unverified absence instead of planned available |
| 26 Oct 2026 | Calendar Stage 3 — filters, navigation, cover actions (owner): one filter bar for Month, Week and List (`features/calendar/filters.tsx`): crew (own or actual crew; Day / VR), position, type (PV / UL / Sick / Other), status (Approved / Not approved / Requested), search, Risk only; all in the address (`f`, `pos`, `type`, `st`, `q`, `risk`; old `f=shortage` still works), kept when switching view. The open day (`day=`) and the open leave (`leave=`) are in the address; scroll is remembered per address for the session. Links from the Calendar to Requests carry `back=`: Save, Cancel and Close (and ‹ Calendar) return to the same view, month, filters and open item. Month: requested leave (dashed, +n); the old Events / Holidays / Shortage chips replaced (Risk only; events and holidays always shown). Week: the filters (crew shows that row), requested leave listed, names open the leave. Day sheet: position and actual crew on names, names open the leave, **Assign cover ›** when a crew has no Controller (opens the existing Controller assignment for that crew and day). Grey status reads "Cover needed" or "Data missing". Escape closes any sheet. No calculation or approval rule changed |
| 26 Oct 2026 | Calendar Stage 4 — compact and confirmed vs potential (owner): calculation unchanged. Shortage shown two ways: **confirmed** (short even with only approved leave) solid red, **potential** (short only because of planned leave not approved; also one not approved by its first day) dashed red, in Month, Week, the day sheet and Needs attention (`shortageKinds` / `leaveScenarios` in `src/core/calendar`). Month: one summary line (days by worst shift), Key folded, Needs attention under the grid, Events & holidays folded with the Annual plan link (phone 1,164 → 926 px). Week: same line, `−C` where a crew has no Controller. List: third line only for what needs attention (on leave, not approved, Oracle submitted / rejected, moved, joined, cancellation asked, shutdown); the sheet keeps every fact. Shutdown-team members: the app uses their recorded duty days (sd_days, 14 of 14 recorded for Train-2 SD); none assumed. Checked 18/18 on phone and desktop |
| 26 Oct 2026 | Calendar leave rows and actions (owner): every leave row has one state (`rowState` in `src/core/leave/status.ts`, first that applies: cancelled / not approved → rescheduled → awaiting approval (also started without approval: "On leave · Not approved"; a request: dashed bar) → on leave → approved upcoming → taken), shown as a subdued fill, a thin left bar and its word in List, the leave sheet, Week and the day sheet (`features/calendar/rowStyle.ts`). "Approved" = the Section Head approval; all Oracle status removed from the Calendar. Cancelled and replaced versions only under Status › Changed. Day sheet lists leave started without approval apart ("counted as planned available"). Leave sheet actions, existing workflow only: planned PV — Approve / Reject (reason) / To fix (note) / Undo for the Section Head (`leave_approve`, `leave_decline`, `leave_send_fix`, which check the role), Reschedule (PV form with its check, back to the same place); fixed leave types — Cancel with a reason through the server check (`cancelLeaveEntry`, shared with Requests); a request — Review in Approvals. Staffing impact shown before approving. No approval rule or calculation changed. Correction plan for the consistency audit: `docs/plans/manpower-consistency-corrections.md` (not applied) |
| 26 Oct 2026 | Consistency items 1 and 2 (owner): server functions synced with the app engine (`request-gate` v6, `sd-plan-approve` v12, `shift-alerts` v11, from commit `c886300`; were 18 Oct builds without the 24 Oct leave-approval rule); approvals only through the server check (migration `20261026094736_approval_paths_checked_only`: execute revoked on `approval_decide`, `request_header_decide`, `request_decide`, `change_request_decide`). Tests `supabase/tests/approval_paths_checks.sql` 15 PASS (rolled back), integrity ALL PASS (46). Items 3 and 4 not applied |
| 26 Oct 2026 | Consistency items 3 and 4 (owner): request check warning `controller_coverage` ("Controller cover needed on N duties", warning only, never blocks); `request-gate` v7, `sd-plan-approve` v13, `shift-alerts` v12 from commit `003bd95`. Task releases now counted in the paper-form request impact and the PV move impact (`absencesAll`). Shutdown team check still leave only (separate decision). No rule, permission or approval logic changed |
| 26 Oct 2026 | Shutdown check counts task releases (owner): `PlanCheckInput.releases` used for the crews' minimums on a member's rest day and for the Controller cover candidates; own schedule, team cover and fingerprint stay leave only. Minimums and approval authority unchanged. `sd-plan-approve` redeployed |
| 26 Oct 2026 | Shutdown team cover counts task releases (owner): `awayFromTeam` (approved leave or a task release) in the plan check's team cover and rest-day offers, the planner, the shutdown page team days / gaps and the incomplete-shutdown notice. Overtime, leave-clash counts, minimums, approvals and fingerprint unchanged. No active task release today |
| 26 Oct 2026 | Calendar leave sheet and List, compact (owner, mock-ups A–D): sheet shows who + state, leave line, three figures (duties, short = confirmed + potential, leave this year), one conclusion, Controller warnings (off together, over 4 a year) and Controller cover needed always visible, Approve · Reject · ⋯ (To fix, Reschedule, Cancel, Versions, Profile); duties, cover, crew also off, shutdown rule, before / after, duty around and versions folded. Confirmed vs potential = the Calendar's `leaveScenarios` read through two previews (`shortSplit` in `core/requests/preview.ts`), no new rule. List rows always two lines (SD / Cancel? / Fix chips; moved-from and records in the sheet); labels "Awaiting", "Approved · N d". Actions, permissions, calculations unchanged |
| 26 Oct 2026 | Leave sheet validation (read only, owner): roles in the browser harness — Section Head: Approve / Reject / To fix / Undo; Coordinator, Engineer, Controller with Manpower: no decision buttons (Reschedule, Profile, Review in Approvals only); Controller without Manpower: tracker only. Server, rolled back: 26/26 PASS (only the Section Head can approve, reject, send to fix, undo or decide a request; anon refused). Shortage display with injected test leave (harness only, nothing saved): 5 scenarios, confirmed / potential as expected and the same as the day sheet. Navigation 15/15 PASS (sheet in the address, Escape, scroll kept, Reschedule / Assign cover / Approvals with the way back, Profile, day sheet → List, Week / Month). No record or rule changed |
| 26 Oct 2026 | Annual vacation planning (owner, full project): Leave planning › Plan next year, seven steps (Manpower · Approve · Forms · Selections · Review · Publish · Share). Section Head only approves (manpower allocation, then the plan); approval publishes to `leave_records` in one transaction, on a fresh server check (`vacation-plan` edge function, fingerprint, 15 min). Rules in `core/vacation/rules.ts` (4–5 periods of whole cycles, slots floor(n/4) within the minimums, Panel group 4, acting Grade 13 sick > 30 excluded, Controllers 1 off unit-wide). Oracle stays separate (`oracle_requests` untouched; `oracle_status` only mirrors approval). 2027 left as a draft: nothing approved on the owner's behalf |

## 10. Annual vacation planning (26 Oct 2026)

- **Where**: Manpower › Leave › Plan next year (`/manpower?tab=leave&sub=next&year=&step=`; `/leave-planning` and `/vacation-plan` redirect). PV cycles shows a draft year read only and links here.
- **Steps**: 1 Manpower (tabs A–D + Relief; Controller / Panel / Field; move, switch, role, relief, undo; versioned, never changes the directory; sick import by Civil ID, stored hashed + last 4) → 2 Approve (summary + checks; Section Head; locks the version; reopen with a reason) → 3 A3 forms (Controllers + Day Supervisor rotation, Panel, Field A–D; corner marks + ID strip) → 4 Selections (grid: whole cycles, Full / Conflict / Restricted with reason, keyboard, undo; or upload scans / photos: read, unclear left to decide, nothing saved until Save) → 5 Review (filters, fill missing periods = System Assigned) → 6 Approve & publish (server check, atomic, idempotent) → 7 Share (final PDFs from the Calendar's records; later changes marked *).
- **Rules**: `src/core/vacation/rules.ts` `VAC_RULES`; slots `slotsFor(n, min) = max(0, min(floor(n/4), n − min))`; acting Panel = Grade ≥ 13, rolling-12-month sick ≤ 30, highest employee number first, only as many as needed (`ACTING_PANEL`, shared with the Today engine).
- **Server**: migration `20261026132242_annual_vacation_planning`; edge function `vacation-plan` (`check_alloc`, `approve_alloc`, `check_plan`, `approve_plan`); test `supabase/tests/vacation_plan_checks.sql` (rolled back, year 2031).
- **Limits**: OMR reads only forms printed by the app with all four corner squares and the strip visible; rolling sick data must be imported before the acting rule can exclude anyone; leave entitlement / balances are not checked by the plan.
| 27 Oct 2026 | Navigation (owner, mock-up approved): bottom bar Today · Calendar · Manpower · Shutdowns · More. Manpower = Requests (waiting badge) · Employees · Controllers (Cover, Morning rotation) · Leave (Annual plan, Plan next year, PV cycles); Shutdowns (`?section=`) = Progress (the tracker, its own `?tab=`) · Plans · Unit status · FO levels (Head); Calendar has a Leave | Controllers switch (`?board=controllers`, last choice remembered per device); Today shows a Waiting-for-you row and a Controllers calendar link; More keeps Data quality, Excel import, Administration, Notifications. Every old address redirects (`Legacy` in App.tsx) with its query kept. Permissions, data and calculations unchanged |
| 27 Oct 2026 | Tracker update intelligence (owner, full project): Engine A reads pasted departmental reports (deterministic site rules, no outside AI service: none is approved or configured) into facts and proposals (step finish / start, status line, drums, new step, defect, hold confirmed · possible · at risk, planning figure, info / review), applied one tap through the tracker's own saves; latest valid information wins, never moved back, cumulative counts within tolerance (10 units / 1 %, Admin-editable, site to validate) take the higher value, a day's count is never added, a defect is not a hold, Train-1 conditions stay out of Train-2 progress, unknown tags are review items. Engine B stores the official Maintenance Planning planned / actual % per report date (revisions, never overwritten), apart from the tracker's work progress and the finish forecast; five candidate methods are computed from the P6 lines and compared with every dated figure: **unverified** until two dated figures are reproduced (one figure held, 51.01 / 51.01; Planning's activity list, weights / man-hours, cutoff and running rule are not in this system). Reports carry the official line and the holds. Permissions unchanged (`trk_can_update`) |
| 27 Oct 2026 | Rules page (owner, mock-up approved; four decisions agreed): every organization rule on one page under More (`/rules`), grouped Crew minimums · Leave · Vacation plan · Controllers · Shift checks · Shutdowns · Tracker. Everybody reads; only the Section Head changes, with a reason, inside the allowed range, from today forward (approved leave, published plans, approved or finished shutdown plans keep their rule). Every change kept (`app_rule_changes`). The old editors (unit sections, mode minimums, Controller shift cover length, tracker count tolerance) are read-only with a link to the page. Seeded values equal the old fixed numbers: no calculation changed |
| 27 Oct 2026 | Shutdown manpower is one standard (owner: "Standard", "Follow the latest SD rules"): team places come from the latest rules (final 14 Oct: 1 Controller, 1 Experienced FO, 2 qualified FOs every minute of a 12-hour shift; New FO never counts) = 1 Controller · 1 Senior FO · 1 Good FO on full and reduced days; the New FO place is training only and stays per plan. The Rules page rule "Shutdown team standard" sets it; the database keeps train plans on the latest rules, not approved and not finished, on it (`sd_teams_standard`) and passes a change on. Older-rule, approved and finished plans keep theirs (the current Train-2 SD already 1 · 1 · 1). Tracker (owner's notes): Max bed temperature card removed from Equipment; Not required is one tap with Undo (steps and loops, no reason asked; a loop records "Not required"); after Apply a line shows the item's and the M & I progress before → after |
| 27 Oct 2026 | Owner's answers (answer page): **late** = a P6 date has passed and the step has not started or finished, red from any delay: the step's plan line turns red with "start late" / "finish late" in the tracker step lists (the existing `lateStart` / `lateFinish`, display only, no calculation changed). **Unit status history** (date and time of each change, link to the shutdown plan): Shutdowns › Unit status › Unit status history, read from the audit log through `unit_status_history()` (no names). Plan section of the notes: nothing. Five-year shutdown plan and employee handbook: to be uploaded later |
| 27 Oct 2026 | Tracker Updates multi-select (owner): Select on the Updates list, tick rows, a whole group (Select N) or Select all, then Apply (only what one tap could apply; a conflict still needs its own Apply anyway) or Dismiss (kept as dismissed, "dismissed with others") together; same saves as one row at a time |
| 27 Oct 2026 | Several statuses for one item (owner's note "what will it do if there are multiple statuses?"): when two reports propose a status line for the same item, only the newest by report time can be applied; the older ones show as **Older** (info, can be dismissed), worked out each time the list is read (`latestStatusOnly`, nothing stored). Batch Apply applies in report-time order so the later report lands last. Steps: a report's work with no step of its own is proposed as a new step for review; cleaning / hydroblasting sub-items join their work family instead |
| 27 Oct 2026 | Updates clearer (owner: "too much text, not clear how much the progress will change"): an open update shows first what it does to the progress (finish: item and M & I before → after; start: no change now, and what it adds when the step finishes; a note or an added step: no change), computed with the tracker's own progress; the doubled ▶ icon removed; shorter wording. Matching fixed: repair, opening and box-up steps take a report only for the same object or when the step is general ("Repair if required"); a collector ring repair is no longer put on the thermowell bracket repair, a step is suggested for review instead. Cleaning and inspection still fold into their family's step |
| 27 Oct 2026 | Updates by item (owner: "either part of a step, proceed and give the progress, or a missing step to add"; mock-up shown): three counts on top (To check · Ready · Notes); one card per item with its step lines (start / finish), a missing step with Add, the status line riding with the card, and the progress before → after (or when done); To check first (missing step, defect, hold, conflict), then Ready with Apply all; notes (items not in this tracker, unclear lines, Train-1, older statuses), applied today and reports read folded at the bottom. Same saves as before |
| 27 Oct 2026 | Paste update result in item cards too (owner: "it should show the progress based on this update"): the counts, one line with what the whole report does to the M & I progress (steps finishing and starting, now and when the started steps finish), Apply all ready, the item cards with their own progress, notes folded |

## 11. Tracker update intelligence (27 Oct 2026)

- **Where**: Shutdowns › Progress: 📋 Paste (header), the Updates summary line under the overview, the Dashboard | Updates view (filters All · Ready · Proposals · Conflicts · Applied), the item sheet's Latest update, the Maintenance Planning block on the Progress view with "How was this calculated?" and History, the Team leader / shift report lines.
- **Code**: `src/core/tracker/intel/` (`parse.ts` statements → facts, abbreviations EN/AR; `reconcile.ts` facts → proposals, `latestFor`; `planning.ts` candidates A–E, `reconstruct`, `planningView`, `reconciliationNotes`), `src/data/trackerIntel.ts` (store, apply, planning), `src/features/tracker/intel/`. Tests: `src/core/tracker/intel/__tests__/intel.test.ts` (the 11 acceptance reports of the specification + latest-information rules); browser harness `scratchpad/snap/intel.mjs` on the live snapshot (24 checks, 393 / 1280, Section Head and Engineer).
- **Tables**: `trk_report`, `trk_finding`, `trk_proposal`, `trk_planning_progress`, `trk_reconcile` (migration `20261027072231`), insert-only; a proposal changes only in its review fields.
- **Rules kept**: P6 baseline never written; no actual time invented (the report's shift end, never after submission); safety-critical operational steps are never changed by a proposal (holds set a pending reason, nothing else); Engineer authority as before; overwrite protection and the change log as before.
- **Limits**: interpretation is rule-based (an AI provider slot can be added only with an approved data-handling arrangement); valves are followed on the put-back list, not as steps; the official Planning method is unverified until Planning's inputs are provided.

## 12. Rules page (27 Oct 2026)

- **Where each rule lives.** Rules already in the database stay there: crew minimums (`operating_modes`, `unit_sections`), shift checks (`validation_rules`), Controller shift cover length (`controller_rules`). The numbers that were fixed in code are in `app_rules`. `app_rule_value(key)` reads any of them; `app_rule_set(key, value, reason)` is the only way to change one.
- **How the app follows.** `src/core/rules` lists every rule (label, description, effect, fields) and `applyRuleValues` writes `app_rules` into the objects the code computes with (`ACTING_PANEL`, `PV_RULES`, `VAC_RULES`, `CONTROLLER_LEAVE_RULES`, `V2_DEFAULTS`, `SD_MINIMUM`, `SICK_RULES`, `STALE_H`, `DEFAULT_TOLERANCE`). The app applies the last values seen on the device at start and the database's at sign-in (`src/data/rulesClient.ts`); each server function (request-gate, sd-plan-approve, shift-alerts, vacation-plan) reads them per request (`loadAppRules`). The vacation plan's periods cap in SQL reads `pv_rule('max')`.
- **Shutdown overtime.** A change also reaches active shutdown plans not yet approved; approved and finished plans keep theirs.
- **Shutdown team standard.** `sd.team_min` also gives every team its places (Controller, Senior = experienced, Good = qualified − experienced) through `sd_team_standard()`; see the decision of 27 Oct.
- **Not exposed** (no effect today): Panel / Field max off at once in PV, Controllers off across the unit.
- **Tests.** `supabase/tests/app_rules_checks.sql` (22 PASS, rolled back); `src/core/rules/__tests__`.
