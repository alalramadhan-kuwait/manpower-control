import { describe, expect, it } from 'vitest';
import { FULL_OPERATION } from '../../manpower';
import { cyclesOf } from '../../pv';
import type { Crew } from '../../roster';
import { autoAssign, cellInfo, checkPlan, evaluateAllocation, fieldSlots, initialAllocation, panelSlots, prepare, type AllocRow, type Block, type PlanCtx, type PlanPerson } from '..';

let seq = 0;
const person = (crew: Crew | null, position: PlanPerson['position'], o: Partial<PlanPerson> = {}): PlanPerson => {
  seq++;
  return { id: `p${seq}`, name: `${position}-${crew ?? 'x'}-${seq}`, number: String(20000 + seq), grade: position === 'controller' || position === 'vr_controller' ? 16 : position === 'panel_operator' ? 14 : 12,
    position, employmentType: 'knpc', takeCharge: position === 'field_operator' ? 'yes' : null, panelQualified: position === 'panel_operator' || position === 'controller' ? 'yes' : null,
    actingController: null, dirCrew: crew, crew, dayDuty: false, placement: null, sick: { days: 2, asOf: '2026-10-01' }, ...o };
};
/** One shift: Controller, Panel (grades given), Field (count, grades 12). */
const shift = (crew: Crew, panel: number[] = [14, 14, 13, 13], field = 9) => [
  person(crew, 'controller'), ...panel.map((g) => person(crew, 'panel_operator', { grade: g })), ...Array.from({ length: field }, () => person(crew, 'field_operator'))
];
const unit = (over: Partial<Record<Crew, PlanPerson[]>> = {}) => [...(['A', 'B', 'C', 'D'] as Crew[]).flatMap((c) => over[c] ?? shift(c)), person(null, 'vr_controller', { placement: 'A' })];
const ctxOf = (people: PlanPerson[], blocks: Block[] = [], rows?: AllocRow[], extra: Partial<PlanCtx> = {}): PlanCtx => {
  const r = rows ?? initialAllocation(people);
  return { year: 2027, people, rows: r, alloc: evaluateAllocation(people, r), blocks, other: [], shutdowns: [], rules: FULL_OPERATION, ...extra };
};
const cyc = (crew: Crew, i: number) => cyclesOf(crew, 2027)[i];
const book = (id: string, crew: Crew, from: number, to = from, source: Block['source'] = 'manual'): Block => ({ employeeId: id, start: cyc(crew, from).start, end: cyc(crew, to).end, source });

describe('vacation slots', () => {
  it('Field: one per four counted, never below the minimum on duty', () => {
    expect([7, 8, 9, 10, 11, 12].map((n) => fieldSlots(n))).toEqual([1, 2, 2, 2, 2, 3]);
    expect(fieldSlots(6)).toBe(0);
    expect(fieldSlots(8, 7)).toBe(1);   // an operating mode with a higher minimum reduces it
  });
  it('Panel: a group of four gives one; three gives none', () => {
    expect([3, 4, 5, 8].map((n) => panelSlots(n))).toEqual([0, 1, 1, 2]);
  });
});

describe('manpower allocation', () => {
  it('a full shift: 1 Controller, Panel group of 4, Field 9 → slots 1 and 2, no blocking issue', () => {
    const u = unit(); const ev = evaluateAllocation(u, initialAllocation(u));
    const a = ev.crews.A;
    expect([a.controllers.length, a.panelGroup, a.fieldEligible.length, a.panelSlots, a.fieldSlots]).toEqual([1, 4, 9, 1, 2]);
    expect(ev.issues.filter((i) => i.level === 'error')).toEqual([]);
  });
  it('three Panel Operators: the Grade 13 Field Operator with the highest employee number acts; Field drops by one', () => {
    const d = shift('D', [14, 14, 13], 9);
    const g13a = person('D', 'field_operator', { grade: 13, number: '22854' });
    const g13b = person('D', 'field_operator', { grade: 13, number: '22872' });
    const people = unit({ D: [...d, g13a, g13b] });
    const ev = evaluateAllocation(people, initialAllocation(people));
    expect(ev.crews.D.acting.map((p) => p.number)).toEqual(['22872']);
    expect(ev.crews.D.panelGroup).toBe(4);
    expect(ev.crews.D.fieldEligible.length).toBe(10);
    expect(ev.crews.D.candidates.find((c) => c.person === g13a)?.state).toBe('eligible');
  });
  it('more than 30 sick days excludes from acting Panel; the next number is taken; unknown sick goes last with a warning', () => {
    const d = shift('D', [14, 14, 13], 8);
    const sick = person('D', 'field_operator', { grade: 13, number: '29999', sick: { days: 31, asOf: '2026-10-01' } });
    const ok = person('D', 'field_operator', { grade: 13, number: '21000' });
    const unknown = person('D', 'field_operator', { grade: 13, number: '28888', sick: null });
    const people = unit({ D: [...d, sick, ok, unknown] });
    const ev = evaluateAllocation(people, initialAllocation(people));
    expect(ev.crews.D.acting).toEqual([ok]);
    expect(ev.crews.D.candidates.find((c) => c.person === sick)?.state).toBe('sick');
    const noKnown = unit({ D: [...shift('D', [14, 14, 13], 8), unknown] });
    const ev2 = evaluateAllocation(noKnown, initialAllocation(noKnown));
    expect(ev2.crews.D.acting).toEqual([unknown]);
    expect(ev2.issues.some((i) => i.code === 'acting_sick_unknown')).toBe(true);
  });
  it('a qualified contractor Panel Operator counts in the Panel group; an unqualified one is an error', () => {
    const c = person('C', 'panel_operator', { employmentType: 'contractor', grade: null });
    const people = unit({ C: [...shift('C', [14, 14, 13]), c] });
    expect(evaluateAllocation(people, initialAllocation(people)).crews.C.panelGroup).toBe(4);
    const bad = { ...c, panelQualified: 'not_yet_confirmed' as const };
    const p2 = unit({ C: [...shift('C', [14, 14, 13], 9), bad] });
    const ev = evaluateAllocation(p2, initialAllocation(p2));
    expect(ev.issues.some((i) => i.code === 'panel_qualification' && i.level === 'error')).toBe(true);
  });
  it('Panel 3 of 4 is blocking without a floating relief, a warning with one', () => {
    const people = unit({ B: shift('B', [14, 14, 13], 9) });
    expect(evaluateAllocation(people, initialAllocation(people)).issues.find((i) => i.code === 'panel_group')?.level).toBe('error');
    const fl = person(null, 'panel_operator', { grade: 14 });
    const p2 = [...people, fl];
    const rows = initialAllocation(p2).map((r) => (r.employeeId === fl.id ? { ...r, group: 'relief' as const, crew: null, relief: 'float_panel' as const, cycleCrew: 'A' as const } : r));
    expect(evaluateAllocation(p2, rows).issues.find((i) => i.code === 'panel_group')?.level).toBe('warning');
  });
  it('moves, removal and duplicates: the snapshot decides, the person is never counted twice', () => {
    const people = unit();
    const f = people.find((p) => p.crew === 'A' && p.position === 'field_operator')!;
    const rows = initialAllocation(people).map((r) => (r.employeeId === f.id ? { ...r, crew: 'B' as const } : r));
    const ev = evaluateAllocation(people, rows);
    expect([ev.crews.A.fieldEligible.length, ev.crews.B.fieldEligible.length]).toEqual([8, 10]);
    const removed = rows.map((r) => (r.employeeId === f.id ? { ...r, group: 'excluded' as const, crew: null } : r));
    expect(evaluateAllocation(people, removed).crews.B.fieldEligible.length).toBe(9);
    expect(evaluateAllocation(people, [...rows, rows[0]]).issues.some((i) => i.code === 'duplicate')).toBe(true);
  });
  it('day duty starts in Relief; a temporary move in the history wins over the directory shift (with a warning)', () => {
    const dd = person('C', 'field_operator', { dayDuty: true });
    const moved = person('C', 'field_operator', { crew: 'D' });
    const people = unit({ C: [...shift('C'), dd], D: [...shift('D'), moved] });
    const rows = initialAllocation(people);
    expect(rows.find((r) => r.employeeId === dd.id)).toMatchObject({ group: 'relief', relief: 'day_duty', cycleCrew: 'C' });
    const ev = evaluateAllocation(people, rows);
    expect(ev.crews.D.fieldEligible).toContain(moved);
    expect(ev.issues.some((i) => i.code === 'crew_mismatch' && i.employeeId === moved.id)).toBe(true);
  });
  it('a missing grade on a company employee is a warning, the floating relief without a rota is an error', () => {
    const ng = person('A', 'field_operator', { grade: null });
    const people = unit({ A: [...shift('A'), ng] });
    const ev = evaluateAllocation(people, initialAllocation(people));
    expect(ev.issues.some((i) => i.code === 'no_grade' && i.employeeId === ng.id)).toBe(true);
    const vr = people.find((p) => p.position === 'vr_controller')!;
    const rows = initialAllocation(people).map((r) => (r.employeeId === vr.id ? { ...r, cycleCrew: null } : r));
    expect(evaluateAllocation(people, rows).issues.some((i) => i.code === 'relief_rota' && i.level === 'error')).toBe(true);
  });
});

describe('vacation periods', () => {
  const people = unit();
  const fieldA = people.filter((p) => p.crew === 'A' && p.position === 'field_operator');
  const panelA = people.filter((p) => p.crew === 'A' && p.position === 'panel_operator');
  const ctl = people.filter((p) => p.position === 'controller');
  it('whole cycles only; consecutive cycles are one period', () => {
    const half = { employeeId: fieldA[0].id, start: cyc('A', 3).start, end: cyc('A', 3).end.replace(/\d\d$/, (d) => String(Number(d) - 1).padStart(2, '0')), source: 'manual' as const };
    expect(checkPlan(ctxOf(people, [half]), { coverage: false }).issues.some((i) => i.code === 'partial')).toBe(true);
    const r = checkPlan(ctxOf(people, [book(fieldA[0].id, 'A', 3, 4), book(fieldA[0].id, 'A', 10)]), { coverage: false });
    expect(r.persons.get(fieldA[0].id)?.periods).toEqual([[3, 4], [10, 10]]);
  });
  it('four to five periods: fewer is a warning in the draft and blocking at approval; six is blocking', () => {
    const three = [0, 10, 20].map((i) => book(fieldA[1].id, 'A', i));
    expect(checkPlan(ctxOf(people, three), { coverage: false }).issues.find((i) => i.code === 'missing' && i.employeeIds[0] === fieldA[1].id)?.level).toBe('warning');
    expect(checkPlan(ctxOf(people, three), { final: true, coverage: false }).issues.find((i) => i.code === 'missing' && i.employeeIds[0] === fieldA[1].id)?.level).toBe('error');
    const six = [0, 6, 12, 18, 24, 30].map((i) => book(fieldA[1].id, 'A', i));
    expect(checkPlan(ctxOf(people, six), { coverage: false }).issues.some((i) => i.code === 'over')).toBe(true);
  });
  it('Field: a third person in a cycle with two slots is full; Panel: a second is full', () => {
    const pr = prepare(ctxOf(people, [book(fieldA[0].id, 'A', 5), book(fieldA[1].id, 'A', 5), book(panelA[0].id, 'A', 5)]));
    expect(cellInfo(pr, fieldA[2].id, 5).state).toBe('full');
    expect(cellInfo(pr, fieldA[2].id, 6).state).toBe('available');
    expect(cellInfo(pr, panelA[1].id, 5).state).toBe('full');
  });
  it('Controllers: one off at a time across the unit, also between shifts', () => {
    const a = ctl.find((p) => p.crew === 'A')!, b = ctl.find((p) => p.crew === 'B')!;
    const pr = prepare(ctxOf(people, [book(a.id, 'A', 8)]));
    const clash = cyclesOf('B', 2027).find((c) => c.start <= cyc('A', 8).end && cyc('A', 8).start <= c.end)!;
    expect(cellInfo(pr, b.id, clash.index).state).toBe('full');
    const clear = cyclesOf('B', 2027).find((c) => c.start > cyc('A', 8).end)!;
    expect(cellInfo(pr, b.id, clear.index).state).toBe('available');
  });
  it('summer: one period of two cycles at the longest', () => {
    const s = cyclesOf('A', 2027).filter((c) => c.summer);
    const pr = prepare(ctxOf(people, [book(fieldA[0].id, 'A', s[0].index, s[1].index)]));
    expect(cellInfo(pr, fieldA[0].id, s[2].index).state).toBe('restricted');
    expect(cellInfo(pr, fieldA[0].id, s[6].index).state).toBe('restricted');
  });
  it('confirmed shutdown team dates and other leave are restricted', () => {
    const c = cyc('A', 12);
    const pr = prepare(ctxOf(people, [], undefined, { shutdowns: [{ employeeId: fieldA[0].id, start: c.start, end: c.end, title: 'Train-1 SD' }],
      other: [{ id: 'x', employeeId: fieldA[1].id, start: c.start, end: c.start, status: 'approved', typeCode: 'sick_leave', typeLabel: 'Sick', inCurrentPlan: true }] }));
    expect(cellInfo(pr, fieldA[0].id, 12)).toMatchObject({ state: 'restricted' });
    expect(cellInfo(pr, fieldA[1].id, 12)).toMatchObject({ state: 'restricted' });
  });
  it('the engine catches a crew minimum the slots alone allow: the only Grade 14 off leaves Panel without a Grade 14', () => {
    const one14 = unit({ A: shift('A', [14, 13, 13, 13]) });
    const pa = one14.filter((p) => p.crew === 'A' && p.position === 'panel_operator');
    const pr = prepare(ctxOf(one14));
    expect(cellInfo(pr, pa[0].id, 4).state).toBe('conflict');
    expect(cellInfo(pr, pa[1].id, 4).state).toBe('available');
  });
  it('the floating Panel relief covers one shift at a time', () => {
    const fl = person(null, 'panel_operator', { grade: 14 });
    const ppl = [...unit({ A: shift('A', [14, 14, 13]), B: shift('B', [14, 14, 13]) }), fl];
    const rows = initialAllocation(ppl).map((r) => (r.employeeId === fl.id ? { ...r, group: 'relief' as const, crew: null, relief: 'float_panel' as const, cycleCrew: 'C' as const } : r));
    const pa = ppl.filter((p) => p.crew === 'A' && p.position === 'panel_operator')[0];
    const pb = ppl.filter((p) => p.crew === 'B' && p.position === 'panel_operator')[0];
    // A and B work on the same dates in 2027 cycles that overlap: the float covers A, B is then short
    const ca = cyc('A', 6); const cb = cyclesOf('B', 2027).find((c) => c.start <= ca.end && ca.start <= c.end)!;
    const ctx = ctxOf(ppl, [book(pa.id, 'A', 6)], rows);
    ctx.alloc.crews.A.panelSlots = 1; ctx.alloc.crews.B.panelSlots = 1;   // slots by hand: the engine decides here
    expect(cellInfo(prepare(ctx), pb.id, cb.index).state).toBe('conflict');
    const alone = ctxOf(ppl, [], rows); alone.alloc.crews.A.panelSlots = 1;
    expect(cellInfo(prepare(alone), pa.id, 6).state).toBe('available');
  });
});

describe('automatic fourth period', () => {
  it('adds the missing periods as System, never moves a chosen one, and reports when nothing fits', () => {
    const people = unit();
    const f = people.find((p) => p.crew === 'C' && p.position === 'field_operator')!;
    const mine = [3, 15, 27].map((i) => book(f.id, 'C', i));
    const ctx = ctxOf(people, mine);
    const r = autoAssign(ctx, new Set([f.id]));
    expect(r.blocks.filter((b) => b.employeeId === f.id)).toHaveLength(1);
    expect(r.blocks[0].source).toBe('system');
    const after = checkPlan({ ...ctx, blocks: [...mine, ...r.blocks] }, { coverage: false });
    expect(after.persons.get(f.id)?.periods.length).toBe(4);
    expect(after.persons.get(f.id)?.systemPeriods).toBe(1);
    // no slot at all: a Field of 6 has no vacation capacity → an exception, nothing invented
    const small = unit({ D: shift('D', [14, 14, 13, 13], 6) });
    const fd = small.find((p) => p.crew === 'D' && p.position === 'field_operator')!;
    const r2 = autoAssign(ctxOf(small), new Set([fd.id]));
    expect(r2.blocks).toEqual([]);
    expect(r2.exceptions[0].employeeId).toBe(fd.id);
  });
});

describe('Day Supervisor rotation', () => {
  it('six two-month turns; agreed turns kept; empty ones shared fairly', async () => {
    const { dayTurns, proposeDayRotation } = await import('../day');
    expect(dayTurns(2027).map((t) => `${t.start}..${t.end}`)).toEqual(['2027-01-01..2027-02-28', '2027-03-01..2027-04-30', '2027-05-01..2027-06-30', '2027-07-01..2027-08-31', '2027-09-01..2027-10-31', '2027-11-01..2027-12-31']);
    const c = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase(), morningDays: 0 }));
    const r = proposeDayRotation(2027, [{ employeeId: 'c', start: '2027-01-01', end: '2027-02-28', source: 'agreed' }], c);
    expect(r[0]).toMatchObject({ employeeId: 'c', source: 'agreed' });
    expect(r.map((t) => t.employeeId)).toEqual(['c', 'a', 'b', 'a', 'b', 'c']);
    expect(r.slice(1).every((t) => t.source === 'proposed')).toBe(true);
  });
});

describe('sick-leave Excel (rolling 12 months)', () => {
  it('finds the header, checks IDs, matches by linked Civil ID, then by name; duplicates and bad IDs are refused', async () => {
    const { readSickSheet, matchSickRows } = await import('../sickImport');
    const m = readSickSheet([['Sick leave report'], ['Employee Name', 'Civil ID', 'Total sick days (12 months)'],
      ['Ali Hassan Saleh', '290010112345', 4], ['Omar Fahad', '285050512345', 33], ['Ali Hassan Saleh', '290010112345', 4], ['Nobody Here', '280000000001', 1], ['Short', '1234', 2], ['Sara K', '', 1]]);
    expect(m.columns).toEqual({ name: 0, civil: 1, days: 2 });
    expect(m.rows).toHaveLength(6);
    const staff = [{ id: 'e1', names: ['Ali Hassan Saleh Alfoo'] }, { id: 'e2', names: ['Omar Fahad'] }];
    const r = matchSickRows([m.rows[1], m.rows[3], m.rows[4], m.rows[5]], ['h2', 'h4', 'h5', 'h6'], new Map([['h4', 'e9']]), staff);
    expect(r.map((x) => [x.kind, x.employeeId, x.error])).toEqual([['name', 'e2', null], ['civil', 'e9', null], ['none', null, 'Civil ID has 4 digits (12 expected)'], ['none', null, 'No Civil ID']]);
    const dup = matchSickRows([m.rows[0], m.rows[2]], ['h1', 'h1'], new Map(), staff);
    expect(dup.every((x) => x.error === 'Civil ID appears twice in the file')).toBe(true);
    const partial = matchSickRows([m.rows[0]], ['h1'], new Map(), [{ id: 'e1', names: ['Ali Hassan Saleh Alfoo'] }]);
    expect(partial[0]).toMatchObject({ kind: 'name_partial', employeeId: 'e1' });
  });
});
