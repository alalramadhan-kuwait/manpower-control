// Shift alerts: a push notification a few minutes before each shift starts, saying which crew comes on and who the
// Controller in charge is. Pure functions; the server (supabase/functions/shift-alerts) and the app both use them.
import { SHIFT_LABEL, addDaysIso, type Crew } from '../roster';

export type ShiftCode = 'M' | 'A' | 'N';
export const SHIFT_CODES: ShiftCode[] = ['M', 'A', 'N'];

export interface ShiftAlertSettings {
  enabled: boolean;
  /** Minutes before the shift starts. */
  leadMinutes: number;
  /** IANA time zone the start times are in. */
  tz: string;
  /** Start of each shift, 'HH:MM' (24 h). */
  starts: Record<ShiftCode, string>;
}
export const DEFAULT_SHIFT_ALERTS: ShiftAlertSettings = { enabled: true, leadMinutes: 15, tz: 'Asia/Kuwait', starts: { M: '06:00', A: '14:00', N: '22:00' } };

export const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };

/** Wall-clock date and minutes since midnight of an instant in a time zone. */
export function zonedNow(ms: number, tz: string): { date: string; minutes: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export interface ShiftStart { date: string; shift: ShiftCode; startsAt: string; inMinutes: number }

/** Shift starts still ahead within `withinMinutes` of `nowMs` (today's, and tomorrow's for a start just after midnight), soonest first. */
export function upcomingStarts(nowMs: number, s: ShiftAlertSettings, withinMinutes: number): ShiftStart[] {
  const now = zonedNow(nowMs, s.tz);
  const out: ShiftStart[] = [];
  for (const shift of SHIFT_CODES) for (const offset of [0, 1]) {
    const inMinutes = offset * 1440 + minutesOf(s.starts[shift]) - now.minutes;
    if (inMinutes > 0 && inMinutes <= withinMinutes) out.push({ date: offset ? addDaysIso(now.date, 1) : now.date, shift, startsAt: s.starts[shift], inMinutes });
  }
  return out.sort((a, b) => a.inMinutes - b.inMinutes);
}
/** Shifts to alert about right now: starting within the lead time. */
export const dueShifts = (nowMs: number, s: ShiftAlertSettings) => upcomingStarts(nowMs, s, s.leadMinutes);
/** The next shift start, whenever it is. */
export const nextShift = (nowMs: number, s: ShiftAlertSettings) => upcomingStarts(nowMs, s, 1440 + 60)[0] ?? null;

export interface AlertFacts {
  crew: Crew; shift: ShiftCode; date: string; startsAt: string;
  /** Who is in charge: the crew's own Controller, or the person covering when he is away. */
  controllers: string[];
  /** Other Controllers counted with the crew that shift (e.g. a VR placed in it). */
  also?: string[];
  /** Positions short of their minimum, e.g. 'Field 5 of 6'. */
  short: string[];
  test?: boolean;
}
export interface AlertText { title: string; body: string; tag: string; url: string }

export function alertText(f: AlertFacts): AlertText {
  const lead = f.controllers.length ? `Controller in charge: ${f.controllers.join(', ')}` : 'No Controller counted for this shift: cover needed';
  return {
    title: `${f.test ? 'Test · ' : ''}${f.crew} Shift · ${SHIFT_LABEL[f.shift]} starts ${f.startsAt}`,
    body: [lead, f.also?.length ? `Also on shift: ${f.also.join(', ')}` : '', f.short.length ? `Short: ${f.short.join(', ')}` : ''].filter(Boolean).join('\n'),
    tag: `shift-${f.date}-${f.shift}`,
    url: `./?date=${f.date}`
  };
}
