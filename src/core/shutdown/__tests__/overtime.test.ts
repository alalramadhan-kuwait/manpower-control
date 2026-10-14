import { describe, expect, it } from 'vitest';
import { addDaysIso, dutyFor, type Crew } from '../../roster';
import { kuwaitMs } from '../../validation';
import { cycleOvertime, cycleStart, weekStart, type WorkedDuty } from '../overtime';
import { personOvertime, type DutyOt } from '../v2';
import type { SdPlan } from '..';

const H = 3600_000;
const duty = (date: string, hours: number, at = '07:00'): WorkedDuty => ({ date, start: kuwaitMs(date, at), hours });
/** The first M1 of crew `c` on or after `d`. */
const m1From = (c: Crew, d: string) => { let x = d; while (dutyFor(x, c) !== 'M1') x = addDaysIso(x, 1); return x; };
const basis = (from: string, to: string, crew: Crew | null, leave: string[] = []) => ({ from, to, crewOn: () => crew, leaveOn: (d: string) => leave.includes(d), normalHours: 8 });

describe('overtime per 8-day duty cycle (48 regular hours)', () => {
  const c = m1From('A', '2026-11-01');
  const cyc = Array.from({ length: 8 }, (_, i) => addDaysIso(c, i));

  it('the rota: M M A A N N Off Off, starting on M1', () => {
    expect(cyc.map((d) => dutyFor(d, 'A'))).toEqual(['M1', 'M2', 'A1', 'A2', 'N1', 'N2', 'Off1', 'Off2']);
    expect(cycleStart('A', cyc[5])).toBe(c);
  });
  it('normal duty: 6 × 8 h = 48 h, no overtime', () => {
    const r = cycleOvertime(cyc.slice(0, 6).map((d) => duty(d, 8)), basis(cyc[0], cyc[7], 'A'));
    expect(r.cycles[0]).toMatchObject({ complete: true, owed: 48, worked: 48, overtime: 0, short: 0 });
    expect(r.total).toBe(0);
  });
  it('three 12 h duties = 36 h: no overtime yet (the cycle owes 48)', () => {
    const r = cycleOvertime([0, 1, 2].map((i) => duty(cyc[i], 12)), basis(cyc[0], cyc[7], 'A'));
    expect(r.total).toBe(0);
    expect(r.cycles[0]).toMatchObject({ worked: 36, overtime: 0, short: 12 });
  });
  it('60 h worked in the cycle = 48 regular + 12 overtime', () => {
    const r = cycleOvertime([0, 1, 2, 4, 5].map((i) => duty(cyc[i], 12)), basis(cyc[0], cyc[7], 'A'));
    expect(r.cycles[0]).toMatchObject({ worked: 60, owed: 48, overtime: 12 });
    expect(r.total).toBe(12);
    // the overtime is the last 12 hours worked, never a whole duty just for being 12 h
    expect(r.duties.map((d) => d.ot)).toEqual([0, 0, 0, 0, 12]);
  });
  it('3 on / 1 off with a rest day worked: set against the duty day off (16 h, not 24 h)', () => {
    const r = cycleOvertime([[0, 12], [1, 12], [2, 8], [4, 12], [5, 12], [6, 8]].map(([i, h]) => duty(cyc[i], h)), basis(cyc[0], cyc[7], 'A'));
    expect(r.cycles[0]).toMatchObject({ worked: 64, overtime: 16 });
  });
  it('partial cycle at the start: only the duty days inside the shutdown are owed', () => {
    // the shutdown starts on N1: N1, N2 are duty days (16 h owed), Off1, Off2 are not
    const r = cycleOvertime([duty(cyc[4], 12), duty(cyc[5], 12), duty(cyc[6], 12)], basis(cyc[4], cyc[7], 'A'));
    expect(r.cycles[0]).toMatchObject({ complete: false, dutyDays: 2, owed: 16, worked: 36, overtime: 20 });
  });
  it('partial cycle at the end the same way', () => {
    const r = cycleOvertime([duty(cyc[0], 12), duty(cyc[1], 12)], basis(cyc[0], cyc[1], 'A'));
    expect(r.cycles[0]).toMatchObject({ complete: false, dutyDays: 2, owed: 16, worked: 24, overtime: 8 });
  });
  it('approved leave on duty days is credited, never turned into overtime', () => {
    const r = cycleOvertime([0, 1, 2, 3].map((i) => duty(cyc[i], 12)), basis(cyc[0], cyc[7], 'A', [cyc[4], cyc[5]]));
    expect(r.cycles[0]).toMatchObject({ regular: 48, credited: 16, owed: 32, worked: 48, overtime: 16 });
  });
  it('short hours are reported, never negative overtime', () => {
    const r = cycleOvertime([duty(cyc[0], 8), duty(cyc[1], 8)], basis(cyc[0], cyc[7], 'A'));
    expect(r.cycles[0]).toMatchObject({ overtime: 0, short: 32 });
  });
  it('day staff: Sunday–Thursday × 8 h = 40 h a week', () => {
    const sun = weekStart('2026-11-04');
    const week = Array.from({ length: 7 }, (_, i) => addDaysIso(sun, i));
    const r = cycleOvertime(week.slice(0, 6).map((d) => duty(d, 8)), basis(week[0], week[6], null));
    expect(r.cycles[0]).toMatchObject({ complete: true, dutyDays: 5, owed: 40, worked: 48, overtime: 8 });
  });
});

describe('months: each calendar month counts the overtime worked in it', () => {
  it('a cycle across month-end: regular hours first, the overtime in the month it was worked; nothing counted twice', () => {
    // a cycle of A starting late October
    const crew = (['A', 'B', 'C', 'D'] as Crew[]).find((k) => { const st = cycleStart(k, '2026-10-31'); return st < '2026-10-31' && addDaysIso(st, 7) > '2026-10-31'; })!;
    const s = cycleStart(crew, '2026-10-31');
    const cyc = Array.from({ length: 8 }, (_, i) => addDaysIso(s, i));
    expect(cyc.some((d) => d.startsWith('2026-10')) && cyc.some((d) => d.startsWith('2026-11'))).toBe(true);
    const r = cycleOvertime(cyc.map((d) => duty(d, 12)), basis(cyc[0], cyc[7], crew));
    expect(r.total).toBe(96 - 48);
    expect(Object.values(r.months).reduce((t, h) => t + h, 0)).toBe(48);
    const oct = cyc.filter((d) => d.startsWith('2026-10')).length * 12;
    // October's days fill the regular hours first; whatever is above 48 h falls where it was worked
    expect(r.months['2026-10'] ?? 0).toBe(Math.max(0, oct - 48));
  });
  it('a cycle of 12 h nights (19:00–07:00): the hours after the 48 owed are overtime', () => {
    let s = m1From('A', '2026-10-20');
    const cyc = Array.from({ length: 8 }, (_, i) => addDaysIso(s, i));
    // the whole cycle worked as 12 h nights 19:00–07:00, owed 48: the last 48 hours are overtime
    const r = cycleOvertime(cyc.map((d) => duty(d, 12, '19:00')), basis(cyc[0], cyc[7], 'A'));
    expect(r.total).toBe(48);
    void s; void H;
    const last = r.duties[r.duties.length - 1];
    expect(last.ot).toBe(12);
  });
  it('October and November are independent: a person can reach the October limit and start November from zero', () => {
    const days = Array.from({ length: 27 }, (_, i) => addDaysIso('2026-10-20', i));
    const r = cycleOvertime(days.map((d) => duty(d, 12)), basis(days[0], days[days.length - 1], 'A'));
    const total = Object.values(r.months).reduce((t, h) => t + h, 0);
    expect(total).toBeCloseTo(r.total, 5);
    expect(Object.keys(r.months).sort()).toEqual(['2026-10', '2026-11']);
  });
});

describe('the calendar month of every hour of overtime (Kuwait time), month-end included', () => {
  // Sat 31 Oct: a rest day for day staff, nothing owed in a window of that one day, so the whole duty is overtime
  const night = () => cycleOvertime([duty('2026-10-31', 12, '19:00')], basis('2026-10-31', '2026-10-31', null));
  const p = { id: 'p', start: '2026-10-20', end: '2026-11-20', maxOvertime: 72, maxOvertimeHard: 80, maxOvertimeYear: 380, maxOvertimeYearHard: 440, rulesVersion: 2 } as unknown as SdPlan;
  const asDuties = (r: ReturnType<typeof night>): DutyOt[] => r.duties.map((d) => ({ ...d, crew: null, restDay: true }));
  it('a night 31 Oct 19:00 – 1 Nov 07:00: 5 h in October, 7 h in November', () => {
    const r = night();
    expect(r.total).toBe(12);
    expect(r.months).toEqual({ '2026-10': 5, '2026-11': 7 });
    expect(r.duties[0]).toMatchObject({ split: true, parts: [{ month: '2026-10', hours: 5 }, { month: '2026-11', hours: 7 }] });
  });
  it('a day duty 31 Oct 07:00–19:00 stays in October; a night on 30 Oct stays in October', () => {
    expect(cycleOvertime([duty('2026-10-31', 12)], basis('2026-10-31', '2026-10-31', null)).months).toEqual({ '2026-10': 12 });
    expect(cycleOvertime([duty('2026-10-30', 12, '19:00')], basis('2026-10-30', '2026-10-30', null)).months).toEqual({ '2026-10': 12 });
  });
  it('the 72 / 80 h check adds the Oracle month-to-date only to its own month', () => {
    const o = personOvertime(p, 'e', asDuties(night()), { asOf: '2026-10-15', ytd: 200, mtd: 70, verified: true }, []);
    expect(o.months.find((m) => m.key === '2026-10')).toMatchObject({ plan: 5, prev: 70, total: 75, state: 'warn' });
    expect(o.months.find((m) => m.key === '2026-11')).toMatchObject({ plan: 7, prev: 0, total: 7, state: 'ok' });
  });
  it('the October part alone can pass the 80 h limit; November is not charged for it', () => {
    const o = personOvertime(p, 'e', asDuties(night()), { asOf: '2026-10-15', ytd: 200, mtd: 76, verified: true }, []);
    expect(o.months.find((m) => m.key === '2026-10')?.state).toBe('over');
    expect(o.months.find((m) => m.key === '2026-11')?.state).toBe('ok');
  });
  it('no Oracle figure: each month is unknown, never zero (the plan stays To Verify)', () => {
    const o = personOvertime(p, 'e', asDuties(night()), null, []);
    expect(o.months.map((m) => m.state)).toEqual(['unknown', 'unknown']);
    expect(o.entryState).toBe('missing');
  });
});
