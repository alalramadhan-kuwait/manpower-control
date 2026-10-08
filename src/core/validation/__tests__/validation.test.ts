import { describe, expect, it } from 'vitest';
import type { MpAbsence, MpPerson } from '@/core/manpower';
import { addDaysIso, CREWS, dutyFor, stateOf, type Crew } from '@/core/roster';
import { DEFAULT_RULES, checkSchedule, kuwaitMs, personDays, validateProposal, type RuleConfig } from '..';

const person = (crew: Crew, id = 'p1'): MpPerson => ({ id, employeeNumber: '1', name: 'Test', role: 'field_operator', crew, grade: 13, employmentType: 'knpc', takeCharge: null, panelQualified: null, actingController: null });
const base = (p: MpPerson, absences: MpAbsence[] = []) => ({ people: [p], absences, assignments: [] });

describe('duty times', () => {
  it('uses the real shift times (Kuwait, UTC+3)', () => {
    expect(new Date(kuwaitMs('2026-10-06', '07:00')).toISOString()).toBe('2026-10-06T04:00:00.000Z');
    const days = personDays(person('A'), '2026-10-01', '2026-10-08', { absences: [], assignments: [] });
    const n = days.find((d) => d.duty.code === 'N')!;
    expect(n.duty.end! - n.duty.start!).toBe(8 * 3600_000);
    expect(new Date(n.duty.start!).toISOString().slice(11, 16)).toBe('20:00'); // 23:00 Kuwait
  });
  it('the normal rota never breaks the rules: at most 6 duty days in a row, rest above 0', () => {
    for (const c of CREWS) expect(checkSchedule(personDays(person(c), '2026-01-01', '2026-12-31', { absences: [], assignments: [] }), DEFAULT_RULES)).toEqual([]);
  });
});

describe('a temporary move', () => {
  it('that makes the 7th duty day in a row is a hard stop', () => {
    // A → C from 6 Oct: the example where a move gives 12 duty days in a row
    const v = validateProposal(base(person('A')), { kind: 'move', employeeId: 'p1', start: '2026-10-06', end: '2026-10-20', crew: 'C', moveKind: 'temporary' }, DEFAULT_RULES);
    const f = v.findings.find((x) => x.rule === 'max_consecutive_duty_days');
    expect(f?.severity).toBe('hard_stop');
    expect(v.worst).toBe('hard_stop');
  });
  it('from a Night straight into a Morning is no rest: hard stop, with the hours', () => {
    // a day d where A works Night and some crew works Morning on d+1
    let d = '2026-10-01', to: Crew | undefined;
    for (; !to; d = addDaysIso(d, 1)) { if (stateOf(dutyFor(d, 'A')) === 'N') to = CREWS.find((c) => stateOf(dutyFor(addDaysIso(d, 1), c)) === 'M'); if (to) break; }
    const v = validateProposal(base(person('A')), { kind: 'move', employeeId: 'p1', start: addDaysIso(d, 1), end: addDaysIso(d, 3), crew: to!, moveKind: 'temporary' }, DEFAULT_RULES);
    const rest = v.findings.find((x) => x.rule === 'rest_between_duties');
    expect(rest?.severity).toBe('hard_stop');
    expect(rest?.hours).toBe(0);
  });
  it('a minimum rest, once configured, flags short rests at its own severity', () => {
    const rules: RuleConfig[] = DEFAULT_RULES.map((r) => (r.code === 'min_rest_hours' ? { ...r, enabled: true, params: { hours: 30 } } : r));
    expect(checkSchedule(personDays(person('A'), '2026-10-01', '2026-10-16', { absences: [], assignments: [] }), rules).every((f) => f.rule === 'min_rest_hours' && f.severity === 'warning')).toBe(true);
  });
});

describe('leave', () => {
  const pv: MpAbsence = { id: 'l1', employeeId: 'p1', start: '2026-11-15', end: '2026-11-20', status: 'approved', typeCode: 'annual_leave_planned', typeShort: 'PV', inCurrentPlan: true };
  it('on top of other leave is critical (sick leave during PV may be approved)', () => {
    const v = validateProposal(base(person('A'), [pv]), { kind: 'absence', employeeId: 'p1', start: '2026-11-18', end: '2026-11-22', typeCode: 'sick_leave', typeShort: 'SL' }, DEFAULT_RULES);
    expect(v.findings.find((f) => f.rule === 'leave_overlap')?.severity).toBe('critical');
  });
  it('a reschedule does not clash with the leave it replaces; the timeline marks the changed days', () => {
    const v = validateProposal(base(person('A'), [pv]), { kind: 'reschedule', employeeId: 'p1', recordIds: ['l1'], start: '2026-11-23', end: '2026-11-28', typeCode: 'annual_leave_planned', typeShort: 'PV' }, DEFAULT_RULES);
    expect(v.findings).toEqual([]);
    expect(v.timeline[0].date).toBe('2026-11-16');
    expect(v.timeline.find((r) => r.date === '2026-11-23')).toMatchObject({ other: 'PV starts', changed: true });
    expect(v.timeline.find((r) => r.date === '2026-11-17')?.changed).toBe(true); // no longer on PV
  });
});
