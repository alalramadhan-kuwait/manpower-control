import { describe, expect, it } from 'vitest';
import { buildSchematic, schematicSvg, SCHEMATIC_LABEL, type LoopFix } from '../schematic';
import type { LuStream, TrkPointStep } from '..';

const step = (seq: number, phase: TrkPointStep['phase'], text: string): TrkPointStep => ({ id: `s${seq}`, pointId: 'L', seq, phase, text, source: 'SOP §3.9', doneAt: null, doneBy: null, crane: false, kind: 'check', startAt: null, startBy: null });
const lu = (from: string, to: string, line: string, conf: string): LuStream => ({ id: line, from, to, fluid: null, line, lineNos: [line], sheets: ['1-R-12-0-106'], size: null, conf });
const fix = (v: Partial<LoopFix>): LoopFix => ({ id: 'f', pointId: 'L', op: 'note', target: null, a: null, b: null, line: null, kind: null, text: null, sheet: null, reason: null, status: 'active', by: 'Engineer', at: '', ...v });

describe('auto-generated loop schematic', () => {
  const ft = { id: 'L', ref: 'FT-681', name: 'FT/FV-681…684 feed lines', detail: 'FT-681/682/683/684 and inlet FV-681…684 neutralization', items: ['H-12-201'], requires: [], method: 'soak' as const };
  const ftSteps = [step(1, 'before', 'H-201 decoking completed and H-201 handed over'), step(2, 'before', 'P-103B and P-203 discharge MOV-502/501 and B/Vs closed'),
    step(7, 'fill', 'Neutralized as per the feed line procedure (P-203 and P-103B to H-201 inlet)')];
  it('FT-681: the pumps feed the FT/FV group into the H-201 inlet, as the procedure says; nothing else is invented', () => {
    const s = buildSchematic(ft, { steps: ftSteps });
    expect(s.nodes.map((n) => n.tag).sort()).toEqual(['FT/FV-681…684', 'H-201', 'P-103B', 'P-203']);
    expect(s.links.map((l) => `${l.a}>${l.b}`).sort()).toEqual(['FT/FV-681…684>H-201', 'P-103B>FT/FV-681…684', 'P-203>FT/FV-681…684']);
    expect(s.links.every((l) => l.basis === 'record' && !l.lines.length)).toBe(true);
    expect(s.marks.find((m) => m.kind === 'isolation')?.text).toMatch(/MOV-502\/501/);
    expect(s.unknown.join(' ')).toMatch(/Line numbers not in the P&ID line-up/);
    expect(s.unknown.join(' ')).toMatch(/Fill \(soda ash in\) points are not recorded/);
    expect(s.unknown.join(' ')).toMatch(/No boundary blinds/);
  });
  it('a chain in the record, checked against the line-up (verified / Train-2 unchecked / not found)', () => {
    const p = { id: 'L', ref: 'S320', name: 'V-213 to E-210', detail: 'V-213 vapour → E-210A/B T/S → E-211 → V-209', items: ['E-12-210A/B'], requires: ['SEG-01'], method: 'soak' as const };
    const s = buildSchematic(p, { lineup: [lu('V-213', 'E-210A/B', 'P-12-2346', 'ok'), lu('E-210A/B', 'E-211', 'P-12-2350', 'check')], points: [{ kind: 'blind', ref: 'SEG-01', name: 'V-213 O/L' }] });
    expect(s.nodes.map((n) => n.tag)).toEqual(['V-213', 'E-210A/B', 'E-211', 'V-209']);   // E-210 and E-210A/B are one item
    expect(s.links.map((l) => l.basis)).toEqual(['verified', 'unchecked', 'record']);
    expect(s.links[0].lines).toEqual(['P-12-2346']);
    expect(s.marks).toEqual([expect.objectContaining({ kind: 'blind', text: 'SEG-01 · V-213 O/L' })]);
  });
  it('procedure points are taken word for word: soda ash hoses = fill, drain hoses = drain, clear soda ash = vent', () => {
    const p = { id: 'L', ref: 'X', name: 'V-206 to V-213', detail: null, items: [], requires: [], method: 'soak' as const };
    const s = buildSchematic(p, { steps: [step(1, 'before', 'Soda ash hoses on V-206 and V-207 drains, drain hoses on LV-511A/B U/S and D/S drains'), step(2, 'fill', 'Clear soda ash at LV-511A/B drains, drains closed')] });
    expect(s.marks.map((m) => `${m.kind}:${m.text}`)).toEqual(['fill:V-206 and V-207 drains', 'drain:LV-511A/B U/S and D/S drains', 'vent:Clear soda ash at LV-511A/B drains']);
  });
  it('corrections: a removed connection goes, an added one is shown as the person\'s (checked only with a sheet)', () => {
    const s = buildSchematic(ft, { steps: ftSteps, fixes: [fix({ op: 'remove', target: 'link:P-103B>FT/FV-681…684', reason: 'P-103B not used' }), fix({ op: 'add_link', a: 'E-229', b: 'H-201', line: 'P-12-2303', sheet: '1-4-12-0-313' }), fix({ op: 'add_link', a: 'X-1', b: 'H-201', status: 'withdrawn' })] });
    expect(s.links.some((l) => l.a === 'P-103B')).toBe(false);
    expect(s.links.find((l) => l.a === 'E-229')).toMatchObject({ basis: 'user_verified', lines: ['P-12-2303'], user: 'Engineer' });
    expect(s.nodes.some((n) => n.tag === 'X-1')).toBe(false);
  });
  it('a loop with no equipment named says the route is not known; the sheet is labelled as not a verified P&ID', () => {
    const s = buildSchematic({ id: 'L', ref: 'S112', name: 'ADD line', detail: null, items: [], requires: [], method: 'soak' }, {});
    expect(s.nodes).toEqual([]); expect(s.unknown[0]).toMatch(/route is not known/);
    const svg = schematicSvg(s, '24 Oct 2026');
    expect(svg).toContain(SCHEMATIC_LABEL.toUpperCase().replace('&', '&amp;')); expect(svg).toContain('Route not available');
  });
});
