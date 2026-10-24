---
name: refinery-process-diagram
description: Mandatory for every automatically generated process diagram in this app — process flow diagrams, neutralization loop schematics, equipment connections, shutdown / startup preparation, chemical circuits and maintenance reference diagrams. Covers diagram type, layout, equipment symbols and orientation, vapor/liquid routing, pipe geometry, labels, valves, instruments, verification levels, source priority, metadata, the safety label and the release quality check. Implementation lives in src/core/tracker/schematic.ts (engine) and src/features/tracker/LoopSchematic.tsx (UI, existing Drawing Viewer).
---

# Refinery Process Flow Diagram & Loop Schematic Design

**Purpose:** Automatically generate clear, technically consistent refinery process diagrams using existing engineering data.

**Scope:** Process Flow Diagrams, Neutralization Loop Schematics, Equipment Connections, Shutdown Preparation, Startup Preparation, Chemical Circuits, and Maintenance Reference Diagrams.

**Priority:** Mandatory for all automatically generated process diagrams.

## In this app

- Engine: `src/core/tracker/schematic.ts` — `buildSchematic()` builds the topology (nodes, edges, attributes, source,
  verification) from the loop record, field procedure (`trk_point_step`), blind list and P&ID line-up (`lu_streams`);
  `schematicSvg()` lays it out and draws it (SVG). Pure functions, unit-tested in `__tests__/schematic.test.ts`.
- UI: `src/features/tracker/LoopSchematic.tsx`, shown in the existing `DrawingViewer` (`LoopDiagram.tsx`). Verified
  drawings (`trk_drawing`) always come first; the schematic is the fallback reference.
- Corrections: `trk_loop_fix` (remove with reason, add connection / point, note; "verified" only with a P&ID sheet).
- Equipment identity: tags are matched with `luKeys` / `tagKey` (E-12-229 = E-229, E-210 ~ E-210A/B); no duplicate
  equipment records are created.
- Bump `GENERATOR_VERSION` in `schematic.ts` when the drawing rules change.

---

## 1. Core Objective

Create diagrams that look and function like professional refinery engineering drawings.

The drawing must help an Operations Engineer understand:

1. Where the process starts.
2. Where the process flows.
3. Which equipment is involved.
4. How the equipment is connected.
5. Which main valves and instruments are present.
6. Where branches join or split.
7. Where vapor and liquid flow.
8. Where filling, draining, venting and circulation connections exist.
9. What equipment and piping belong to the loop.
10. Where the available engineering information is incomplete.

The drawing must represent the available engineering topology, not an attractive but imaginary piping arrangement.

## 2. Engineering Standards

Use the following as reference frameworks:

* ISO 10628-1 — Flow diagram content and representation.
* ISO 10628-2 — Equipment and piping graphical symbols.
* ANSI/ISA-5.1 — Instrumentation identification and graphical symbols.
* ISA-TR5.1.04 — PFD and P&ID content guidance.
* Existing KNPC P&ID conventions, when documented and available.

Do not claim formal compliance with a standard unless the implementation has actually been checked against its requirements.

Existing approved plant documentation takes priority over generic drawing preferences.

## 3. Determine Diagram Type First

Before generating a diagram, identify its purpose.

**A. Process Flow Diagram (PFD)** — Shows main process equipment, major streams, flow direction, important process branches, relevant operating conditions when available. Omit unnecessary small accessories unless they affect understanding.

**B. Simplified Piping Schematic** — Shows relevant piping connections, equipment nozzles, main valves, branches, tie-ins, process boundaries. Use when equipment connectivity is the main purpose.

**C. Neutralization Loop Diagram** — Shows the full relevant neutralization circuit, equipment involved, injection or filling connections, circulation path if recorded, relevant drains and vents, boundary valves, return or discharge path, verified physical connections, known operational limitations.

**D. Shutdown / Maintenance Schematic** — Shows related equipment, relevant isolation boundaries, blinds, maintenance work boundaries, shared systems, equipment dependencies. A generated drawing must not independently determine isolation adequacy.

Choose the correct diagram type automatically from the user's task.

## 4. General Drawing Direction

Preferred layout: a clean, left-to-right main process flow whenever feasible.

* Main feed: Left
* Main downstream destination: Right
* Vapor branches: Prefer upper drawing space
* Liquid drains: Prefer lower drawing space
* Utilities: Enter from a suitable side
* Recycle lines: Route around the main equipment where practical

These are drawing-layout preferences, not physical connection rules.

Flow arrows are mandatory on process routes whose direction is known. If a stream is bidirectional or its direction is unknown, label it accordingly instead of guessing.

Layout order:

1. Identify the main process path.
2. Place the main equipment.
3. Place important upstream and downstream equipment.
4. Establish verified connection points.
5. Add branches.
6. Add relevant valves.
7. Add instruments.
8. Add secondary technical labels.

Avoid random equipment placement and decorative connections.

## 5. Equipment Orientation Rules

Equipment must use recognizable engineering symbols.

**5.1 Vertical Vessels** — Draw a vertical vessel upright. Where the equipment performs vapor-liquid separation: show confirmed vapor outlets at their documented connections, commonly near the upper section; confirmed liquid outlets at their documented connections, commonly near the lower section; drains below when confirmed; vents above when confirmed; connect feed at the actual documented nozzle position. Never assume the exact nozzle location solely because the vessel is vertical.

**5.2 Horizontal Vessels** — Draw a horizontal vessel horizontally. For horizontal separators, when supported by the actual design: vapor space above the liquid region; vapor outlets commonly from upper connections; liquid outlets commonly from lower connections; drains below; feed through its documented nozzle. Other horizontal vessels may have different nozzle arrangements.

**5.3 Heat Exchangers** — Use a consistent recognizable exchanger symbol. Identify equipment tag, shell-side circuit, tube-side circuit, inlets and outlets, connection to other equipment. **Critical rule: never accidentally join shell-side and tube-side process circuits.** Display the two circuits distinctly, with heat transfer represented without a material-flow connection. Do not assume exchanger orientation, pass arrangement, or nozzle position from the equipment tag.

**5.4 Pumps** — Show the pump symbol with equipment tag, suction connection, discharge connection, confirmed flow direction. Display confirmed minimum-flow recycle, suction strainers, check valves, discharge branches. Do not assume that a bypass or minimum-flow line exists.

**5.5 Compressors** — Use the correct compressor symbol. Show suction, discharge, relevant upstream vessels, main recycle or anti-surge connection when confirmed, relevant associated equipment. Auxiliary systems only when part of the requested diagram.

**5.6 Reactors** — Use a recognizable vertical or horizontal reactor symbol matching the documented configuration. Include feed inlet, product outlet, relevant hydrogen or quench injection, associated manifolds, major confirmed process connections. Show catalyst beds or internal distribution only when relevant and supported by source documents.

**5.7 Fired Heaters** — Use a heater symbol with the correct process inlet/outlet arrangement where known. For multi-pass heaters: preserve each documented pass; show relevant inlet and outlet headers; label individual passes where known; do not merge separate passes accidentally.

## 6. Vapor, Liquid, and Multiphase Flow

**Vapor** — For vapor-liquid separation equipment, prefer upward visual routing for vapor outlets where it agrees with the actual nozzle arrangement. Label known vapor streams. Avoid showing a vapor outlet from a bottom liquid nozzle unless the source explicitly supports that arrangement.

**Liquid** — For separators and collection vessels, prefer lower visual routing for liquid outlets. Show drains below the equipment when their location is confirmed.

**Multiphase Streams** — Label two-phase or mixed-phase streams when known. Do not visually classify them as vapor-only or liquid-only without evidence.

**Important** — Drawing direction and actual physical flow are separate concepts. A line can run horizontally on the drawing even if its real piping rises vertically. Never create or modify physical connectivity to make a drawing look cleaner.

## 7. Pipe and Connection Geometry

Line drawing rules: prefer horizontal and vertical segments; 90-degree turns where appropriate; avoid unnecessary diagonal lines; keep lines visually continuous; avoid overlapping equipment labels; minimize unnecessary crossings; consistent line weights; arrowheads visible; do not cut lines at container boundaries.

Connection rules:

* A connected branch must visibly join the main line.
* Use a clear junction marker where a junction is intended and the adopted drawing convention requires one.
* A crossing without connection must be visually distinguishable from a real junction.
* Never leave apparent open pipe ends without an endpoint, continuation marker, or explanation.
* Avoid disconnected lines that appear connected because of their proximity.

Branches and manifolds — for multiple connected equipment items: show the actual common header when known; show each documented branch separately; preserve the correct sequence of connections; identify relevant branch tags; show individual isolation devices where known. Do not join multiple branches just to reduce diagram complexity.

## 8. Piping Labels

For each relevant line, display available: line number, nominal size, service or fluid, material/specification where needed, known flow direction. Prioritize line numbers and equipment tags. Keep labels parallel to the associated line where readable. Do not overlap line labels with valves or instrument symbols. If a line number is unknown, omit it or mark it Unknown. **Never invent a plausible line number.**

## 9. Valves

Use suitable valve symbols according to the recorded type (gate, globe, ball, butterfly, check / NRV, control valve, MOV, PSV, spectacle blind, other isolation and process valves). Each valve should have its actual tag when available. Show the correct location in the documented process topology.

Valve status — do not assume a valve is open or closed. Display a valve position only when it is supported by a recorded status, approved procedure, or other suitable source. Do not automatically translate a valve shown on a P&ID into an operational instruction.

## 10. Instruments and Controls

Use established instrument identification conventions. Show relevant FT / FI, PT / PI, TT / TI, LT / LI, FIC / PIC / TIC / LIC, relevant control valves. Use the actual documented instrument tag. Distinguish process lines, instrument signal lines, electrical/control connections. For simplified process drawings, include only instruments important to the requested task. Do not overcrowd the diagram with unrelated instruments.

## 11. Neutralization Loop Completeness

For every Neutralization Loop, examine the available data for:

* **Main circuit** — starting point, ending point, main pipe route, all main connected equipment, relevant supply and return paths.
* **Chemicals and utilities** — chemical or neutralization medium source, injection connection, filling point, relevant utility supply, drain and disposal destination.
* **Flow and connections** — branch connections, header connections, tie-ins, flow direction, shared sections with other loops.
* **Boundaries** — verified boundary valves, blinds where documented, relevant interface equipment, unverified or unknown boundaries.
* **Instruments** — important measurement points, relevant control valves, existing instrument tags.
* **Operational information** — loop ID, equipment involved, known line numbers, source document, data verification status.

Completeness means showing all important recorded components and explicitly identifying missing information. It does not mean inventing missing components.

## 12. Shared Equipment and Interconnected Loops

Some refinery loops share equipment, headers, or piping. The system must support one equipment item appearing in multiple diagrams, common headers, shared branches, related loops, connections crossing diagram boundaries. Maintain one underlying equipment identity. Do not create duplicate equipment records simply because an item appears in multiple loop diagrams. Where appropriate, show a continuation reference to another diagram.

## 13. Automatic Layout Engine

Generate diagrams from structured connection data.

1. **Build the topology** — nodes (equipment, valves, junctions, boundaries), edges (verified piping or process connections), attributes (tags, services, sizes, direction, source).
2. **Find main flow** — identify the confirmed main process path.
3. **Arrange equipment** — logical process order while respecting known physical connection relationships.
4. **Route connections** — connect the correct ports and branches with readable paths.
5. **Add labels** — consistent engineering labeling.
6. **Identify uncertainties** — mark unresolved details without creating imaginary connections.
7. **Check diagram quality** — missing connected components, broken paths, incorrect junctions, crossed lines, overlapping text, truncated tags, missing arrows, unclear branches, incorrect equipment orientation, unsupported physical assumptions.

Automatically reroute or rearrange visual elements to improve readability without altering the topology.

## 14. Visual Design System

Restrained, professional engineering appearance: light neutral drawing background; dark process lines; consistent engineering symbols; clearly readable equipment tags; muted secondary labels; distinct styling for unverified information; minimal decorative effects.

Avoid 3D equipment illustrations, decorative gradients, cartoon symbols, excessive colors, unnecessary cards, large visual shadows, overcrowded labels.

Line hierarchy: main process lines most prominent; secondary branches standard; instrument signals a distinct line pattern; unverified connections clearly differentiated; annotations visually secondary.

**Do not use color as the only distinction.**

## 15. Typography and Labels

Keep diagram text compact, but always readable. Never cut equipment tags. Do not split equipment IDs across lines. Avoid truncating line numbers. Prefer short equipment descriptions. Use a unified font family. Keep the same text hierarchy across diagrams. Allow zooming without loss of text quality. Avoid overlapping labels or placing text on top of pipes. When text cannot fit, reposition the label or expand the drawing.

## 16. Diagram Interaction

Reuse the existing Drawing Viewer. Support zoom, pan, fit to screen, full screen, mobile pinch zoom, clear equipment labels, equipment detail navigation where available. Prefer SVG or another suitable vector representation so generated diagrams remain sharp when zoomed. Support revisions and authorized corrections. Do not create a separate viewer for each engineering domain.

## 17. Technical Verification Levels

Every generated diagram must show its source and verification status.

* **Verified** — the specific connection or component is confirmed against an approved engineering source.
* **Unverified** — a connection or component is supported by existing but unverified data.
* **Unknown** — required information is unavailable.

Do not visually connect two items where their relationship is unknown. Show an unresolved boundary or a clearly labeled unresolved connection instead. A diagram with unresolved connections must not be presented as complete or verified.

## 18. Mandatory Source Priority

Before drawing, examine:

1. Approved P&IDs and engineering drawings available in the system
2. Verified equipment and piping records
3. Approved operating procedures and isolation information
4. Existing structured line-up data
5. Historical records and engineering notes

Lower-confidence records must not override approved engineering documents. If sources conflict, identify the conflict rather than silently choosing a preferred connection. Do not assume Train-2 connections match Train-1 simply because tags appear similar.

## 19. Drawing Metadata

Every generated diagram should retain: diagram name, loop ID, equipment references, date generated, source references, diagram revision, verification status, generator version where available. Distinguish source-document revision from generated-diagram revision. Do not label an automatically produced schematic as an approved P&ID.

## 20. Safety Restriction

Generated process diagrams are visual reference material only. They must not independently authorize isolation, blinding, valve manipulation, neutralization, chemical injection, equipment entry, startup, handover, or maintenance execution. Do not generate operational sequences or required valve positions from unverified connectivity.

Display:

**AUTO-GENERATED PROCESS SCHEMATIC — REFERENCE ONLY — NOT A VERIFIED P&ID**

## 21. Mandatory Diagram Quality Check

Before releasing a generated diagram, confirm:

Engineering representation
* [ ] Correct equipment type and orientation
* [ ] Correct documented connections
* [ ] All relevant main equipment included
* [ ] Main process route understandable
* [ ] Known flow directions shown
* [ ] Vapor/liquid separation represented correctly where applicable
* [ ] Relevant valves and instruments shown
* [ ] Unverified data visibly identified

Visual quality
* [ ] No disconnected or misleading lines
* [ ] No overlapping components
* [ ] No incorrect junctions
* [ ] No clipped labels
* [ ] No unreadable tags
* [ ] No unnecessary crossings
* [ ] Consistent symbols and typography
* [ ] Works at desktop and mobile sizes

Data quality
* [ ] No invented equipment
* [ ] No invented piping
* [ ] No invented valves
* [ ] No invented flow direction
* [ ] Missing source information identified
* [ ] Source and revision preserved

## 22. Implementation Instructions

Apply this skill to the existing refinery application. Use the current equipment database, piping line-up, neutralization records, SOP data, existing drawing storage, existing Drawing Viewer. Do not rebuild the application. Do not create another database of duplicate equipment. Build reusable diagram components and layout rules for future use across Neutralization, Shutdown, Equipment, and Startup Preparation. Generate diagrams from available structured data. If critical topology is missing, draw only the supported portion and explicitly mark the remaining information as unresolved. Start with FT-681 to FT-684, then expand to other loops using the same engine. Keep development practical and avoid unnecessary approval cycles for routine design decisions.

## 23. Learned review rules (mandatory) and how feedback is handled

**Every review comment improves the shared engine, not one drawing.**

1. Classify the comment:
   - **General drawing rule** → added to the list below, to `src/core/tracker/drawingRules.ts` (`DRAWING_RULES`,
     checked on every sheet by `checkRules`) and to the engine, with a test in `__tests__/drawingRules.test.ts`.
   - **Loop-specific technical information** (a connection, a valve, a state, a tag) → saved as structured records
     (`trk_loop_fix` with role, `trk_loop_node` with state and source), logged and withdrawable; never a one-off edit.
2. Before any drawing is shown, all approved rules are checked; the result is in the Details panel
   ("Review rules n/n passed") and a failure is listed as a layout issue.
3. General improvements apply to every loop once the reference drawing (FT-681) is approved; engineering connections
   are never changed by a layout change.
4. **Never assume a bypass has a control valve** (or any valve) unless a record or a confirmed correction for that
   loop gives it; a recorded tag or position not confirmed is drawn and marked "UNVERIFIED".

Approved rules (from the Section Head's reviews, 24 Oct 2026):

| ID | Rule |
|---|---|
| R1 | Never shortcut a recorded route: every item between two connected items is drawn in sequence. |
| R2 | Each exchanger bypass is its own branch with its own route; no two bypasses share a line. |
| R3 | A valve is drawn only from a record or a confirmed correction; an unconfirmed tag / position is marked unverified. |
| R4 | A standby / isolated branch is drawn apart from the active route, with its isolating valves and their recorded state. |
| R5 | Active path, bypass, standby and injection differ by colour and weight; verification by line pattern. |
| R6 | Two different physical points are never one junction (tie-in ≠ pass split). |
| R7 | A multi-pass heater shows each pass entering on its own; passes are never merged. |
| R8 | Shells in series (E-216A/B) are drawn as separate shells in sequence. |
| R9 | Junction dots only where pipes really join or split; no crossings, no shared-looking or overlapping lines. |
| R10 | No label on a pipe, a symbol or another label; no clipped tags; text is not shrunk to fit. |
| R11 | Compact: branches next to where they connect; folded / multi-row arrangements are tried; fitted to content. |
| R12 | The sheet keeps the title, an essential legend and the warnings; lists and metadata go to the Details panel. |
| R13 | Nothing is removed to make a drawing smaller. |
| R14 | The route may turn 90° and continue on another row (U / serpentine / folded) when that is more compact; a continuous pipe is preferred to A/B markers; never accepted with a crossing; a turn is a drawing choice, not a piping change. |
| R15 | Fill, vent and drain points recorded on a line or an item are drawn there (D / V / F markers); unknown locations are listed clearly. |
| R16 | Layout by blocks: an exchanger (or shells in series) and its bypass form one group, the bypass and its valve drawn just above it. Blocks go on rows that alternate direction (serpentine, continuous 180° turns at the row ends). Compare horizontal, folded, two-row and serpentine arrangements; reject any with a crossing, shared-looking line or collision; keep the most compact one with a near-square shape. Where two bypasses overlap only because the order of a takeoff and an inline valve is not recorded, draw the takeoff past the valve and say so in Details. Engine: `schematicSerpentine.ts`. |

## Final Principle

A professional process diagram is defined by correct engineering relationships, understandable flow, recognizable symbols, and readable presentation — not by decoration.

The goal is to help refinery personnel understand documented process relationships quickly without mistaking an automatically generated drawing for an approved operating document.
