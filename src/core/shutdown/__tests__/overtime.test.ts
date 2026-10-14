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

describe('KNPC rule: each day worked against the effective 8-day crew roster', () => {
  const crewWith = (code: string, date = '2026-10-31') => { const c = (['A', 'B', 'C', 'D'] as Crew[]).find((x) => dutyFor(date, x) === code); if (!c) throw new Error(`no crew on ${code}`); return c; };
  const one = (crew: Crew | null, date: string, hours: number, at = '07:00') => cycleOvertime([duty(date, hours, at)], basis(date, date, crew));
  it('the rota: M M A A N N Off Off, starting on M1', () => {
    const c = m1From('A', '2026-11-01'); const cyc = Array.from({ length: 8 }, (_, i) => addDaysIso(c, i));
    expect(cyc.map((d) => dutyFor(d, 'A'))).toEqual(['M1', 'M2', 'A1', 'A2', 'N1', 'N2', 'Off1', 'Off2']);
    expect(cycleStart('A', cyc[5])).toBe(c);
  });
  it('roster duty day: 8 h worked = 0 h OT; 12 h worked = 4 h OT', () => {
    const c = crewWith('M2'); expect(one(c, '2026-10-31', 8).total).toBe(0); expect(one(c, '2026-10-31', 12).total).toBe(4);
  });
  it('roster OFF day: 12 h worked = 12 h OT; 8 h worked = 8 h OT', () => {
    const c = crewWith('Off2'); expect(one(c, '2026-10-31', 12).total).toBe(12); expect(one(c, '2026-10-31', 8).total).toBe(8);
  });
  it('the 3 on / 1 off pattern is not the basis: a cycle worked 12 h every day = 6 × 4 + 2 × 12 = 48 h, no 48 h "fill"', () => {
    const s = m1From('A', '2026-10-20'); const cyc = Array.from({ length: 8 }, (_, i) => addDaysIso(s, i));
    const r = cycleOvertime(cyc.map((d) => duty(d, 12)), basis(cyc[0], cyc[7], 'A'));
    expect(r.duties.map((d) => d.ot)).toEqual([4, 4, 4, 4, 4, 4, 12, 12]);
    expect(r.total).toBe(48);
  });
  it('no offset for roster duty days not worked: 3 on / 1 off with one rest day worked', () => {
    const s = m1From('A', '2026-10-20'); const cyc = Array.from({ length: 8 }, (_, i) => addDaysIso(s, i));
    // works M1 M2 A1, off A2, works N1 N2 Off1, off Off2 (all 12 h)
    const r = cycleOvertime([0, 1, 2, 4, 5, 6].map((i) => duty(cyc[i], 12)), basis(cyc[0], cyc[7], 'A'));
    expect(r.duties.map((d) => d.ot)).toEqual([4, 4, 4, 4, 4, 12]);
    expect(r.total).toBe(32);
  });
  it('a partial cycle at the start or end of the shutdown changes nothing: each day on its own', () => {
    const c = crewWith('N2'); const r = cycleOvertime([duty('2026-10-30', 12, '19:00'), duty('2026-10-31', 12, '19:00')], basis('2026-10-30', '2026-10-31', c));
    expect(r.duties.map((d) => d.ot)).toEqual([4, 4]);
  });
  it('approved leave on a duty day: nothing worked, no overtime and nothing deducted', () => {
    const c = crewWith('M2'); const r = cycleOvertime([duty('2026-10-30', 12)], basis('2026-10-30', '2026-10-31', c, ['2026-10-31']));
    expect(r.total).toBe(4);
  });
  it('day staff: Sunday–Thursday duty days (12 h = 4 h OT), Friday and Saturday off (12 h = 12 h OT)', () => {
    expect(one(null, '2026-10-29', 12).total).toBe(4);    // Thursday
    expect(one(null, '2026-10-30', 12).total).toBe(12);   // Friday
  });
});

describe('the calendar month of every overtime hour at month-end (Kuwait time)', () => {
  const crewWith = (code: string) => (['A', 'B', 'C', 'D'] as Crew[]).find((x) => dutyFor('2026-10-31', x) === code)!;
  it('31 Oct a roster duty day (N2), 12 h night 19:00–07:00: the 4 h OT are 03:00–07:00, all in November', () => {
    const r = cycleOvertime([duty('2026-10-31', 12, '19:00')], basis('2026-10-31', '2026-10-31', crewWith('N2')));
    expect(r.duties[0]).toMatchObject({ regular: 8, ot: 4, parts: [{ month: '2026-11', hours: 4 }] });
    expect(r.months).toEqual({ '2026-11': 4 });
  });
  it('31 Oct a roster OFF day (Off2), 12 h night: the whole night is OT, 5 h October + 7 h November', () => {
    const r = cycleOvertime([duty('2026-10-31', 12, '19:00')], basis('2026-10-31', '2026-10-31', crewWith('Off2')));
    expect(r.months).toEqual({ '2026-10': 5, '2026-11': 7 });
  });
  it('31 Oct a roster duty day, 12 h day shift 07:00–19:00: the 4 h OT (15:00–19:00) stay in October', () => {
    const r = cycleOvertime([duty('2026-10-31', 12)], basis('2026-10-31', '2026-10-31', crewWith('M2')));
    expect(r.months).toEqual({ '2026-10': 4 });
  });
  it('the months always add up to the total (nothing lost or counted twice)', () => {
    const days = Array.from({ length: 27 }, (_, i) => addDaysIso('2026-10-20', i));
    const r = cycleOvertime(days.map((d) => duty(d, 12, '19:00')), basis(days[0], days[days.length - 1], 'A'));
    expect(Object.values(r.months).reduce((t, h) => t + h, 0)).toBeCloseTo(r.total, 5);
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

