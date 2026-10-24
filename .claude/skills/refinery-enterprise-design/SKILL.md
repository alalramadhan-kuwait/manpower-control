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

The same colour means the same thing everywhere. Colour is never the only signal: pair it with a word or icon.

Type (px): 20 page title · 15–16 section · 14 body · 13 list primary · 12 list secondary · 11 meta/timestamps ·
10 chips/badges only. Nothing below 10. Numbers `tabular-nums`. Weight for hierarchy, not size.

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
- Prefer soft states (cancelled, voided, declined) over deleting rows. Never hard-delete production data from the app.
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

1. Screenshot the changed screen at 393×852 (and wider if it is a desktop page) with real data from the harness.
2. Look for: clipped or wrapped labels, truncated names, overflow, uneven row spacing, colour used off-meaning.
3. Long name, empty list, loading and error states.
4. The edit loop in §5 for any record the change touches.
5. Click through every engineer tab before a release; no page errors.
6. `npx vitest run` and `npm run build` clean. Deployed version matches the commit (`/version.json`).

Report in a few lines: what changed, what was tested, what was not, what remains. Never claim a check that was not run.
