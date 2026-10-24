---
name: feature-workflow
description: The standard way to build, change, fix or update anything in the ARDS operations app (features, data updates from reports, fixes, reports). Use for every request in this repo before writing code or SQL.
---

# Feature workflow (ARDS operations app)

Rules live in `CLAUDE.md`; facts in `docs/APP_KNOWLEDGE.md`; looks in the `refinery-enterprise-design` skill.

## 1. Frame (no output to the user)

- Module (Tracker / Manpower / Leave / Controllers / Shutdown teams / …), user level, the question and the action.
- Is it inside the current priority (CLAUDE.md §2)? If not, say so in one line and stop unless the user insists.

## 2. Inspect before building

- `docs/APP_KNOWLEDGE.md` for the module: tables, RPCs, rules, permissions, open gaps.
- `grep` the feature area in `src/core/*` (logic, tested) and `src/features/*` (screens); look at the latest
  migrations touching its tables.
- Live data with read-only SQL, one combined query.
- Decide: reuse / extend / new. New only when nothing fits.

## 3. Gaps and questions

- Write down what is missing. Settle minor points yourself (wording, layout within the design skill, defaults that
  match existing behaviour).
- Ask once, all together, only for: safety, approved business rules / calculations / baseline, permissions changes,
  destructive data changes, or a requirement the app cannot answer. Offer 2–3 options with a recommendation.
- New screen or visible layout change: mock-up (static HTML, 393×852 screenshot) before building.

## 4. Build

- Logic in `src/core/<module>` with unit tests; screens in `src/features/<module>` reusing `src/ui/components.tsx`.
- Database: one migration for the feature, RLS / role check in the database, soft states instead of delete, audit or
  log row for consequential changes. Migration file + `supabase/README.md` row.
- Every record the feature creates: define how it is corrected (edit / undo / correct / revise / cancel) and by whom.
- Data updates from plant reports: map each line to a record first; take the most advanced status; never touch P6
  dates; record unknown times as now and say so; report progress % before and after.

## 5. Verify

1. `npx vitest run`, `npm run build`.
2. Render the changed screens (mobile 393×852 and desktop 1280) with real data: engineer link for tracker screens,
   a temporary harness (`src/__harness__`, never committed) with a data dump for logged-in pages.
3. Record loop: create → refresh → correct/undo → refresh; permissions: allowed role works, other role refused
   (rolled-back transaction with `request.jwt.claims` for database checks).
4. Before release: every engineer-view tab opens without page errors.
5. After push: `/version.json` shows the commit.

## 6. Close

- Commit (clear message, no personal names, session trailers), push to the branch and `main`.
- Update `docs/APP_KNOWLEDGE.md` with confirmed new facts (tables, rules, decisions, closed gaps).
- Reply in a few lines: what changed · what was verified · what remains · decisions needed.
