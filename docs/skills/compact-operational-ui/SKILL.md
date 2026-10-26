---
name: compact-operational-ui
description: Compact Operational UI rules for any app screen, page, dashboard, list, form, sheet or table. Use automatically before creating, changing, mocking up or reviewing any user interface, even when the request does not mention design. Where a project has its own design skill, that skill's tokens and components win; these rules still apply.
---

# Compact Operational UI

**Maximum useful information, minimum visual noise, zero loss of clarity.**

Principles: 1 high information density · 2 strong visual hierarchy · 3 minimal scrolling · 4 compact layouts ·
5 progressive disclosure · 6 fast scanning (the status reads in 3–5 s) · 7 no truncated critical data ·
8 consistent design · 9 mobile first (393×852) · 10 operational efficiency (fewest taps for the daily action).

Rules:
- Remove whitespace, decoration and duplication: no repeated titles, labels that restate the tab, icons with no
  meaning, empty-state boxes taller than one line, the same number shown twice.
- No card per record and no card inside a card. Records are compact list rows in one container
  (divided rows, ~12 px side / 6 px vertical padding): one line when it fits, two lines when a full name or a second fact needs it
  (line 1: name/tag bold + state chip; line 2: meta, dates/values right-aligned `tabular-nums`).
- Colour only for meaning. Grey is the default; a coloured element must be a state.
- Primary action visible without scrolling (row button or sticky at the top of the sheet); secondary under ⋯ / fold.
- Progressive disclosure: the summary line first, detail on tap, finished / secondary sections folded with a count.
- Filters as one scrolling chip row each, not dropdown stacks; a search box only for lists over ~20 rows.
- Keep accessible minimums: text ≥ 11 px for anything read (10 chips, 9 only in fixed matrices), touch ≥ 36 px rows,
  44 px primary. Never reduce readability to gain density: shorten words, merge lines, fold, then shrink.
- Critical data never truncates (names, tags, values, units, dates, alarms); only non-critical previews may.

Workflow (every UI task, without being asked):
1. Review the existing screen first (screenshot at 393×852 and 1280 with real data).
2. List the waste: whitespace, repetition, weak hierarchy, extra taps, scrolling to the main fact or action.
3. Keep every function, permission, calculation and record path.
4. Design the most compact readable version; mock-up first when the layout changes.
5. Check on mobile and desktop; the important facts and the primary action are above the fold.
6. Report before → after in one line each: rows / facts visible on the first phone screen, scroll height (px or
   screens), taps for the main action. Example: "rows visible 6 → 14 · scroll 3.1 → 1.4 screens · taps 2 → 1".
