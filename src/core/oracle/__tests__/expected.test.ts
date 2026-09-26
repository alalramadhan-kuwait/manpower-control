import { describe, expect, it } from 'vitest';
import { expectedRequest, matchesPlan, oracleDays } from '../expected';

const B = () => 'B' as const;
describe('expected Oracle request', () => {
  it('Ashkanani (B Shift): plan 26 Sep – 19 Oct = request 26 Sep – 17 Oct, 19 days, back Tue 20 Oct', () => {
    expect(expectedRequest('2026-09-26', '2026-10-19', B)).toEqual({ start: '2026-09-26', end: '2026-10-17', days: 19, restBefore: 0, restAfter: 2, backOn: '2026-10-20' });
  });
  it('Oracle counts the days without Fridays', () => {
    expect(oracleDays('2026-09-26', '2026-10-17')).toBe(19);
  });
  it('a request typed from EasyHR matches the plan when only rest days differ', () => {
    expect(matchesPlan({ start: '2026-09-26', end: '2026-10-17' }, { start: '2026-09-26', end: '2026-10-19' }, B)).toBe(true);
    expect(matchesPlan({ start: '2026-09-26', end: '2026-10-21' }, { start: '2026-09-26', end: '2026-10-19' }, B)).toBe(false);
  });
  it('rest days at the start are left out too; day staff rest on Friday and Saturday', () => {
    expect(expectedRequest('2026-09-24', '2026-09-30', B)!.start).toBe('2026-09-26');          // 24–25 Sep: B Off
    expect(expectedRequest('2026-10-02', '2026-10-10', () => null)).toMatchObject({ start: '2026-10-04', end: '2026-10-08', backOn: '2026-10-11' });
  });
  it('a plan of rest days only needs no request', () => {
    expect(expectedRequest('2026-10-18', '2026-10-19', B)).toBeNull();
  });
});
