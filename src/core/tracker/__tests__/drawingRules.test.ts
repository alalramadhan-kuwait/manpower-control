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
    ...['P1', 'P2', 'P3', 'P4'].flatMap((p, i) => [fx('J:hdr', `FT/FV-${p}`, 'active'), fx(`FT/FV-${p}`, `J:inj ${p}`, 'active'), fx(`J:inj ${p}`, 'H-201', 'active'),
      fx('Injection water manifold', `FV-69${i + 1}`, 'injection'), fx(`FV-69${i + 1}`, `B/V FV-69${i + 1} D/S`, 'injection'), fx(`B/V FV-69${i + 1} D/S`, `J:inj ${p}`, 'injection')]),
    fx('H-201', 'J:out', 'active'),
    fx('J:tie', 'HV-548B', 'bypass'), fx('HV-548B', 'E-216A', 'bypass'), fx('E-203', 'HV-546B', 'bypass'), fx('HV-546B', 'E-229', 'bypass'), fx('E-216B', 'HV-863', 'bypass'), fx('HV-863', 'J:hdr', 'bypass'),
    fx('P-103B', 'MOV-501/502', 'standby'), fx('MOV-501/502', 'B/V P-103B', 'standby'), fx('B/V P-103B', 'J:tie', 'standby'),
  ];
  const items = [it_('P-103B', 'standby'), it_('MOV-501/502', 'closed'), it_('B/V P-103B', 'closed'), it_('B/V FV-691 D/S', 'closed'), it_('J:tie', 'known', 'Tie-in on P-12-2014'), it_('J:hdr', 'unresolved', 'H-201 inlet header'), it_('J:out', 'known', 'Outlet header'),
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
  it('R1 the route is not shortcut: the train is drawn in its sequence (row by row, rows alternating direction)', () => {
    const ps = ['P-203', 'E-203', 'E-216A', 'E-216B', 'E-229'].map((t) => xy(r.svg, t)!);
    const rows = [...new Set(ps.map((p) => p.y))].sort((a, b) => a - b);
    const order = ps.map((p) => { const ri = rows.indexOf(p.y); return ri * 1e5 + (ri % 2 ? -p.x : p.x); });
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('R16 each bypass is drawn with the items it goes around, its valve just above them; the sheet is near-square', () => {
    const v = xy(r.svg, 'HV-546B')!, a = xy(r.svg, 'E-216A')!, b = xy(r.svg, 'E-216B')!;
    expect(v.y).toBeLessThan(a.y); expect(a.y).toBe(b.y); expect(v.x).toBeGreaterThan(Math.min(a.x, b.x) - 120); expect(v.x).toBeLessThan(Math.max(a.x, b.x) + 120);
    const [, , W, H] = r.svg.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/)!.slice(1).map(Number);
    expect(Math.max(W / H, H / W)).toBeLessThan(1.7);
    expect(r.info.meta.find(([k]) => k === 'Layout')?.[1]).toMatch(/serpentine|one row/);
  });
  it('R2 each bypass has its own route: no shared line, each valve over its own exchangers', () => {
    expect(r.issues.filter((i) => /shared|overlapping/.test(i))).toEqual([]);
    const a = xy(r.svg, 'HV-548B')!, b = xy(r.svg, 'HV-546B')!; expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(100);
    expect(Math.abs(a.x - xy(r.svg, 'E-203')!.x)).toBeLessThan(Math.abs(b.x - xy(r.svg, 'E-203')!.x) + 1);
  });
  it('R3 no control valve is added to a bypass without a record; recorded ones not confirmed are marked unverified', () => {
    const bare = buildSchematic(loop, { fixes: [fx('A-101', 'E-203', 'active'), fx('E-203', 'E-216', 'active'), fx('A-101', 'E-216', 'bypass')] });
    expect(bare.nodes.filter((x) => x.kind === 'valve')).toEqual([]);
    expect(r.svg).toContain('UNVERIFIED tag / position');
  });
  it('R4 the standby branch shows its state and closed isolation valves', () => {
    expect(r.svg).toContain('STANDBY — ISOLATED (SOP step 2)'); expect(r.svg).toContain('CLOSED (SOP step 2)');
  });
  it('R6 a tie-in and a pass header are separate junctions', () => { expect(s.nodes.filter((x) => x.kind === 'junction' && /tie|hdr/.test(x.key)).length).toBe(2); });
  it('R7 each heater pass enters on its own line', () => {
    const ends = [...r.svg.matchAll(/<path d="M [^"]*L ([\d.]+) ([\d.]+)"[^>]*marker-end="url\(#ar-r-active\)"/g)].map((m) => ({ x: +m[1], y: +m[2] }));
    const heaterX = xy(r.svg, 'H-201')!.x; const into = ends.filter((e) => Math.abs(Math.abs(e.x - heaterX) - 75) < 1);
    expect(new Set(into.map((e) => e.y)).size).toBe(4);
  });
  it('R17 multi-pass fired heater: a firebox with one coil per pass, injection joining each pass before the heater, outlets into one header', () => {
    expect(r.svg).toContain('Fired heater · 4 passes, each through its own coil');
    expect((r.svg.match(/<polyline points="[^"]*" fill="none" stroke="#0f172a" stroke-width="2"\/>/g) ?? []).length).toBe(4);   // four coils
    const heaterX = xy(r.svg, 'H-201')!.x;
    for (const p of ['P1', 'P2', 'P3', 'P4']) expect(xy(r.svg, `FT/FV-${p}`)!.x < heaterX === xy(r.svg, 'FV-691')!.x < heaterX).toBe(true);   // injection on the inlet side
    expect(r.svg).toContain('UNVERIFIED — which injection branch joins which pass is not recorded');
    expect(r.svg).not.toMatch(/>pass [1-4]</);   // no pass numbers the records do not give
    expect(r.info.meta.find(([k]) => k === 'Layout')?.[1]).toMatch(/3 unavoidable crossings drawn with a break/);
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
