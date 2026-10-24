// One test per approved review rule (drawingRules.ts / SKILL.md §23): a corrected drawing error must not come back.
import { describe, expect, it } from 'vitest';
import { buildSchematic, renderSchematic, type LoopFix, type LoopItem } from '../schematic';
import { DRAWING_RULES } from '../drawingRules';

let n = 0;
const fx = (a: string, b: string, role: LoopFix['role'], line: string | null = null): LoopFix => ({ id: `f${n++}`, pointId: 'L', op: 'add_link', target: null, a, b, line, kind: null, text: null, sheet: null, reason: null, status: 'active', by: 'Section Head', at: '', role });
const it_ = (tag: string, state: LoopItem['state'], label: string | null = null): LoopItem => ({ id: tag, pointId: 'L', tag, label, state, source: 'SOP step 2', status: 'active', by: 'x' });
const loop = { id: 'L', ref: 'REF', name: 'reference loop', detail: null, items: [], requires: [], method: 'soak' as const };
/** the FT-681 reference topology (Section Head, Stage 1 + revision) */
function reference() {
  const fixes = [fx('P-203', 'J:tie', 'active', 'P-12-2014'), fx('J:tie', 'E-203', 'active'), fx('E-203', 'E-216A', 'active'), fx('E-216A', 'E-216B', 'active'), fx('E-216B', 'E-229', 'active'), fx('E-229', 'J:hdr', 'active'),
    ...['P1', 'P2', 'P3', 'P4'].flatMap((p) => [fx('J:hdr', `FT/FV-${p}`, 'active'), fx(`FT/FV-${p}`, 'H-201', 'active')]),
    fx('J:tie', 'HV-548B', 'bypass'), fx('HV-548B', 'E-216A', 'bypass'), fx('E-203', 'HV-546B', 'bypass'), fx('HV-546B', 'E-229', 'bypass'), fx('E-216B', 'HV-863', 'bypass'), fx('HV-863', 'J:hdr', 'bypass'),
    fx('P-103B', 'MOV-501/502', 'standby'), fx('MOV-501/502', 'B/V P-103B', 'standby'), fx('B/V P-103B', 'J:tie', 'standby'),
    fx('Injection water manifold', 'FV-691', 'injection'), fx('FV-691', 'B/V FV-691 D/S', 'injection'), fx('B/V FV-691 D/S', 'H-201', 'injection')];
  const items = [it_('P-103B', 'standby'), it_('MOV-501/502', 'closed'), it_('B/V P-103B', 'closed'), it_('B/V FV-691 D/S', 'closed'), it_('J:tie', 'known', 'Tie-in on P-12-2014'), it_('J:hdr', 'unresolved', 'H-201 inlet header'),
    it_('HV-548B', 'unresolved'), it_('HV-546B', 'unresolved'), it_('HV-863', 'unresolved')];
  const s = buildSchematic(loop, { fixes, items });
  return { s, r: renderSchematic(s, 'x', { compact: true }) };
}
const xy = (svg: string, tag: string) => { const m = svg.match(new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*>${tag.replace(/[/]/g, '\\/')}<`)); return m ? { x: +m[1], y: +m[2] } : null; };

describe('approved drawing rules (FT-681 reference)', () => {
  const { s, r } = reference();
  it('every rule is checked on the sheet and all pass', () => {
    expect(r.issues).toEqual([]);
    expect(r.info.meta.find(([k]) => k === 'Review rules')?.[1]).toBe(`${DRAWING_RULES.length}/${DRAWING_RULES.length} passed`);
  });
  it('R1 the route is not shortcut: the train is drawn in its sequence', () => {
    const xs = ['P-203', 'E-203', 'E-216A', 'E-216B', 'E-229'].map((t) => xy(r.svg, t)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });
  it('R2 each bypass has its own route: overlapping bypasses are on opposite sides', () => {
    const main = xy(r.svg, 'E-203')!.y, a = xy(r.svg, 'HV-548B')!.y, b = xy(r.svg, 'HV-546B')!.y;
    expect(Math.sign(a - main)).not.toBe(Math.sign(b - main));
  });
  it('R3 no control valve is added to a bypass without a record; recorded ones not confirmed are marked unverified', () => {
    const bare = buildSchematic(loop, { fixes: [fx('A-101', 'E-203', 'active'), fx('E-203', 'E-216', 'active'), fx('A-101', 'E-216', 'bypass')] });
    expect(bare.nodes.filter((x) => x.kind === 'valve')).toEqual([]);
    expect(r.svg).toContain('UNVERIFIED tag / position');
  });
  it('R4 the standby branch shows its state and closed isolation valves', () => {
    expect(r.svg).toContain('STANDBY — ISOLATED (SOP step 2)'); expect(r.svg).toContain('CLOSED (SOP step 2)');
  });
  it('R6 a tie-in and a pass header are separate junctions', () => { expect(s.nodes.filter((x) => x.kind === 'junction').length).toBe(2); });
  it('R7 each heater pass enters on its own line', () => {
    const ends = [...r.svg.matchAll(/<path d="M [^"]*L ([\d.]+) ([\d.]+)"[^>]*marker-end="url\(#ar-r-active\)"/g)].map((m) => `${m[1]}:${m[2]}`);
    const heaterX = xy(r.svg, 'H-201')!.x; const into = ends.filter((e) => Math.abs(+e.split(':')[0] - (heaterX - 28)) < 1);
    expect(new Set(into).size).toBe(4);
  });
  it('R8 shells in series are two shells', () => { expect(xy(r.svg, 'E-216A')).not.toBeNull(); expect(xy(r.svg, 'E-216B')).not.toBeNull(); });
  it('R9 / R10 no crossings, no shared lines, no label collisions', () => {
    expect(r.info.meta.find(([k]) => k === 'Layout')?.[1]).toMatch(/0 crossings/); expect(r.issues.filter((i) => /label|shared|crossing/.test(i))).toEqual([]);
  });
  it('R12 the sheet keeps lists off the drawing: they are in Details', () => {
    expect(r.svg).not.toContain('Unknown / unresolved — not in the records'); expect(r.info.sections.some((x) => /Unknown/.test(x.title))).toBe(true);
  });
  it('R13 nothing is removed: every item is on the sheet', () => {
    for (const x of s.nodes.filter((q) => q.kind !== 'junction')) expect(r.svg).toContain(`>${x.tag}<`);
  });
  it('R15 a drain recorded on a line is drawn on that line', () => {
    const fixes = [fx('A-101', 'E-203', 'active'), { ...fx('E-203', 'E-216', 'active') }, { id: 'm1', pointId: 'L', op: 'add_mark' as const, target: 'at:start', a: 'E-203', b: 'E-216', line: null, kind: 'drain' as const, text: 'DX-1 drain', sheet: null, reason: 'line-up', status: 'active' as const, by: 'x', at: '' }];
    const r2 = renderSchematic(buildSchematic(loop, { fixes }), 'x', { compact: true });
    expect(r2.svg).toContain('D: DX-1'); expect(r2.svg).toContain('Drains: 1 drawn');
  });
});
