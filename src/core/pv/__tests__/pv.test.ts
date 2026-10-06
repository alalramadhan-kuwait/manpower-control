import { describe, expect, it } from 'vitest';
import { dutyFor } from '../../roster';
import { checkPv, cyclesOf, panelFill, runsOf, type PvPerson, type PvShift } from '..';

const p = (id: string, role: PvPerson['role'], o: Partial<PvPerson> = {}): PvPerson => ({ id, name: id, number: id, crew: 'A', role, grade: null, gradeSince: null, sick: 0, ...o });

describe('cyclesOf', () => {
  it('starts every cycle on M1 and runs 8 days', () => {
    const c = cyclesOf('B', 2027);
    expect(c.length).toBeGreaterThanOrEqual(45);
    for (const x of c) { expect(dutyFor(x.start, 'B')).toBe('M1'); expect(dutyFor(x.end, 'B')).toBe('Off2'); expect(x.start.startsWith('2027')).toBe(true); }
    expect(c[1].start > c[0].start).toBe(true);
  });
  it('marks June to September as summer', () => {
    const c = cyclesOf('A', 2027);
    expect(c.some((x) => x.summer)).toBe(true);
    for (const x of c) expect(x.summer).toBe(Number(x.start.slice(5, 7)) >= 6 && Number(x.start.slice(5, 7)) <= 9);
  });
});

describe('runsOf', () => {
  it('joins consecutive cycles', () => expect(runsOf([9, 3, 5, 4])).toEqual([[3, 5], [9, 9]]));
});

describe('panelFill', () => {
  it('fills to four seats with Grade 13 Field Operators: longest in grade, then least sick leave', () => {
    const shift = [p('po1', 'panel_operator', { grade: 14 }), p('po2', 'panel_operator', { grade: 14 }),
      p('f1', 'field_operator', { grade: 13, gradeSince: '2020-01-01', sick: 9 }), p('f2', 'field_operator', { grade: 13, gradeSince: '2018-01-01', sick: 30 }),
      p('f3', 'field_operator', { grade: 13, gradeSince: '2018-01-01', sick: 4 }), p('f4', 'field_operator', { grade: 12, gradeSince: '2010-01-01' })];
    const r = panelFill(shift);
    expect(r.acting.map((x) => x.id)).toEqual(['f3', 'f2']);   // same year in grade: f3 has less sick leave
    expect(r.short).toBe(0);
  });
  it('reports seats it cannot fill', () => {
    const r = panelFill([p('po1', 'panel_operator', { grade: 14 }), p('f1', 'field_operator', { grade: 13 })]);
    expect(r.acting).toHaveLength(1); expect(r.short).toBe(2);
  });
});

describe('checkPv', () => {
  const A = cyclesOf('A', 2027), B = cyclesOf('B', 2027);
  const names = new Map<string, string>();
  const shift = (crew: 'A' | 'B', cycles: typeof A, o: Partial<PvShift>): PvShift => ({ crew, cycles, controllers: [], panel: [], field: [], ...o });
  it('flags two Controllers off together across shifts', () => {
    const picks = new Map([['ca', new Set([10])], ['cb', new Set([10])]]);
    const out = checkPv({ shifts: [shift('A', A, { controllers: ['ca'] }), shift('B', B, { controllers: ['cb'] })], picks, names });
    expect(out.some((i) => i.kind === 'controller_overlap')).toBe(true);
  });
  it('lets Controllers take different cycles', () => {
    const picks = new Map([['ca', new Set([10])], ['cb', new Set([20])]]);
    expect(checkPv({ shifts: [shift('A', A, { controllers: ['ca'] }), shift('B', B, { controllers: ['cb'] })], picks, names }).filter((i) => i.kind === 'controller_overlap')).toHaveLength(0);
  });
  it('allows one Panel Operator off at a time and two Field Operators', () => {
    const s = shift('A', A, { panel: ['p1', 'p2', 'p3', 'p4'], field: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'] });
    expect(checkPv({ shifts: [s], picks: new Map([['p1', new Set([5])], ['f1', new Set([5])], ['f2', new Set([5])]]), names })).toHaveLength(0);
    const two = checkPv({ shifts: [s], picks: new Map([['p1', new Set([5])], ['p2', new Set([5])]]), names });
    expect(two.map((i) => i.kind)).toContain('panel_cap');
    const three = checkPv({ shifts: [s], picks: new Map([['f1', new Set([5])], ['f2', new Set([5])], ['f3', new Set([5])]]), names });
    expect(three.map((i) => i.kind)).toContain('field_cap');
  });
  it('limits summer to one leave of two cycles', () => {
    const s = shift('A', A, { field: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'] });
    const sum = A.filter((c) => c.summer).map((c) => c.index);
    expect(checkPv({ shifts: [s], picks: new Map([['f1', new Set(sum.slice(0, 2))]]), names })).toHaveLength(0);
    expect(checkPv({ shifts: [s], picks: new Map([['f1', new Set(sum.slice(0, 3))]]), names }).map((i) => i.kind)).toContain('summer');
    expect(checkPv({ shifts: [s], picks: new Map([['f1', new Set([sum[0], sum[3]])]]), names }).map((i) => i.kind)).toContain('summer');
  });
  it('flags leave on a shutdown team', () => {
    const s = shift('A', A, { field: ['f1'] });
    const out = checkPv({ shifts: [s], picks: new Map([['f1', new Set([4])]]), shutdowns: [{ employeeId: 'f1', start: A[4].start, end: A[4].end, title: 'SD' }], names });
    expect(out.map((i) => i.kind)).toContain('shutdown');
  });
});
