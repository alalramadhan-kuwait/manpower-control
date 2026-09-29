import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIFT_ALERTS as S, alertText, dueShifts, nextShift, zonedNow, type ShiftAlertSettings } from '..';

// Kuwait is UTC+3 all year: local 05:46 on 29 Sep 2026 = 02:46 UTC
const at = (local: string) => Date.parse(`${local}:00+03:00`);

describe('shift alerts', () => {
  it('reads the wall clock of the time zone', () => {
    expect(zonedNow(at('2026-09-29T05:46'), 'Asia/Kuwait')).toEqual({ date: '2026-09-29', minutes: 5 * 60 + 46 });
    expect(zonedNow(at('2026-09-29T23:59'), 'Asia/Kuwait')).toEqual({ date: '2026-09-29', minutes: 23 * 60 + 59 });
    expect(zonedNow(Date.parse('2026-09-29T21:30:00Z'), 'Asia/Kuwait').date).toBe('2026-09-30');
  });
  it('a shift is due in the 15 minutes before it starts, not before and not after', () => {
    expect(dueShifts(at('2026-09-29T05:44'), S)).toEqual([]);                       // 16 min ahead
    expect(dueShifts(at('2026-09-29T05:45'), S)).toEqual([{ date: '2026-09-29', shift: 'M', startsAt: '06:00', inMinutes: 15 }]);
    expect(dueShifts(at('2026-09-29T05:59'), S).map((d) => d.shift)).toEqual(['M']);
    expect(dueShifts(at('2026-09-29T06:00'), S)).toEqual([]);                        // already started
    expect(dueShifts(at('2026-09-29T13:50'), S).map((d) => d.shift)).toEqual(['A']);
    expect(dueShifts(at('2026-09-29T21:50'), S).map((d) => d.shift)).toEqual(['N']);
  });
  it('a start just after midnight is due late the evening before, for the next date', () => {
    const late: ShiftAlertSettings = { ...S, starts: { M: '06:00', A: '14:00', N: '00:10' } };
    expect(dueShifts(at('2026-09-29T23:55'), late)).toEqual([{ date: '2026-09-30', shift: 'N', startsAt: '00:10', inMinutes: 15 }]);
  });
  it('the lead time is a setting', () => {
    expect(dueShifts(at('2026-09-29T05:35'), { ...S, leadMinutes: 30 }).map((d) => d.shift)).toEqual(['M']);
  });
  it('the next shift, whenever it is', () => {
    expect(nextShift(at('2026-09-29T06:01'), S)).toMatchObject({ shift: 'A', date: '2026-09-29', inMinutes: 479 });
    expect(nextShift(at('2026-09-29T22:30'), S)).toMatchObject({ shift: 'M', date: '2026-09-30' });
  });
  it('the alert names the crew, the shift time and the Controller in charge', () => {
    const f = { crew: 'C' as const, shift: 'A' as const, date: '2026-09-29', startsAt: '14:00', controllers: ['Muath Malallah'], short: [] };
    expect(alertText(f)).toEqual({ title: 'C Shift · Afternoon starts 14:00', body: 'Controller in charge: Muath Malallah', tag: 'shift-2026-09-29-A', url: './?date=2026-09-29' });
    expect(alertText({ ...f, controllers: [], short: ['Field 5 of 6'] }).body).toBe('No Controller counted for this shift: cover needed\nShort: Field 5 of 6');
    expect(alertText({ ...f, also: ['Abdullah Al-Saegh (VR)'] }).body).toBe('Controller in charge: Muath Malallah\nAlso on shift: Abdullah Al-Saegh (VR)');
    expect(alertText({ ...f, test: true }).title).toBe('Test · C Shift · Afternoon starts 14:00');
  });
});
