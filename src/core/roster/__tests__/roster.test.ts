import { describe, expect, it } from 'vitest';
import { dutiesOn, dutyFor, isOff, morningCrew } from '..';

describe('8-day roster engine', () => {
  it('anchor: 2 March 2026 = B Morning Day 1', () => {
    expect(dutyFor('2026-03-02', 'B')).toBe('M1');
    expect(dutiesOn('2026-03-02')).toEqual({ B: 'M1', D: 'A1', A: 'N1', C: 'Off1' });
  });
  it('known test: 23 September 2026 = A Shift Morning M2', () => {
    expect(dutyFor('2026-09-23', 'A')).toBe('M2');
    expect(morningCrew('2026-09-23')).toBe('A');
    expect(dutiesOn('2026-09-23')).toEqual({ A: 'M2', C: 'A2', B: 'N2', D: 'Off2' });
  });
  it('follows the confirmed Morning tables for each Morning crew', () => {
    expect(dutiesOn('2026-03-04')).toEqual({ C: 'M1', B: 'A1', D: 'N1', A: 'Off1' });
    expect(dutiesOn('2026-03-06')).toEqual({ A: 'M1', C: 'A1', B: 'N1', D: 'Off1' });
    expect(dutiesOn('2026-03-08')).toEqual({ D: 'M1', A: 'A1', C: 'N1', B: 'Off1' });
    expect(dutiesOn('2026-03-10')).toEqual({ B: 'M1', D: 'A1', A: 'N1', C: 'Off1' });
  });
  it('runs a full M M A A N N Off Off cycle for one crew', () => {
    const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'];
    expect(days.map((d) => dutyFor(d, 'B'))).toEqual(['M1', 'M2', 'A1', 'A2', 'N1', 'N2', 'Off1', 'Off2']);
  });
  it('works before the anchor (workbook SCHEDULE-2026: 1 Jan = A Morning)', () => {
    expect(dutyFor('2026-01-01', 'A')).toBe('M1');
    expect(dutyFor('2026-01-03', 'A')).toBe('A1');
  });
  it('isOff matches the workbook Off-crew row (Sept 2026: B Off on the 1st, C Off on the 2nd and 3rd)', () => {
    expect(isOff('2026-09-01', 'B')).toBe(true);
    expect(isOff('2026-09-02', 'C')).toBe(true);
    expect(isOff('2026-09-03', 'C')).toBe(true);
    expect(isOff('2026-09-02', 'B')).toBe(false);
  });
});
