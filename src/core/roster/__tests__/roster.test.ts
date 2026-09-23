import { describe, expect, it } from 'vitest';
import { addDaysIso, crewsByShift, dutiesOn, dutyFor, dutyLabel, isOff, isValidIsoDate, isWorkingDay, morningCrew, validateRosterRange } from '..';

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

// Off crew for every day of 2026, read from the Off-crew row of each monthly sheet in
// "ARD's U-12 Manpower 2026.xlsx" (Jan..Dec, 365 letters). Independent source for the whole year.
const WORKBOOK_OFF_2026 =
  'DDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBCCAADDBBC';

describe('Stage B: roster validation for any date', () => {
  it('matches the workbook Off crew on all 365 days of 2026', () => {
    expect(WORKBOOK_OFF_2026).toHaveLength(365);
    const mismatches: string[] = [];
    let d = '2026-01-01';
    for (const expected of WORKBOOK_OFF_2026) {
      if (crewsByShift(d).Off !== expected) mismatches.push(`${d}: engine ${crewsByShift(d).Off}, workbook ${expected}`);
      d = addDaysIso(d, 1);
    }
    expect(mismatches).toEqual([]);
  });
  it('is internally consistent from 2020 to 2035 (one crew per shift, 1/2 alternation, M1→…→Off2→M1)', () => {
    expect(validateRosterRange('2020-01-01', '2035-12-31')).toEqual([]);
  });
  it('handles leap days and year boundaries', () => {
    expect(validateRosterRange('2027-12-25', '2028-03-05')).toEqual([]);
    expect(crewsByShift('2028-02-29')).toEqual(crewsByShift(addDaysIso('2028-02-29', 8 * 100)));
  });
  it('repeats every 8 days and never earlier', () => {
    for (const d of ['2024-07-15', '2026-09-23', '2031-02-01']) {
      expect(dutiesOn(addDaysIso(d, 8))).toEqual(dutiesOn(d));
      for (let k = 1; k < 8; k++) expect(dutiesOn(addDaysIso(d, k))).not.toEqual(dutiesOn(d));
    }
  });
  it('gives crews by shift for the known date 23 Sep 2026', () => {
    expect(crewsByShift('2026-09-23')).toEqual({ M: 'A', A: 'C', N: 'B', Off: 'D' });
    expect(dutyLabel(dutyFor('2026-09-23', 'A'))).toBe('Morning M2');
    expect(dutyLabel(dutyFor('2026-09-23', 'D'))).toBe('Off 2');
    expect(isWorkingDay('2026-09-23', 'A')).toBe(true);
    expect(isWorkingDay('2026-09-23', 'D')).toBe(false);
  });
  it('validates date input', () => {
    expect(isValidIsoDate('2026-09-23')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '2026-9-23', '23/09/2026', '', '2026-09-31']) expect(isValidIsoDate(bad)).toBe(false);
  });
});
