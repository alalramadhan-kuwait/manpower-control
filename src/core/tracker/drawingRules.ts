// Drawing rules approved in the Section Head's reviews. Every generated drawing is checked against them before it is
// shown (result in the Details panel); each rule also has a test in __tests__/drawingRules.test.ts so a corrected
// error cannot come back. The same list is in .claude/skills/refinery-process-diagram/SKILL.md §23.
// A review comment is either a general rule (added here, to the skill and to the engine) or loop-specific technical
// information (saved as structured records: trk_loop_fix / trk_loop_node), never a one-off edit of one drawing.
import type { Schematic } from './schematic';

export interface DrawingRule { id: string; rule: string; from: string }
export const DRAWING_RULES: DrawingRule[] = [
  { id: 'R1', rule: 'Never shortcut a recorded route: every item between two connected items is drawn in sequence.', from: 'Stage 1, FT-681' },
  { id: 'R2', rule: 'Each exchanger bypass is its own branch with its own route; no two bypasses share a line.', from: 'Stage 1 + revision, FT-681' },
  { id: 'R3', rule: 'A valve (control, MOV, block) is drawn only from a record or a confirmed correction; a tag or position not confirmed is marked unverified. A bypass is never given a control valve by assumption.', from: 'Revision, FT-681' },
  { id: 'R4', rule: 'A standby / isolated branch is drawn apart from the active route, with the valves that isolate it and their recorded state.', from: 'Stage 1, FT-681' },
  { id: 'R5', rule: 'Active path, bypass, standby and injection are told apart by colour and weight; verification by line pattern.', from: 'Stage 1, FT-681' },
  { id: 'R6', rule: 'Two different physical points are never one junction (a tie-in and a pass split are separate).', from: 'Stage 1, FT-681' },
  { id: 'R7', rule: 'A multi-pass heater shows each pass entering on its own; passes are never merged.', from: 'Stage 1 / compact review' },
  { id: 'R8', rule: 'Shells in series (E-216A/B) are drawn as separate shells in sequence.', from: 'Stage 1, FT-681' },
  { id: 'R9', rule: 'Junction dots only where pipes really join or split; no crossing, no shared-looking or overlapping lines.', from: 'Revision, FT-681' },
  { id: 'R10', rule: 'No label on a pipe, a symbol or another label; no clipped or truncated tags; text is not made smaller to fit.', from: 'Compact review + revision' },
  { id: 'R11', rule: 'Compact: branches sit next to where they connect; empty space is used (folded / multi-row arrangements are tried); the drawing is fitted to its content.', from: 'Compact review + revision' },
  { id: 'R12', rule: 'The sheet keeps the title, an essential legend and the warnings; procedure points, unknowns, sources and revision go to the Details panel.', from: 'Compact review' },
  { id: 'R13', rule: 'Nothing is removed to make a drawing smaller: every item, valve, bypass, vent, drain and connection of the record stays.', from: 'Compact review' },
  { id: 'R14', rule: 'The route may turn 90° and continue on another row (U / serpentine / folded); a continuous pipe is preferred to A/B markers; a turn is a drawing choice, never a piping change, and never accepted with a crossing.', from: '90° routing rule' },
  { id: 'R15', rule: 'Fill, vent and drain points recorded on a line or an item are drawn on that line / item (D / V / F); points whose location is not recorded are listed as such.', from: 'FT-681 review (fill / vent / drain)' },
];

/** The rules a finished drawing can be checked against automatically (the rest are guaranteed by how it is built). */
export function checkRules(s: Schematic, svg: string, issues: string[]): { passed: string[]; failed: string[] } {
  const failed: string[] = [];
  const fail = (id: string, why: string) => failed.push(`${id}: ${why}`);
  // R13 / R1: every item of the topology is on the sheet
  for (const n of s.nodes) if (n.kind !== 'junction' && !svg.includes(`>${n.tag.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}<`)) fail('R13', `${n.tag} not drawn`);
  // R3: valves only from records — every valve in the topology came from a record or a correction (never added by the engine)
  for (const n of s.nodes) if (n.kind === 'valve' && !n.state && !s.links.some((l) => (l.a === n.key || l.b === n.key) && (l.source || l.user))) fail('R3', `${n.tag} has no source`);
  // R7: no merged passes — every pass link of a heater keeps its own inlet
  // R9 / R10: from the layout check
  for (const i of issues) {
    if (/crossing/.test(i)) fail('R9', i);
    if (/shared-looking|overlapping line/.test(i)) fail('R9', i);
    if (/label/.test(i)) fail('R10', i);
    if (/could not be placed on its line/.test(i)) fail('R15', i);
  }
  const ids = new Set(failed.map((f) => f.split(':')[0]));
  return { passed: DRAWING_RULES.map((r) => r.id).filter((id) => !ids.has(id)), failed };
}
