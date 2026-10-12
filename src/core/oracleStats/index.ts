// Oracle absence statistics (sick, AB, escort, special …): figures per person, per code, per reporting period, taken from
// Oracle reports. They are not leave cases: they never change a day's manpower and never become a request. They answer
// "how often / how many days" — the yearly figures and the sick-leave check for shutdown teams.
// - A report (snapshot) says which codes and which people it covers: a covered person with no figure for a covered code
//   had 0 days; a person not in the report is unknown (missing), never 0.
// - The rolling 12 months is only what a report covering 12 months says. A calendar-year (or shorter) total is shown
//   for what it is and never stretched into a rolling figure: the shutdown check then says Verification needed.
// - Only the newest active value counts for the same person, code and period (older ones are kept as superseded).
import { addDaysIso } from '../roster';

export interface StatCode { code: string; label: string; countsAsSick: boolean; appType: string | null; verified: boolean; source: string; note: string | null }
export interface StatSnapshot { id: string; source: string; periodStart: string; periodEnd: string; extractedOn: string; codes: string[]; employees: string[]; importedAt: string }
export interface StatValue { snapshotId: string; employeeId: string; code: string; days: number; occurrences: number | null; status: 'active' | 'superseded' }

/** Days between two ISO dates. */
const span = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
/** A report covers 12 months when its period is at least a year long (to the day before the same date a year on). */
export const isTwelveMonths = (s: Pick<StatSnapshot, 'periodStart' | 'periodEnd'>) => span(s.periodStart, s.periodEnd) >= 364;
export const FRESH_DAYS = 45;

/** A person's figure for one code in one report: a number, 0 (covered, nothing reported) or null (not covered). */
export function valueIn(s: StatSnapshot, values: StatValue[], employeeId: string, code: string): number | null {
  if (!s.employees.includes(employeeId) || !s.codes.includes(code)) return null;
  const v = values.find((x) => x.snapshotId === s.id && x.employeeId === employeeId && x.code === code && x.status === 'active');
  if (v) return v.days;
  // superseded in this report by a newer one: not this report's figure any more
  if (values.some((x) => x.snapshotId === s.id && x.employeeId === employeeId && x.code === code)) return null;
  return 0;
}

export type RollingState = 'verified' | 'verification_needed' | 'outdated' | 'missing';
export interface Rolling { state: RollingState; days: number | null; snapshot: StatSnapshot | null; reason: string; byCode: Record<string, number> }

/**
 * Sick days in the rolling 12 months for a person on `asOf`, from the newest report that covers 12 months, ends no more
 * than 45 days before `asOf`, covers the person and every sick code. Anything less is never turned into a number.
 */
export function sickRolling(employeeId: string, asOf: string, snapshots: StatSnapshot[], values: StatValue[], codes: StatCode[]): Rolling {
  const sickCodes = codes.filter((c) => c.countsAsSick && c.verified).map((c) => c.code);
  const mine = snapshots.filter((s) => s.employees.includes(employeeId) && sickCodes.some((c) => s.codes.includes(c)))
    .sort((a, b) => b.extractedOn.localeCompare(a.extractedOn) || b.importedAt.localeCompare(a.importedAt));
  if (!mine.length) return { state: 'missing', days: null, snapshot: null, reason: 'No Oracle sick-leave figure for this person.', byCode: {} };
  const rolling = mine.filter(isTwelveMonths);
  if (!rolling.length) {
    const s = mine[0];
    return { state: 'verification_needed', days: null, snapshot: s, byCode: {}, reason: `Only a ${span(s.periodStart, s.periodEnd) + 1}-day figure (${s.periodStart} – ${s.periodEnd}), not a rolling 12 months.` };
  }
  const s = rolling[0];
  const missing = sickCodes.filter((c) => !s.codes.includes(c));
  if (missing.length) return { state: 'verification_needed', days: null, snapshot: s, byCode: {}, reason: `The report does not cover ${missing.join(', ')}.` };
  const byCode: Record<string, number> = {};
  for (const c of sickCodes) byCode[c] = valueIn(s, values, employeeId, c) ?? 0;
  const days = Object.values(byCode).reduce((a, b) => a + b, 0);
  if (s.periodEnd < addDaysIso(asOf, -FRESH_DAYS) || s.extractedOn < addDaysIso(asOf, -FRESH_DAYS))
    return { state: 'outdated', days, snapshot: s, byCode, reason: `Report taken ${s.extractedOn}: more than ${FRESH_DAYS} days old.` };
  return { state: 'verified', days, snapshot: s, byCode, reason: `Rolling 12 months ${s.periodStart} – ${s.periodEnd} (Oracle, taken ${s.extractedOn}).` };
}

/** Eligibility band of a verified rolling figure: 0–21 eligible, 22–35 warning, over 35 excluded unless excepted. */
export const sickBand = (days: number) => (days <= 21 ? 'eligible' : days <= 35 ? 'warning' : 'excluded') as 'eligible' | 'warning' | 'excluded';

/** One person's figures in one report, per code (null = not covered). */
export function personRow(s: StatSnapshot, values: StatValue[], employeeId: string): Record<string, number | null> {
  return Object.fromEntries(s.codes.map((c) => [c, valueIn(s, values, employeeId, c)]));
}

/** The values of an import that differ from what is already active for the same person, code and period. */
export function conflicts(period: { start: string; end: string }, incoming: { employeeId: string; code: string; days: number }[], snapshots: StatSnapshot[], values: StatValue[]) {
  const same = new Set(snapshots.filter((s) => s.periodStart === period.start && s.periodEnd === period.end).map((s) => s.id));
  return incoming.flatMap((x) => {
    const old = values.find((v) => same.has(v.snapshotId) && v.employeeId === x.employeeId && v.code === x.code && v.status === 'active');
    return old && old.days !== x.days ? [{ ...x, existing: old.days }] : [];
  });
}
