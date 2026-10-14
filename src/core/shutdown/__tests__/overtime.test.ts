import { describe, expect, it } from 'vitest';
import { addDaysIso, dutyFor, type Crew } from '../../roster';
import { kuwaitMs } from '../../validation';
import { cycleOvertime, cycleStart, type WorkedDuty } from '../overtime';
import { personOvertime, type DutyOt } from '../v2';
import type { SdPlan } from '..';

const duty = (date: string, hours: number, at = '07:00'): WorkedDuty => ({ date, start: kuwaitMs(date, at), hours });
/** The first M1 of crew `c` on or after `d`. */
const m1From = (c: Crew, d: string) => { let x = d; while (dutyFor(x, c) !== 'M1') x = addDaysIso(x, 1); return x; };
const basis = (from: string, to: string, crew: Crew | null, leave: string[] = []) => ({ from, to, crewOn: () => crew, leaveOn: (d: string) => leave.includes(d), normalHours: 8 });

describe('shutdown overtime code: each duty on its own, never against the crew roster', () => {
  const crewWith = (code: string) => { const c = (['A', 'B', 'C', 'D'] as Crew[]).find((x) => dutyFor('2026-10-31', x) === code); if (!c) throw new Error(code); return c; };
  const one = (crew: Crew | null, date: string, hours: number, at = '07:00') => cycleOvertime([duty(date, hours, at)], basis(date, date, crew));
  it('the rota is still known (for joining and leaving the team): M M A A N N Off Off from M1', () => {
    const c = m1From('A', '2026-11-01'); const cyc = Array.from({ length: 8 }, (_, i) => addDaysIso(c, i));
    expect(cyc.map((d) => dutyFor(d, 'A'))).toEqual(['M1', 'M2', 'A1', 'A2', 'N1', 'N2', 'Off1', 'Off2']);
    expect(cycleStart('A', cyc[5])).toBe(c);
  });
  it('a 12 h duty is 4 h overtime and an 8 h duty none, on a roster duty day and on a roster OFF day alike', () => {
    for (const code of ['M2', 'Off2']) { expect(one(crewWith(code), '2026-10-31', 12).total).toBe(4); expect(one(crewWith(code), '2026-10-31', 8).total).toBe(0); }
    expect(one(null, '2026-10-30', 12).total).toBe(4);   // a Friday for day staff: the same
  });
  it('3 on / 1 off for 8 days = 6 duties × 4 h = 24 h, whatever the crew', () => {
    const days = Array.from({ length: 8 }, (_, i) => addDaysIso('2026-10-20', i)).filter((_d, i) => i % 4 !== 3);
    for (const c of ['A', 'B', 'C', 'D'] as Crew[]) expect(cycleOvertime(days.map((d) => duty(d, 12)), basis('2026-10-20', '2026-10-27', c)).total).toBe(24);
  });
  it('leave and days off add or deduct nothing', () => {
    expect(cycleOvertime([duty('2026-10-30', 12)], basis('2026-10-28', '2026-11-02', 'A', ['2026-10-31'])).total).toBe(4);
  });
});

describe('the calendar month of every overtime hour at month-end (Kuwait time)', () => {
  it('a 12 h night 31 Oct 19:00 – 1 Nov 07:00: the 4 h overtime are 03:00–07:00, in November', () => {
    const r = cycleOvertime([duty('2026-10-31', 12, '19:00')], basis('2026-10-31', '2026-10-31', 'A'));
    expect(r.duties[0]).toMatchObject({ regular: 8, ot: 4, parts: [{ month: '2026-11', hours: 4 }] });
  });
  it('a 12 h day duty on 31 Oct: 15:00–19:00, in October', () => {
    expect(cycleOvertime([duty('2026-10-31', 12)], basis('2026-10-31', '2026-10-31', 'A')).months).toEqual({ '2026-10': 4 });
  });
  it('a 16 h duty from 31 Oct 15:00: 8 h regular to 23:00, then 1 h October + 7 h November', () => {
    expect(cycleOvertime([duty('2026-10-31', 16, '15:00')], basis('2026-10-31', '2026-10-31', 'A')).months).toEqual({ '2026-10': 1, '2026-11': 7 });
  });
  it('the months always add up to the total', () => {
    const days = Array.from({ length: 27 }, (_, i) => addDaysIso('2026-10-20', i));
    const r = cycleOvertime(days.map((d) => duty(d, 12, '19:00')), basis(days[0], days[days.length - 1], 'A'));
    expect(Object.values(r.months).reduce((t, h) => t + h, 0)).toBeCloseTo(r.total, 5);
  });
});

describe('the 72 / 80 h check per calendar month, Oracle month-to-date in its own month', () => {
  const p = { id: 'p', start: '2026-10-20', end: '2026-11-20', maxOvertime: 72, maxOvertimeHard: 80, maxOvertimeYear: 380, maxOvertimeYearHard: 440, rulesVersion: 2 } as unknown as SdPlan;
  const r = cycleOvertime([duty('2026-10-31', 12)], basis('2026-10-31', '2026-10-31', 'A'));
  const ds: DutyOt[] = r.duties.map((d) => ({ ...d, crew: 'A', restDay: false }));
  it('October month-to-date counts in October only', () => {
    const o = personOvertime(p, 'e', ds, { asOf: '2026-10-15', ytd: 200, mtd: 70, verified: true }, []);
    expect(o.months.find((m) => m.key === '2026-10')).toMatchObject({ plan: 4, prev: 70, total: 74, state: 'warn' });
  });
  it('over 80 h is blocked', () => {
    expect(personOvertime(p, 'e', ds, { asOf: '2026-10-15', ytd: 200, mtd: 78, verified: true }, []).months[0].state).toBe('over');
  });
  it('no Oracle figure: unknown, never zero', () => {
    const o = personOvertime(p, 'e', ds, null, []);
    expect(o.months.map((m) => m.state)).toEqual(['unknown']); expect(o.entryState).toBe('missing');
  });
});
