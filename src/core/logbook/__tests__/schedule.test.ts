// Made-up schedule and samples only.
import { describe, expect, it } from 'vitest';
import type { StoredSample } from '../view';
import { dueFor, lastDue, overdueByPoint, scheduleStatus, type ScheduleItem } from '../schedule';

const kw = (s: string) => new Date(`${s}:00+03:00`);                        // Kuwait time
describe('lastDue', () => {
  it('daily: 07:00, counted late from 19:00', () => {
    expect(lastDue('daily', kw('2030-03-06T18:59')).toISOString()).toBe(kw('2030-03-05T07:00').toISOString());
    expect(lastDue('daily', kw('2030-03-06T19:00')).toISOString()).toBe(kw('2030-03-06T07:00').toISOString());
  });
  it('weekly: Sunday 07:00, counted late from Monday 19:00', () => {
    // 2030-03-03 is a Sunday
    expect(lastDue('weekly_sun', kw('2030-03-04T18:00')).toISOString()).toBe(kw('2030-02-24T07:00').toISOString());
    expect(lastDue('weekly_sun', kw('2030-03-06T10:00')).toISOString()).toBe(kw('2030-03-03T07:00').toISOString());
  });
});

describe('scheduleStatus', () => {
  const items: ScheduleItem[] = [
    { id: 1, point: 'Light cut T-904', material: 'LIGHT CUT', equipment: 'T-904', test: 'Colour', components: ['Colour, X'], frequency: 'daily' },
    { id: 2, point: 'Light cut T-904', material: 'LIGHT CUT', equipment: 'T-904', test: 'Gravity', components: ['Gravity'], frequency: 'daily' },
    { id: 3, point: 'Water V-990', material: 'WATER', equipment: 'V-990', test: 'pH', components: ['pH', 'PH value'], frequency: 'weekly_sun' },
  ];
  const S = (id: string, mat: string, eq: string, at: string, res: [string, string][]): StoredSample => ({ sampleId: id, material: mat, equipment: eq, collectedAt: kw(at).toISOString(), note: null, results: res.map(([component, value]) => ({ component, value, unit: null })) });
  const lab = [S('a', 'LIGHT CUT', 'T-904', '2030-03-06T07:00', [['Gravity', '60.1']]), S('b', 'LIGHT CUT', 'T-904', '2030-03-04T07:00', [['Colour, X', '+25']]),
    S('c', 'WATER', 'V-990', '2030-03-03T09:30', [['PH value', '8.4']]), S('d', 'LIGHT CUT', 'T-904', '2030-03-07T07:00', [['Colour, X', '+26']])];
  it('marks a test late when no result since its due day', () => {
    const st = scheduleStatus(lab, items, kw('2030-03-06T20:00'));
    expect(st.map((d) => [d.item.test, d.overdue, d.value])).toEqual([['Colour', true, '+25'], ['Gravity', false, '60.1'], ['pH', false, '8.4']]);
    expect(overdueByPoint(st)).toEqual([{ point: 'Light cut T-904', tests: ['Colour'], last: '4 Mar' }]);
    expect(dueFor(st, 'light cut', 'T-904', 'Colour, X')?.overdue).toBe(true);
    expect(dueFor(st, 'LIGHT CUT', 'T-904', 'Other')).toBeUndefined();
  });
  it('ignores samples after the moment looked at, and a week without the weekly test is late', () => {
    const st = scheduleStatus(lab, items, kw('2030-03-11T18:00'));
    expect(st.find((d) => d.item.test === 'pH')?.overdue).toBe(false);          // the 10th's sample not yet late (Monday 19:00)
    expect(scheduleStatus(lab, items, kw('2030-03-11T19:00')).find((d) => d.item.test === 'pH')?.overdue).toBe(true);
    expect(scheduleStatus(lab, items, kw('2030-03-06T20:00')).find((d) => d.item.test === 'Colour')?.last).not.toContain('03-07');
  });
});
