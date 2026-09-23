import { describe, expect, it } from 'vitest';
import { onLeaveOn, type LeaveSpan } from '..';

const L = (employeeId: string, start: string, end: string, over: Partial<LeaveSpan> = {}): LeaveSpan =>
  ({ employeeId, start, end, status: 'approved', inCurrentPlan: true, typeLabel: 'Planned Annual Leave', ...over });

describe('onLeaveOn', () => {
  it('finds people whose leave covers the day, including first and last day', () => {
    const m = onLeaveOn('2026-09-23', [L('a', '2026-09-20', '2026-09-23'), L('b', '2026-09-23', '2026-09-30'), L('c', '2026-09-24', '2026-09-30')]);
    expect([...m.keys()].sort()).toEqual(['a', 'b']);
    expect(m.get('b')).toEqual({ start: '2026-09-23', until: '2026-09-30', typeLabel: 'Planned Annual Leave' });
  });
  it('joins back-to-back records into one run for the return date', () => {
    const m = onLeaveOn('2026-09-23', [L('a', '2026-09-15', '2026-09-25'), L('a', '2026-09-26', '2026-10-02', { typeLabel: 'Leave extension' }), L('a', '2026-10-10', '2026-10-12')]);
    expect(m.get('a')).toMatchObject({ start: '2026-09-15', until: '2026-10-02' });
  });
  it('ignores leave that does not count: rescheduled, cancelled, unresolved or out of the current plan', () => {
    const m = onLeaveOn('2026-09-23', [
      L('a', '2026-09-20', '2026-09-30', { status: 'rescheduled', inCurrentPlan: false }),
      L('b', '2026-09-20', '2026-09-30', { status: 'cancelled' }),
      L('c', '2026-09-20', '2026-09-30', { status: 'unresolved' }),
      L('d', '2026-09-20', '2026-09-30', { inCurrentPlan: false })
    ]);
    expect(m.size).toBe(0);
  });
});
