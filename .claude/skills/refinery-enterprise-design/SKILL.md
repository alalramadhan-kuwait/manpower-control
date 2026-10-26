---
name: refinery-enterprise-design
description: Compact Operational UI and design rules for every screen, report and message in the ARDS Unit-12 operations app (manpower, shutdown tracker, leave, IATs, handover). Use automatically before creating, changing, mocking up or reviewing any screen, page, dashboard, list, form, sheet, table, WhatsApp report or user-facing wording, even when the request does not mention design.
---

# Refinery enterprise design (ARDS Unit-12)

One app, one look, compact, never wrong. Clarity and correct data come before decoration.
**Maximum useful information, minimum visual noise, zero loss of clarity.**

## 0. Compact Operational UI (owner, 26 Oct 2026; applies to every UI task)

Principles: 1 high information density · 2 strong visual hierarchy · 3 minimal scrolling · 4 compact layouts ·
5 progressive disclosure · 6 fast scanning (the status reads in 3–5 s) · 7 no truncated critical data ·
8 consistent design · 9 mobile first (393×852) · 10 operational efficiency (fewest taps for the daily action).

Rules:
- Remove whitespace, decoration and duplication: no repeated titles, labels that restate the tab, icons with no
  meaning, empty-state boxes taller than one line, the same number shown twice.
- No card per record and no card inside a card. Records are compact list rows in one container
  (`divide-y`, `px-3 py-1.5`): one line when it fits, two lines when a full name or a second fact needs it
  (line 1: name/tag bold + state chip; line 2: meta, dates/values right-aligned `tabular-nums`).
- Colour only for meaning (§2). Grey is the default; a coloured element must be a state.
- Primary action visible without scrolling (row button or sticky at the top of the sheet); secondary under ⋯ / fold.
- Progressive disclosure: the summary line first, detail on tap, finished / secondary sections folded with a count.
- Filters as one scrolling chip row each, not dropdown stacks; a search box only for lists over ~20 rows.
- Keep §2 minimums: text ≥ 11 px for anything read (10 chips, 9 only in fixed matrices), touch ≥ 36 px rows,
  44 px primary. Never reduce readability to gain density: shorten words, merge lines, fold, then shrink.
- Critical data never truncates (names, tags, values, units, dates, alarms); only non-critical previews may.

Workflow (every UI task, without being asked):
1. Review the existing screen first (screenshot at 393×852 and 1280 with real data).
2. List the waste: whitespace, repetition, weak hierarchy, extra taps, scrolling to the main fact or action.
3. Keep every function, permission, calculation and record path (§5, §6).
4. Design the most compact readable version; mock-up first when the layout changes (§1).
5. Check on mobile and desktop; the important facts and the primary action are above the fold.
6. Report before → after in one line each: rows / facts visible on the first phone screen, scroll height (px or
   screens), taps for the main action. Example: "rows visible 6 → 14 · scroll 3.1 → 1.4 screens · taps 2 → 1".

## 1. Before touching a screen

Answer in one line each (in your head, not in the reply):
domain · who uses it (Section Head, engineer, controller, coordinator, field) · the one question the screen answers ·
the action it allows · the records behind it · what goes wrong if it is misread.

Then:
- **Mock-up first** for any new screen or visible layout change: a static HTML page in the scratchpad, screenshot at
  393×852, show it, wait for the pick. Offer 2–3 options when the choice is real.
- Reuse what exists (`src/ui/components.tsx`, the `List` / `ROW` / `TAG` patterns in the engineer view). No new
  component when an existing one fits.
- Smallest change that solves it. No redesign of things not asked about. No calculation changes during visual work.

## 2. Tokens (use these, not new values)

Colours: use the `@theme` tokens in `src/index.css`. Do not add new hex values.
| Meaning | Token |
|---|---|
| Interface / primary / headings | `brand-700` (navy) |
| Done / healthy | `status-green` |
| Attention / running / due | `status-amber` |
| Late / failed / blocking | `status-red` |
| Info / active | `brand-500` |
| Neutral / not started | slate |
| Crew A/B/C/D | `crew-*` only for crew identity, never for status |
| Shift M / A / N | amber / orange / indigo, only for shift identity |
| Running step marker | `amber-400` fill, `amber-950` text |
| WhatsApp buttons / preview | `whatsapp` / `whatsapp-soft` |
| Printed documents | `brand-700` heading and rule only (no company name, logo or colours) |

Soft fills for states use the Tailwind palette at 50–200 (`green-100`, `red-100`, `amber-200`). No `-[#hex]` classes
anywhere except the logo artwork (`src/ui/brand.tsx`). The same colour means the same thing everywhere. Colour is
never the only signal: pair it with a word or icon.

Type (px): 20 page title · 15–16 section · 14 body · 13 list primary · 12 list secondary · 11 meta/timestamps ·
10 chips, badges, uppercase section labels, grid headers, legends · 9 only inside fixed-size matrix cells (calendar,
leave plan, Gantt). Nothing below 9. No half sizes (10.5, 12.5 …). Numbers `tabular-nums`. Weight for hierarchy, not
size. Choose the size by the element's job and the space it has; do not raise sizes across the board.
Text colour: `slate-500` is the lightest for readable text; `slate-400` only for an empty value ("—", "Off").

Spacing: 4 · 8 · 12 · 16 · 24 (Tailwind 1 · 2 · 3 · 4 · 6). Card padding 12 (`p-3`). Rows in the same list use
identical padding.

Radius: `rounded-2xl` cards and sheets · `rounded-xl` buttons and inputs · `rounded-lg` chips · `rounded-full` pills.

Touch: primary buttons `min-h-11` (44px) · secondary/row actions `min-h-9` (36px) minimum · nothing tappable smaller.

## 3. Text

- Fewest words that stay exact: "Completed", "Status", "Remaining", "Updated", "Details".
- **Durations in hours** ("72 h", "31 h float", "12 h after P6"), never days. Dates as "7 Nov 18:19" (Kuwait time).
- Plant wording: status lines end in **I/P** ("Dismantling I/P"), tags short form (R-205, E-216A/B, C-201-ST).
- Labels, tabs, chips, buttons, tags: one line. Shorten the words before shrinking the font.
- **Full names never truncate.** If a name does not fit, put it on its own line above the details (two-line row).
- Ellipsis only for non-critical previews whose full text is one tap away. Never on tags, values, units, alarms.
- Arabic text must render right-to-left (`dir="rtl"`) where it appears.

## 4. Layout by domain

- **Manpower / Today:** who is on, who is in charge, who is away. Two shifts at a time, colour per shift.
- **Leave / Requests:** a decision list (To approve / To fix / …), two-line rows, ✓ action on the row, ⋯ for the rest,
  person card in a bottom sheet.
  Decision sheet (Calendar leave sheet, 26 Oct 2026): who + state chip · the leave line · three figures (duties, short
  confirmed + potential, this year) · one conclusion (confirmed solid red, potential dashed amber) · warnings that need
  the approver never folded · primary actions + ⋯ · every detail in `Fold` rows with a one-line summary value.
- **Shutdown tracker:** item list → item detail with steps. Keep **P6 baseline, actual, forecast, work done and critical
  path** visibly separate; say "unverified" when the logic behind a forecast is not imported.
- **IATs / hot work:** job, location (from the line-up), status, ops label.
- **Reports (WhatsApp):** see §7.
- Management views show exceptions and decisions, each linking to its records. No decorative KPIs.

**When these modules are added** (not in the app yet; the rules apply from the first screen):
- **Chemical / laboratory:** every result with unit, detection limit, sample time, source and spec limits; trends with
  labelled axes, units and limits; an estimate is never shown as a verified result.
- **Handover slips:** create, reopen, edit while a draft, add/remove items, withdraw or void with a reason, revise an
  approved slip as a new version, show who changed what and when, link to the equipment and its work. A slip never
  implies a physical handover that the approved process has not completed; a software tick is not a permit, gas test or
  isolation.
- **Procedures:** drafts fully editable (title, steps add/remove/reorder, assignments), duplicate, discard; published
  versions kept, revisions with a reason and approval, effective version and date shown. A procedure template and its
  execution records are separate: changing the template never rewrites completed checklists.

## 4a. One component per job (shared across modules)

Equivalent actions look and behave the same in every module; domains keep their own information. Use the shared
component; a screen-local copy of one of these is a defect to fix.

| Job | Standard |
|---|---|
| Item detail sheet (equipment, PMR, IAT, loop) | `BottomSheet`: header (full tag, name, system link) → state chips → one progress line → primary action(s) → main list → folded sections |
| Stage vs work status | Two separate chips: `STAGE · …` (handover/M&I stage) and `WORK · …` (in progress / waiting … / stopped). Never one control for both |
| Work status / hold | One compact selector (`⏸ Hold ▾` → reasons list + note), not a row of pills |
| Step actions | Running step: full-width amber `✓ FINISH <step>`; next: navy `▶ START NEXT`; Undo only in the toast; time / note corrections in the row's `⋯` |
| Edit | `✎ Edit` link → fields in place → `Cancel` (secondary) + `Save` (primary); no confirmation dialog |
| Feedback | One toast for every save: "<TAG>: <what happened>." with `Undo` when it can be undone; errors in `ErrorBox` |
| Issues | One `Issues` row: count or "None open" + `+ Issue`; same component in desktop and engineer views |
| Lists / progress | Rows: dot (state colour) · text (never truncate tags) · meta right; progress = one bar with the plan tick + "x% done · plan y%" |
| Folded sections | Same header everywhere: ▸ title · count / summary right; closed by default unless something needs action |
| Secondary actions | Under Details / ⋯ / More; the screen shows at most two primary actions |
| Dialogs | Bottom sheet on mobile; no `confirm()`; destructive or scope changes ask for a reason inline instead |

Tags are shown in full (C-12-201, not C-201) wherever there is room; shorten only inside fixed-width grids.

**One interface (owner, 25 Oct 2026).** There is no Section Head / Engineer mode and no switch. Every role opens the same
tracker (`/progress`, `TrackerPage.tsx`); the role decides what is shown. Never build a second screen, a "simple" copy
or a mode for one role: add the control to the shared screen behind the role.

| Role | Sees |
|---|---|
| Section Head | everything: Admin, the views Timing (Equipment), Sequence and Map (Handover), stage review and phases on the Dashboard, out of scope, revise drum estimate, Start anyway (locked loop), Add job, ops and field steps |
| Engineer (and Coordinator) | the operational screens: steps (start, finish, rename, add, remove, order, time correction, not required for the head only), hold, issues, drums and vessel empty, loop requirement, IAT label |
| Controller | the same screens with the update actions only (start / finish, hold, notes, drums, blinds, IAT status, order); no rename / add / remove step, loop requirement, IAT label or vessel empty. With the Manpower assignment, also the rest of the app |

The role comes from `EngRole` (`RoleCtx` in `EngineerApp.tsx`, set by the `…Tab` wrappers); `useCanManage()` = not a
Controller; `role === 'head'` for the Section Head tools. The database stays the final check.

| Component | Use | File |
|---|---|---|
| Tabs | Dashboard · Equipment · Handover · SD scope · Hot work (lucide icons); views bar for the Section Head only | `TrackerPage.tsx` TABS / VIEWS / HEAD_VIEWS |
| Badges | Equipment = items late or on hold (the same items as its `Late / hold` filter: `equipmentList` + `lateOrHold`); Handover = blinds not in or neutralizations not done; Hot work = open IATs. Each badge says what it counts (title) | `src/core/tracker` |
| Dashboard | the situation in 5 s, no scrolling on a phone: `ShutdownOverview` = 1 Shutdown end (forecast, vs P6, set by) · 2 Progress (main equipment % vs plan) · 3 Critical (top 3 items setting the end) · 4 Operations / M & I (one line each, tap = detail sheet) · 5 Needs attention (no update, late / hold, late steps). Everything else in `DashFold` below (by group, issues, team; Section Head: stage review, operations focus). Never add a card above the fold | `TrackerToday.tsx`, `EngineerApp.tsx` |
| Equipment list | `EquipmentListTab`: chips All · To update · Late / hold · groups; row = dot · tag · now · % / plan · `StepButton` | `EngineerApp.tsx`, `StepButton.tsx` |
| Item sheet | `ItemSheetFor`: steps + main action, issues, worklist, hold, status, then `ItemMore` (flags, M & I %, drums, No change / Delay, isolation, stage, IATs, related, history, technical, scope) | `EngineerApp.tsx`, `TrackerSheets.tsx` |
| Handover | `HandoverTab`: Blocking · Neutralization · Blinds · Blind list · Return; loop opens `LoopDetail`; de-blind only from Return | `EngineerApp.tsx`, `Isolation.tsx` |
| Blind list | compact, one line per row, detail on tap, done folded; By item / By blind | `BlindList.tsx` |
| Hot work | `HotWorkTab`: IAT cards (status + label), search, filter, completed folded, `IatDetail`; PMRs | `EngineerApp.tsx`, `Iats.tsx` |
| Calendar | Month (where the risk is) · Week (who covers each shift) · List (who is away); one `FilterBar` (crew, position, type, status, search, Risk only) and the open day / leave in the address (`features/calendar/filters.tsx`); a leave opens `LeaveDetail` with `ImpactPreview` (also in Approvals); short = red (confirmed), dashed red = potential (planned leave not approved), grey = cover needed / data missing, `−C` = no Controller; links to Requests carry `back=`. Leave rows: one state each (`rowState`) as a subdued fill + 3 px left bar + its word (`features/calendar/rowStyle.ts`): taken grey · on leave blue · approved upcoming green · awaiting / started not approved amber (request: dashed bar) · cancelled / not approved red · rescheduled violet (only under Status › Changed). No Oracle in the Calendar; Approved = the Section Head's approval | `features/calendar/*` |
| Toast + Undo | every save (Undo 7 s, plain 3 s) | `Toast` in `src/ui/components.tsx` |
| Step action | start / finish now: twins together, hold ended, Undo restores both | `stepNow` in `actions.ts` (never a local copy) |
| Hold | `PendingForm` (reasons + note) for equipment and loops; Resume with Undo | `TrackerSheets.tsx` |
| Report button | `bg-whatsapp` in the header; Save is navy (green = status only) | — |

## 4b. Technical information on equipment

- Shown inside the equipment's own view (item sheet / item page) as a compact list grouped by category:
  `Category · name · key value` per line (e.g. `RTJ · Flange 3 · 6" 1500# R-46`). Tap for the full record.
- Show only the fields defined for that category; empty fields read **unknown**, never blank guesses.
- Each record shows its source and a **Verified / Unverified** chip (verified = green chip with who and when).
- Tags, sizes, ratings and units never truncate; long descriptions wrap.
- One search box finds items by equipment, tag, category or words in the description.
- Edit / correct / archive from the record (authorized users), history one tap away.

## 5. Records: every one can be corrected

A feature that creates a record with no way to correct it is not finished.

| Record | Correct it by |
|---|---|
| Step start/finish | Undo toast right after; reopen / set time in the item |
| Issue | Edit · Resolved · Reopen |
| Leave decision | Undo · Change dates · Send to Coordinator · Reject with reason |
| Drum / qty entry | A `correction` entry that points at the one it corrects (never edit history away) |
| Shift notes | Edit and save again (same shift) |
| IAT | Status and ops label change, with who and when |
| Status line (remark) | Overwrite; the log keeps the old value |

Rules:
- Routine reversible actions: one tap plus an **Undo** toast. No confirm dialog.
- Confirm only for irreversible or high-consequence actions; ask for a reason when a decision is reversed or rejected.
- No hard delete of user records. Use soft states (cancelled, voided, declined, superseded) that keep links and history.
- Every new user-managed record type ships with its correction path in the table above (correct, revise, cancel or
  undo). No create-only dead ends.
- Keep who / when / old value / new value for every consequential change.
- Test the whole loop: do it → refresh → still there → undo or correct it → refresh again.

## 6. Data integrity (fails the work regardless of looks)

- Never invent data. Unknown stays "not known"; a time not given is recorded as "now" and said so.
- The P6 baseline is never changed. Splits and re-timing live on our own steps, inside the P6 window.
- Status updates from reports: take the most advanced of the report, the Excel and the tracker.
- Estimated or projected values are labelled as such. A running step counts 0 until it is finished.
- Every database change: one migration, a file in `supabase/migrations/` with the recorded version, a README row.
- No personal names in code, migrations or commits.

## 7. WhatsApp text

- Bold `*x*`, italic `_x_`, bullets `•`. No tables, no aligned columns, no nested lists.
- Short lines (fit a phone without wrapping where possible). One idea per line.
- Measures named for what they count ("Work done (hours)", "Items completed"), so two numbers never look contradictory.
- Counts as `done/total`. Times in hours.

## 8. Check before saying done

1. Screenshot the changed screens at 393×852 and 1280 wide with real data, and give the §0 before → after numbers (engineer link for tracker screens, the
   local harness with a data dump for logged-in pages). For broad visual changes, compare before and after side by
   side (a git worktree of the previous commit on a second port).
2. Look for: clipped or wrapped labels, truncated names, overflow, uneven row spacing, colour used off-meaning.
3. Long name, empty list, loading and error states.
4. The edit loop in §5 for any record the change touches. Database functions can be checked as the Section Head
   inside a transaction that is rolled back (`set_config('request.jwt.claims', …)`, then raise to roll back), so no
   production record changes.
5. Click through every engineer tab before a release; no page errors.
6. `npx vitest run` and `npm run build` clean. Deployed version matches the commit (`/version.json`).

Report in a few lines: what changed, what was tested, what was not, what remains. Never claim a check that was not run.
