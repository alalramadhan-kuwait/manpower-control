---
name: refinery-enterprise-design
description: Design rules for every screen, report and message in the ARDS Unit-12 operations app (manpower, shutdown tracker, leave, IATs, handover). Use before creating, changing or reviewing any UI, WhatsApp report or user-facing wording.
---

# Refinery enterprise design (ARDS Unit-12)

One app, one look, compact, never wrong. Clarity and correct data come before decoration.

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
| Printed KNPC documents only | `knpc-blue` / `knpc-red` / `knpc-green` |

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

**Unified app (audit 24 Oct 2026): the Engineer view is the visual base.** Where the code lives:

| Component | Use | File |
|---|---|---|
| Toast + Undo | every save, both views (Undo 7 s, plain 3 s) | `Toast` in `src/ui/components.tsx` |
| Navigation | lucide icons, 11 px label, active `text-brand-700`; no emoji tabs | `Shell.tsx`, `TrackerPage.tsx` TABS, `EngineerApp.tsx` TABS |
| Hero cards | end date · main equipment done · by group, the same on Engineer dashboard and Section Head Today | `ShutdownHero` in `EngineerApp.tsx` |
| Equipment row | dot · tag · what now / stage · last update · ONE status chip · labelled `▶ Start` / `✓ Finish` / `Drums` | `ItemRow` (Engineer), `EquipmentTab` row (Section Head) |
| Step action | start/finish now: twins together, hold ended, Undo restores both | `stepNow` in `src/features/tracker/actions.ts` (never a local copy) |
| Segmented control | grey track, white selected — switches views; filters stay pills | `Seg` (Engineer), VIEWS bar (tracker) |
| Report button | `bg-whatsapp`; Save is navy (green = status only) | — |
| IAT operations label | the one Operations classification (owner): `OpsLabel` select with Undo, read-only chip for Controllers; old ticks shown read-only | `src/features/tracker/Iats.tsx` |
| Hold | `PendingForm` (14 reasons + note) for equipment and loops in every view; Resume with Undo | `src/features/tracker/TrackerSheets.tsx` |
| Role in the Engineer view | `EngRole` context: Controller gets no rename/add/remove step, loop requirement, IAT label, reactor empty | `EngineerView` |

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

1. Screenshot the changed screens at 393×852 and 1280 wide with real data (engineer link for tracker screens, the
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
