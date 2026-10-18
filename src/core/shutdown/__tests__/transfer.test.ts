// Transfer between the crew rota (6 on / 2 off) and the shutdown cycle (3 on / 1 off): rule of 18 Oct 2026.
import { describe, expect, it } from 'vitest';
import { addDaysIso, type Crew } from '../../roster';
import type { MpPerson } from '../../manpower';
import { DEFAULT_RULES } from '../../validation';
import type { SdMember } from '..';
import { transitions } from '../v2';

const person = (crew: Crew): MpPerson => ({ id: 'p', employeeNumber: '1', name: 'P', role: 'field_operator', crew, grade: 12, employmentType: 'knpc', takeCharge: 'yes', panelQualified: null, actingController: null });
/** The member on the team from `start`, working the pattern (L = 12 h day duty, . = off) to `end`. */
function run(crew: Crew, start: string, pattern: string, extra: Partial<SdMember> = {}) {
  const end = addDaysIso(start, pattern.length - 1);
  const m: SdMember = { id: 'm', planId: 'x', teamId: 't', employeeId: 'p', slot: 'good', offset: 0, start, end, ...extra };
  const sd = (_e: string, d: string) => (d >= start && d <= end && pattern[Math.round((Date.parse(d) - Date.parse(start)) / 864e5)] === 'L' ? { code: 'SD-D' as const, start: '07:00', hours: 12 } : null);
  return transitions({ ...person(crew), moves: [{ start, end, crew: 'SD', kind: 'sd' }] }, m, sd, [], [], DEFAULT_RULES);
}

describe('transfer between the 6/2 rota and the 3/1 shutdown cycle', () => {
  // the B block runs 12-17 Oct 2026 (M M A A N N), rest 18-19; the A block 16-21 Oct; the D block 10-15 Oct, rest 16-17
  it('after a full 6-day block, 2 days off are due: joining the next day takes his 6th day off (5 days, then 1 off)', () => {
    const t = run('B', '2026-10-18', 'LLL.LLL.LLL.');
    expect(t.findings).toEqual([]);
    expect(t.joinOff).toEqual(['2026-10-17']);
  });
  it('after the crew\'s 2 rest days the cycle starts at once and the hours are even', () => {
    const t = run('D', '2026-10-18', 'LLL.LLL.LLL.');
    expect(t.joinOff).toEqual([]);
    expect(t.hours.join).toBe(0);
    expect(t.hours.fixes.filter((f) => f.side === 'join')).toEqual([]);
  });
  it('after 3 days of the block (+6 h): one shutdown duty given off is suggested (0 h after)', () => {
    const t = run('A', '2026-10-19', 'LLL.LLL.LLL.');
    expect(t.hours.join).toBe(6);
    expect(t.hours.fixes.find((f) => f.side === 'join')).toMatchObject({ fix: { kind: 'sd_day', date: '2026-10-19', works: false }, change: -8 });
  });
  it('2 days into the block (+4 h): within one day, nothing suggested', () => {
    const t = run('A', '2026-10-18', 'LLL.LLL.LLL.');
    expect(t.hours.join).toBe(4);
    expect(t.hours.fixes.filter((f) => f.side === 'join')).toEqual([]);
  });
  it('returning: the difference runs to the end of the crew\'s first rest pair; a shortfall of a day suggests working the last shutdown rest day', () => {
    // D: block 10-15 Nov, rest 16-17 Nov; the shutdown ends 15 Nov with a rest day on 14 Nov
    const t = run('D', '2026-10-28', 'LLL.LLL.LLL.LLL.LLL.' + 'LLL.LL.L');
    expect(t.hours.back).not.toBeNull();
    if ((t.hours.back ?? 0) <= -6) expect(t.hours.fixes.find((f) => f.side === 'back')?.fix).toMatchObject({ kind: 'sd_day', works: true });
    expect(t.findings).toEqual([]);
  });
  it('a recorded rest day counts: a full block cut to 5 days needs no second day', () => {
    const t = run('B', '2026-10-18', 'LLL.LLL.', { restDays: ['2026-10-17'] });
    expect(t.findings).toEqual([]);
    expect(t.joinOff).toEqual([]);
  });
});
