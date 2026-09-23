# Area 4 Manpower Control

Operations manpower planning and control for **KNPC — Mina Abdullah Refinery — Area 4 — Unit 12 — Section 1**.

This project is standalone. It shares **nothing** with Time Keeper / Time Gallery: separate repository,
separate Supabase project (`fhnqaurtryfmmomvzrpl`), separate authentication, separate employees.

## Status: Stage A — Foundation & Source Data

Delivered in Stage A:

- Supabase project with the normalized Stage A schema, Row Level Security and an audit log (`supabase/migrations`)
- Two active roles: **Section Head** and **Manpower Coordinator** (Controller and Employee roles exist but are inactive)
- Employee foundation: identity, KNPC/Contractor classification, operational role + permanent crew (time-bounded),
  qualifications as their own records (Take-Charge, Panel Operator, Acting Controller, Controller),
  KNPC master data, performance and sick-leave yearly totals, leave register with source references
- Excel Import Center: upload → parse → identify → match by Employee Number → validate → preview → confirm → commit
  (`src/core/import` is pure TypeScript; the database applies a previewed batch in one transaction via `commit_import_batch`)
- Import history with per-row outcomes, and a Data Quality Review screen for everything a person must decide
- Employee directory and profile with editing of qualifications, classification and role/crew corrections

Not yet built (later stages): roster engine, manpower status engine, Day Overview, calendar, requests, movements,
controller management, shutdown, notifications.

## Source workbooks

| File | Import type | What it provides |
|---|---|---|
| `ARD's U-12 Manpower 2026.xlsx` | `u12_manpower_workbook` | Section 1 population, crews (from `PV Scheduled`), approved annual-leave plan, monthly absence grid |
| `Promotion October 2026.xlsm.xlsx` | `promotion_master` | Grade, position, HR dates, performance, sick-leave totals for Area-4 KNPC staff; matched by Employee Number, rows outside Section 1 ignored |

Rules the importer follows:

- Employee Number is the only matching key. Names are never used to match.
- The 60 people on the U-12 workbook define the Section 1 scope. Cost Center is never used for scope.
- KNPC / Contractor is a classification only, inferred from the number length (5 digits KNPC, 6 digits contractor) and
  marked "inferred" until confirmed. Eligibility for manpower will depend on role, qualification, grade, Take-Charge and availability.
- Take-Charge is `not_yet_confirmed` for every imported Field Operator until the Section Head confirms it.
- Panel / Controller qualification is recorded from block membership as *import inference*; it is its own record and can be corrected.
- Leave types are imported only where the source proves them (the PV sheet = planned annual leave). Monthly-grid absences
  that are not in the PV plan become **unresolved** records for manual classification. Nothing is invented.
- Every imported record keeps its workbook / sheet / cell reference and its import batch.

Never commit the workbooks: they contain personal data. `data/` and `*.xlsx` are git-ignored.

## Develop

```bash
cp .env.example .env     # Supabase URL + publishable key of the area4-manpower-control project
npm install
npm run dev              # http://localhost:5173
npm test                 # parser + planner unit tests (synthetic fixtures)
npm run typecheck
npm run build
```

Local dry run of the import pipeline against real files (prints the plan, writes nothing):

```bash
npx tsx scripts/dry-run.ts data/manpower.xlsx data/promotion.xlsx
```

## Layout

```
src/core/import      pure parsing + planning (no DOM, no Supabase) — unit tested
src/data             Supabase client, row types, queries
src/features         auth, home, employees, imports, review, more
src/ui               shared mobile-first components (cards, chips, bottom sheet)
supabase/migrations  every migration applied to the project, in order
scripts              dry-run and initial-load helpers
```

## Validation against the real project

```bash
# RLS from outside, as the browser sees it (anonymous + both roles)
SH_EMAIL=… SH_PASSWORD=… MC_EMAIL=… MC_PASSWORD=… node scripts/rls-check.mjs

# Browser end-to-end on an iPhone viewport: login, directory, profile update, Take-Charge bulk update,
# import preview + commit of the real workbook (must change nothing on a re-import)
npm run dev &
MC_EMAIL=… MC_PASSWORD=… WORKBOOK=data/manpower.xlsx OUT=/tmp/shots node scripts/e2e-real.mjs
```

## Stage B — roster and manpower engine

- `src/core/roster` is the single roster logic (8-day cycle, anchor 2 Mar 2026 = B M1, Morning order B, C, A, D).
  Tests check all 365 days of 2026 against the Off-crew rows of the U-12 workbook and the full cycle from 2020 to 2035.
- `src/core/manpower` evaluates each crew on duty against the full-operation minimums: Controller 1 (Grade 15+, or an
  approved Grade-14 Acting Controller shown as such), Panel 3 with at least one Grade 14+, Field 6 counting only
  Take-Charge = Yes. GREEN above minimum, AMBER exactly minimum (No Buffer), RED below minimum or requirement missing.
  Current-plan leave reduces manpower only on the crew's working days; unresolved absences are warnings only.
- Every result is classified as a confirmed shortage (final RED), Controller coverage required (crew Controller on
  leave, no cover recorded — not final until coverage is assigned), qualification data incomplete (below minimum only
  because qualifications such as Take-Charge are not yet confirmed — not final), or an unresolved absence warning.
  Not Yet Confirmed never counts. Acting Controller is used only when explicitly recorded in the employee profile.
- The home screen is the mobile Day Overview (Today / Tomorrow / date picker, all four crews, who counts and why).

