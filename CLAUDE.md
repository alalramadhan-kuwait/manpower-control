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
- Approved calculations (manpower minimums, roster cycle, tracker progress/forecast) change only with authorization.
- **No hard delete** of user records. Use soft states (cancelled, voided, declined, superseded) that keep links and
  history. No DROP / TRUNCATE / unscoped DELETE; production data changes only with confirmed mappings.
- Never touch the Time Keeper repo or database, `kids_carb_*` tables, or Supabase Auth tables.

## 4. Database

- Batch a feature's schema changes into **one migration**. Every applied change gets
  `supabase/migrations/<recorded version>_<name>.sql` and a row in `supabase/README.md`. The folder must rebuild the
  database in order.
- Authorization is enforced in the database (RLS, security-definer RPCs that check the role), not only in the UI.
- Edge functions: bundles are built by `npm run functions:build` (a test fails if a bundle is stale). This environment
  has no deploy token: say so when a function change needs deploying.

## 5. Permissions

Three levels plus task assignments — see `docs/APP_KNOWLEDGE.md` §3 for the matrix and its current status.
Section Head > Engineer / Assistant Section Head > Controller; extra rights (e.g. Manpower) come from an assignment,
not a promotion. New features state which level may view, create, correct and approve, and enforce it in the database.

## 6. Testing before "done"

- `npx vitest run` and `npm run build` clean.
- Rendered screens checked at 393×852 and 1280 wide with real data; before/after for visual changes.
- Click through every engineer-view tab before a release.
- Record flows: create → refresh → still there → correct/undo → refresh. Database functions may be checked as a given
  user inside a rolled-back transaction (no production change).
- Never claim a check that was not run.

## 7. Wording and output

- Durations in **hours**, never days. Dates "7 Nov 18:19" (Kuwait time). Status lines end in "I/P"; tags short (R-205).
- No personal names in code, migrations or commits.
- Replies short; Arabic when the user writes Arabic. Mock-ups before building a new screen or visible layout change.
- Commits end with the session's co-author and session trailers. Push to the working branch and `main`.
