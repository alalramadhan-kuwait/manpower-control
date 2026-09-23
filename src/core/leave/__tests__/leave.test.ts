import { describe, expect, it } from 'vitest';
import { firstDayBack, onLeaveOn, type LeaveSpan } from '..';
import { isWorkingDay } from '../../roster';

const L = (employeeId: string, start: string, end: string, over: Partial<LeaveSpan> = {}): LeaveSpan =>
  ({ employeeId, start, end, status: 'approved', inCurrentPlan: true, typeLabel: 'Planned Annual Leave', typeShort: 'PV', ...over });

describe('onLeaveOn', () => {
  it('finds people whose leave covers the day, including first and last day', () => {
    const m = onLeaveOn('2026-09-23', [L('a', '2026-09-20', '2026-09-23'), L('b', '2026-09-23', '2026-09-30'), L('c', '2026-09-24', '2026-09-30')]);
    expect([...m.keys()].sort()).toEqual(['a', 'b']);
    expect(m.get('b')).toMatchObject({ start: '2026-09-23', until: '2026-09-30', returnOn: '2026-10-01', typeShort: 'PV' });
  });
  it('joins back-to-back records into one run for the return date', () => {
    const m = onLeaveOn('2026-09-23', [L('a', '2026-09-15', '2026-09-25'), L('a', '2026-09-26', '2026-10-02', { typeLabel: 'Leave extension' }), L('a', '2026-10-10', '2026-10-12')]);
    expect(m.get('a')).toMatchObject({ start: '2026-09-15', until: '2026-10-02', returnOn: '2026-10-03' });
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

describe('return date = first day available to work', () => {
  it('skips the crew Off days that follow the leave', () => {
    // whatever days follow the leave, the return date is A's next duty day and every day skipped is an Off day
    const lastDay = '2026-09-24';
    const back = firstDayBack(lastDay, 'A', () => false);
    expect(isWorkingDay(back, 'A')).toBe(true);
    for (let d = '2026-09-25'; d < back; d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10)) expect(isWorkingDay(d, 'A')).toBe(false);
  });
  it('skips a later absence that starts right after the Off days', () => {
    const offAfter = (() => { let d = '2026-09-24'; while (isWorkingDay(d, 'D')) d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10); return d; })();
    const lastDay = new Date(Date.parse(offAfter) - 864e5).toISOString().slice(0, 10); // leave ends the day before D's Off days
    const firstDuty = firstDayBack(lastDay, 'D', () => false);
    const withCourse = firstDayBack(lastDay, 'D', (d) => d === firstDuty);
    expect(withCourse > firstDuty).toBe(true);
    expect(isWorkingDay(withCourse, 'D')).toBe(true);
  });
  it('day staff (no crew) return the next free day', () => {
    expect(firstDayBack('2026-09-24', null, () => false)).toBe('2026-09-25');
  });
  it('uses the crew for the return date in onLeaveOn', () => {
    const m = onLeaveOn('2026-09-23', [L('a', '2026-09-20', '2026-09-24')], () => 'A');
    expect(isWorkingDay(m.get('a')!.returnOn, 'A')).toBe(true);
    expect(m.get('a')!.returnOn > '2026-09-24').toBe(true);
  });
});
