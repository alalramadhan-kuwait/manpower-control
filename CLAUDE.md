# ARDS Operations — project rules (mandatory)

Area 4 · Unit 12 operations app (KNPC Mina Abdullah Refinery): manpower, leave, shift control, shutdown teams and the
Shutdown Progress Tracker. Live at https://ops12ards.com (Vercel, deploys from `main`; check `/version.json`).
Supabase project `fhnqaurtryfmmomvzrpl` — its own project. It shares **nothing** with Time Keeper.

Read before any work: `docs/APP_KNOWLEDGE.md` (what exists, data, rules, permissions) and the two skills:
`.claude/skills/feature-workflow` (how every request is handled) and `.claude/skills/refinery-enterprise-design`
(how every screen, report and message looks).

## 1. Every request

1. Understand it: who uses it, the question it answers, the action it allows, what goes wrong if it is misread.
2. Inspect what exists (code, database, `docs/APP_KNOWLEDGE.md`) and **reuse it**. No rebuilding.
3. List what is missing or unclear. Decide minor points yourself; ask only about safety, a change to an approved
   business rule, calculation, workflow or baseline, or a requirement that cannot be found in the app.
4. Build the smallest complete change, following the design skill.
5. Every user-managed record gets a correction path (edit, undo, correct, revise or cancel) and keeps its history.
6. Test function, permissions and persistence (§6). Report briefly what changed, what was verified, what remains.
7. Update `docs/APP_KNOWLEDGE.md` with anything confirmed new.

## 2. Priorities (do not jump ahead)

1. **Shutdown Progress Tracker** — complete, reliable, tested, operational. Current gaps: `docs/APP_KNOWLEDGE.md` §6.
2. **Startup Preparation** — only after the tracker is accepted; reuse shutdown data, equipment and workflows.
3. **Other modules** — only when asked.

No unrelated improvements or redesigns while a priority is open.

## 3. Data integrity (non-negotiable)

- Never invent data. Unknown stays unknown; a time not given is recorded as "now" and said so.
- The **P6 baseline is never changed**. Splits and re-timing live on our own steps inside the P6 window.
- Status updates from reports: take the most advanced of the report, the Excel and the tracker.
- Keep three things apart and label them: **Operations handover** (HO done / HO late — late only against the planned
  handover with no handover evidence: HO step done, blinds in, or the item's own finished blind / handover line),
  **M&I progress and delays** (shown as "M&I", with the step and the department), and **P6 schedule variance**.
  Never infer who is responsible from a stage field alone; a shared handover step left open is not a late handover.
- "Not required" is never "done": an N/R loop keeps its reason, who and when, is left out of outstanding counts,
  shown apart, and is not taken as safe for handover or blinding.
- Validation for people's edits (reasons, 48 h) must not hit updates that triggers copy from another record.
- A P6 line on the wrong equipment is moved (same row, ids, hours, P6 dates) to its real tag or a named work item, never
  copied; totals checked before and after; no invented tags.
- Each maintenance activity is mapped to the equipment it is done on (or an independently tracked work scope such as a
  line, strainer or filter set), never grouped under its parent compressor or turbine by default. A tag not confirmed on
  a P&ID is labelled UNVERIFIED with its source; a possible P6 duplicate is flagged, never merged or deleted without
  the confirmed scope.
- Approved calculations (manpower minimums, roster cycle, tracker progress/forecast) change only with authorization.
- **No hard delete** of user records. Use soft states (cancelled, voided, declined, superseded) that keep links and
  history. No DROP / TRUNCATE / unscoped DELETE; production data changes only with confirmed mappings.
- Never touch the Time Keeper repo or database, `kids_carb_*` tables, or Supabase Auth tables.

## 4. Database

- Batch a feature's schema changes into **one migration**. Every applied change gets
  `supabase/migrations/<recorded version>_<name>.sql` and a row in `supabase/README.md`. The folder must rebuild the
  database in order.
- Authorization is enforced in the database (RLS, security-definer RPCs that check the role), not only in the UI.
- Every new function: `revoke execute ... from public, anon` in its migration (default privileges do not cover
  migrations), unless an engineer link needs it. `supabase/tests/tracker_access_and_integrity_checks.sql` must end
  `ALL PASS` after any change to access rules.
- Edge functions: bundles are built by `npm run functions:build` (a test fails if a bundle is stale). This environment
  has no deploy token: say so when a function change needs deploying.

## 5. Permissions

Three levels plus task assignments — see `docs/APP_KNOWLEDGE.md` §3 for the matrix and its current status.
Section Head > Engineer / Assistant Section Head > Controller; extra rights (e.g. Manpower) come from an assignment,
not a promotion. New features state which level may view, create, correct and approve, and enforce it in the database.

## 6. Equipment technical information (standard)

Every equipment item is the central reference for its technical information (PSV, RTJ, NRV, IAT are examples, not a
fixed list: any component, piping, instrument, valve, material, inspection or maintenance detail).
- One flexible structure: categories with their own attributes, **no hard-coded types, no schema change per category**.
- Each item: clear name, description, location, links to one or more assets (equipment, line, instrument …), its
  source, and whether it is **verified** or not. Missing details are shown as *unknown*, never invented.
- Reuse the existing asset data (`lu_equipment`, `lu_streams`, `trk_equipment`, `trk_iat`); no duplicate records.
- Searchable by equipment, tag, category and description; compact summary, full details on tap; inside the existing
  equipment views, not a separate module.
- Authorized add / edit / correct / archive with history.
- Approach and status: `docs/APP_KNOWLEDGE.md` §8. Not to be built before the tracker priorities are complete.

## 7. Testing before "done"

- `npx vitest run` and `npm run build` clean.
- Rendered screens checked at 393×852 and 1280 wide with real data; before/after for visual changes.
- Click through every engineer-view tab before a release.
- Record flows: create → refresh → still there → correct/undo → refresh. Database functions may be checked as a given
  user inside a rolled-back transaction (no production change).
- Never claim a check that was not run.

## 8. Progress report (every major milestone)

Under 15 lines: Completed (implemented, tested and deployed only) · In progress · Remaining for the current priority ·
Blockers / approvals · Next step. Separate status for Design & UI, Permissions & security, Tracker functionality,
Testing & operational readiness, Technical equipment knowledge, each with an estimated % based on verified
functionality (plans and untested code count as 0), plus an overall estimate.

## 9. Wording and output

- Durations in **hours**, never days. Dates "7 Nov 18:19" (Kuwait time). Status lines end in "I/P"; tags short (R-205).
- No personal names in code, migrations or commits.
- Replies short; Arabic when the user writes Arabic. Mock-ups before building a new screen or visible layout change.
- Commits end with the session's co-author and session trailers. Push to the working branch and `main`.
