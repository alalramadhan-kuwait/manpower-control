import { describe, expect, it } from 'vitest';
import { buildSchematic, renderSchematic, schematicSvg, SCHEMATIC_LABEL, type LoopFix, type LoopItem } from '../schematic';
import type { LuStream, TrkPointStep } from '..';

const step = (seq: number, phase: TrkPointStep['phase'], text: string): TrkPointStep => ({ id: `s${seq}`, pointId: 'L', seq, phase, text, source: 'SOP §3.9', doneAt: null, doneBy: null, crane: false, kind: 'check', startAt: null, startBy: null });
const lu = (from: string, to: string, line: string, conf: string): LuStream => ({ id: line, from, to, fluid: null, line, lineNos: [line], sheets: ['1-R-12-0-106'], size: null, conf });
const fix = (v: Partial<LoopFix>): LoopFix => ({ id: 'f', pointId: 'L', op: 'note', target: null, a: null, b: null, line: null, kind: null, text: null, sheet: null, reason: null, status: 'active', by: 'Engineer', at: '', ...v });

describe('auto-generated loop schematic', () => {
  const ft = { id: 'L', ref: 'FT-681', name: 'FT/FV-681…684 feed lines', detail: 'FT-681/682/683/684 and inlet FV-681…684 neutralization', items: ['H-12-201'], requires: [], method: 'soak' as const };
  const ftSteps = [step(1, 'before', 'H-201 decoking completed and H-201 handed over'), step(2, 'before', 'P-103B and P-203 discharge MOV-502/501 and B/Vs closed'),
    step(7, 'fill', 'Neutralized as per the feed line procedure (P-203 and P-103B to H-201 inlet)')];
  it('FT-681: the pumps feed four separate passes (FT/FV-681…684) into the H-201 inlet; the split is drawn unresolved', () => {
    const s = buildSchematic(ft, { steps: ftSteps });
    expect(s.nodes.map((n) => n.tag).sort()).toEqual(['FT/FV-681', 'FT/FV-682', 'FT/FV-683', 'FT/FV-684', 'H-201', 'P-103B', 'P-203', 'Split not recorded']);
    expect(s.links.filter((l) => l.b === 'H-201').map((l) => `${l.a}:${l.bSide}`)).toEqual(['FT/FV-681:pass 1 inlet', 'FT/FV-682:pass 2 inlet', 'FT/FV-683:pass 3 inlet', 'FT/FV-684:pass 4 inlet']);
    expect(s.links.filter((l) => l.b === 'J:split').map((l) => l.a).sort()).toEqual(['P-103B', 'P-203']);
    expect(s.links.every((l) => l.basis === 'record' && !l.lines.length)).toBe(true);
    expect(s.status).toBe('Unverified');
    expect(s.unknown[0]).toMatch(/where the common feed splits into the passes.*not recorded/);
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
    const s = buildSchematic(ft, { steps: ftSteps, fixes: [fix({ op: 'remove', target: 'link:P-103B>J:split', reason: 'P-103B not used' }), fix({ op: 'add_link', a: 'E-229', b: 'H-201', line: 'P-12-2303', sheet: '1-4-12-0-313' }), fix({ op: 'add_link', a: 'X-1', b: 'H-201', status: 'withdrawn' })] });
    expect(s.links.some((l) => l.a === 'P-103B')).toBe(false);
    expect(s.links.find((l) => l.a === 'E-229')).toMatchObject({ basis: 'user_verified', lines: ['P-12-2303'], user: 'Engineer' });
    expect(s.nodes.some((n) => n.tag === 'X-1')).toBe(false);
  });
  it('a loop with no equipment named says the route is not known; the sheet is labelled as not a verified P&ID', () => {
    const s = buildSchematic({ id: 'L', ref: 'S112', name: 'ADD line', detail: null, items: [], requires: [], method: 'soak' }, {});
    expect(s.nodes).toEqual([]); expect(s.unknown[0]).toMatch(/route is not known/);
    const svg = schematicSvg(s, '24 Oct 2026'); expect(s.status).toBe('Unknown');
    expect(svg).toContain(SCHEMATIC_LABEL.toUpperCase().replace('&', '&amp;')); expect(svg).toContain('Route not available');
  });
  it('a record direction opposite to the line-up is flagged as a conflict, not silently changed', () => {
    const p = { id: 'L', ref: 'S318', name: 'P-203 to E-216', detail: 'E-216 → E-203', items: [], requires: [], method: 'soak' as const };
    const s = buildSchematic(p, { lineup: [lu('E-203', 'E-216', 'P-12-2052', 'check')] });
    const l = s.links.find((x) => x.a === 'E-216' && x.b === 'E-203')!;
    expect(l.basis).toBe('record'); expect(l.conflict).toMatch(/line-up gives E-203 → E-216 \(P-12-2052\)/);
    expect(s.unknown[0]).toMatch(/^Source conflict/);
  });
  it('Verified only when every connection is verified and nothing is unknown; the sheet carries metadata and passes its check', () => {
    const p = { id: 'L', ref: 'X', name: 'V-213 to E-211', detail: null, items: [], requires: ['SEG-01'], method: 'soak' as const };
    const steps = [step(1, 'before', 'Soda ash hoses on V-213 drain'), step(2, 'fill', 'Clear soda ash at E-211 vent')];
    const s = buildSchematic(p, { steps, lineup: [lu('V-213', 'E-211', 'P-12-2350', 'ok')], points: [{ kind: 'blind', ref: 'SEG-01', name: 'x' }] });
    expect(s.links[0].basis).toBe('verified');
    expect(s.status).toBe(s.unknown.length ? 'Unverified' : 'Verified');
    const r = renderSchematic(s, '24 Oct 2026');
    expect(r.issues).toEqual([]);
    for (const k of ['Diagram revision', `auto-${s.revision}`, 'Generator', 'Verification', 'Automatic check', 'NOT AN AUTHORIZATION']) expect(r.svg).toContain(k);
  });
  it('the revision changes with the data, not with the time it is built', () => {
    const a = buildSchematic(ft, { steps: ftSteps }), b = buildSchematic(ft, { steps: ftSteps });
    const c = buildSchematic(ft, { steps: ftSteps, fixes: [fix({ op: 'note', text: 'x' })] });
    expect(a.revision).toBe(b.revision); expect(c.revision).not.toBe(a.revision);
  });
  it('S318: corrections taken from the line-up remove the conflict and are checked against the line-up themselves', () => {
    const p = { id: 'L', ref: 'S318', name: 'Charge pump to H-201 passes', detail: 'Charge pump P-203 to H-201 passes: E-216 tube side, E-203 shell side, E-12-229 shell side', items: [], requires: [], method: 'soak' as const };
    const lineup = [lu('P-203A/B', 'E-203', 'P-12-2014', 'check'), lu('E-203', 'E-216A/B', 'P-12-2052', 'check'), lu('E-216A/B', 'E-229', 'P-12-2029', 'check'), lu('E-229', 'H-201', 'P-12-2303', 'check'),
      { ...lu('P-203A/B', 'E-216A/B', '', 'check'), lineNos: [], fluid: 'Resid feed - E-12-203 shell bypass' }];
    expect(buildSchematic(p, { lineup }).links.some((l) => l.conflict)).toBe(true);
    const fixes = [fix({ id: '1', op: 'remove', target: 'link:E-216>E-203', reason: 'line-up' }), fix({ id: '2', op: 'add_link', a: 'E-203', b: 'E-216', line: 'P-12-2052' }),
      fix({ id: '3', op: 'add_link', a: 'P-203', b: 'E-203', line: 'P-12-2014' }), fix({ id: '4', op: 'add_link', a: 'E-216', b: 'E-229', line: 'P-12-2029' })];
    const s = buildSchematic(p, { lineup, fixes });
    expect(s.links.some((l) => l.conflict)).toBe(false);
    expect(s.links.find((l) => l.a === 'E-203' && l.b === 'E-216')).toMatchObject({ basis: 'unchecked', lines: ['P-12-2052'], source: 'Correction by Engineer · P&ID line-up' });
    expect(s.links.find((l) => l.a === 'P-203' && l.b === 'E-216')?.service).toMatch(/bypass/);
    expect(renderSchematic(s, 'x').issues).toEqual([]);
  });
  it('a corrected topology: roles, a standby branch with closed valves, a tie-in matched through to the line-up', () => {
    const lineup = [lu('P-203A/B', 'E-203', 'P-12-2014', 'check'), lu('E-229', 'H-201', 'P-12-2303', 'check')];
    const fixes = [fix({ id: '1', op: 'add_link', a: 'P-203', b: 'J:tie', role: 'active' }), fix({ id: '2', op: 'add_link', a: 'J:tie', b: 'E-203', role: 'active' }),
      fix({ id: '3', op: 'add_link', a: 'P-103B', b: 'MOV-501/502', role: 'standby' }), fix({ id: '4', op: 'add_link', a: 'MOV-501/502', b: 'J:tie', role: 'standby' }),
      fix({ id: '5', op: 'add_link', a: 'E-229', b: 'J:hdr', role: 'active' })];
    const item = (tag: string, state: LoopItem['state'], label: string | null = null): LoopItem => ({ id: tag, pointId: 'L', tag, label, state, source: 'SOP step 2', status: 'active', by: 'x' });
    const s = buildSchematic({ id: 'L', ref: 'X', name: 'x', detail: null, items: [], requires: [], method: 'soak' }, { lineup, fixes,
      items: [item('P-103B', 'standby'), item('MOV-501/502', 'closed'), item('J:tie', 'known', 'Tie-in on P-12-2014'), item('J:hdr', 'unresolved', 'H-201 inlet header')] });
    expect(s.links.find((l) => l.a === 'P-203')).toMatchObject({ basis: 'unchecked', lines: ['P-12-2014'], role: 'active' });   // through the tie-in
    expect(s.links.find((l) => l.a === 'E-229')).toMatchObject({ lines: ['P-12-2303'] });                                        // the header stands for H-201
    expect(s.nodes.find((n) => n.key === 'MOV-501/502')).toMatchObject({ kind: 'valve', state: 'closed' });
    const r = renderSchematic(s, 'x');
    expect(r.svg).toContain('STANDBY — ISOLATED (SOP step 2)'); expect(r.svg).toContain('CLOSED (SOP step 2)'); expect(r.svg).toContain('Standby / isolated branch');
  });
  it('compact layout of a corrected topology: every item drawn, separate bypass routes, no crossings or label collisions', () => {
    const f = (id: string, a: string, b: string, role: LoopFix['role']) => fix({ id, op: 'add_link', a, b, role });
    const fixes = [f('1', 'P-203', 'E-203', 'active'), f('2', 'E-203', 'E-216A', 'active'), f('3', 'E-216A', 'E-216B', 'active'), f('4', 'E-216B', 'E-229', 'active'),
      f('5', 'P-203', 'HV-548B', 'bypass'), f('6', 'HV-548B', 'E-216A', 'bypass'), f('7', 'E-203', 'HV-546B', 'bypass'), f('8', 'HV-546B', 'E-229', 'bypass')];
    const item = (tag: string): LoopItem => ({ id: tag, pointId: 'L', tag, label: null, state: 'unresolved', source: 'line-up', status: 'active', by: 'x' });
    const s = buildSchematic({ id: 'L', ref: 'X', name: 'x', detail: null, items: [], requires: [], method: 'soak' }, { fixes, items: [item('HV-548B'), item('HV-546B')] });
    const r = renderSchematic(s, 'x', { compact: true });
    expect(r.issues).toEqual([]);
    for (const tag of ['P-203', 'E-203', 'E-216A', 'E-216B', 'E-229', 'HV-548B', 'HV-546B']) expect(r.svg).toContain(`>${tag}<`);
    expect(r.info.meta.find(([k]) => k === 'Layout')?.[1]).toMatch(/0 crossings/);
  });
});
