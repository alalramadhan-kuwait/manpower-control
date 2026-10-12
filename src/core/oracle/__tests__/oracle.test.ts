import { describe, expect, it } from 'vitest';
import { daysUntil, kuwaitToday, lapsedLeave, isPendingOracle, oracleCounts, oracleDue, type OracleLeave } from '..';

const l = (id: string, start: string, end: string, oracle: OracleLeave['oracle']): OracleLeave => ({ id, employeeId: id, start, end, oracle });
const today = '2026-09-25';

describe('Oracle HR tracking', () => {
  const leaves = [
    l('past', '2026-09-01', '2026-09-10', 'approved'),
    l('now', '2026-09-20', '2026-09-30', 'submitted'),
    l('soon', '2026-10-05', '2026-10-10', 'not_submitted'),
    l('rej', '2026-10-20', '2026-10-25', 'rejected'),
    l('ok', '2026-10-01', '2026-10-03', 'approved'),
    l('far', '2027-02-01', '2027-02-14', 'not_submitted')
  ];
  it('counts upcoming leave only', () => {
    expect(oracleCounts(leaves, today)).toEqual({ not_submitted: 2, submitted: 1, approved: 1, rejected: 1 });
  });
  it('due: not approved and starting within the window, rejected first', () => {
    expect(oracleDue(leaves, today, 30).map((x) => x.id)).toEqual(['rej', 'now', 'soon']);
    expect(oracleDue(leaves, today, 7).map((x) => x.id)).toEqual(['now']);
  });
  it('pending means not yet approved (and not rejected)', () => {
    expect(['not_submitted', 'submitted', 'approved', 'rejected'].map((s) => isPendingOracle(s as OracleLeave['oracle']))).toEqual([true, true, false, false]);
  });
  it('days until the first day', () => {
    expect([daysUntil(today, '2026-09-20'), daysUntil(today, '2026-09-25'), daysUntil(today, '2026-10-05')]).toEqual([0, 0, 10]);
  });
});

describe('lapsedLeave: leave that is not going ahead stops counting', () => {
  const pv = (oracle: 'not_submitted' | 'submitted' | 'approved' | 'rejected', start: string) => ({ typeCode: 'annual_leave_planned', oracle, start });
  it('rejected in Oracle never counts', () => { expect(lapsedLeave(pv('rejected', '2026-10-20'), '2026-10-12')).toBe(true); expect(lapsedLeave(pv('rejected', '2026-10-08'), '2026-10-12')).toBe(true); });
  it('not submitted counts until its first day, then stops', () => { expect(lapsedLeave(pv('not_submitted', '2026-10-12'), '2026-10-12')).toBe(false); expect(lapsedLeave(pv('not_submitted', '2026-10-08'), '2026-10-12')).toBe(true); });
  it('submitted or approved keeps counting; other types are not Oracle-tracked', () => {
    expect(lapsedLeave(pv('submitted', '2026-10-08'), '2026-10-12')).toBe(false);
    expect(lapsedLeave(pv('approved', '2026-10-08'), '2026-10-12')).toBe(false);
    expect(lapsedLeave({ typeCode: 'injury', oracle: 'not_submitted', start: '2026-10-01' }, '2026-10-12')).toBe(false);
  });
  it('Kuwait date', () => { expect(kuwaitToday(Date.parse('2026-10-12T21:30:00Z'))).toBe('2026-10-13'); });
});
