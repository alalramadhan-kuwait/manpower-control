// The working plan (rules v2, train shutdown): the members' days edited cell by cell. No rules of its own: every change
// is the same plan check the server runs before approving (./v2 checkPlan), on the plan with the change. A change is
// refused when it makes a problem that stops the plan that was not there before (the team minimum, days in a row,
// rest, the 2 days after a full block, the 80 h month, the home crew's minimum on a rest day…); the refusal says why
// and offers changes that pass. "Unavailable" counts as a day off for every rule; leave comes from the leave records.
import { addDaysIso } from '../roster';
import { memberHoursOn, memberWorks, planDates, type SdMember } from './index';
import { awayOn, checkPlan, fmtDay, type Issue, type PlanCheck, type PlanCheckInput } from './v2';

export type CellCode = 'W12' | 'W8' | 'O' | 'U';
/** What one cell shows: a duty, a day off, unavailable, leave (from the leave records) or outside the person's days. */
export type CellView = CellCode | 'L' | 'X';
export interface DayMark { locked: boolean; unavailable: boolean }
export interface CellEdit { memberId: string; date: string; code: CellCode }
export type Days = Record<string, Record<string, { works: boolean; hours: number | null }>>;
export type Marks = Record<string, DayMark>;
export const markKey = (memberId: string, date: string) => `${memberId}|${date}`;

/** The day as stored for a code (an explicit number of hours, so nothing depends on the plan's default). */
export const dayOf = (code: CellCode): { works: boolean; hours: number | null } =>
  code === 'W12' ? { works: true, hours: 12 } : code === 'W8' ? { works: true, hours: 8 } : { works: false, hours: null };

/** The cell of a member on a date: leave first (it stays leave whatever the day says), then the planned day. */
export function cellOf(inp: PlanCheckInput, m: SdMember, date: string, days: Days, marks: Marks): CellView {
  if (date < m.start || date > m.end) return 'X';
  if (awayOn(inp.absences)(m.employeeId, date)) return 'L';
  const d = days[m.id]?.[date];
  const works = d ? d.works : memberWorks(inp.plan, m, date);
  if (!works) return marks[markKey(m.id, date)]?.unavailable ? 'U' : 'O';
  const h = d?.hours ?? memberHoursOn(inp.plan, m, date);
  return h < inp.plan.shiftHours ? 'W8' : 'W12';
}

/** The members' days as the grid holds them (every date of each member, read from the plan). */
export function daysOf(inp: PlanCheckInput): Days {
  const out: Days = {};
  for (const m of inp.members) {
    out[m.id] = {};
    for (const d of planDates(inp.plan)) if (d >= m.start && d <= m.end) {
      const works = memberWorks(inp.plan, m, d);
      out[m.id][d] = { works, hours: works ? memberHoursOn(inp.plan, m, d) : null };
    }
  }
  return out;
}

/** The plan check's input with these days. */
export const withDays = (inp: PlanCheckInput, days: Days): PlanCheckInput => ({ ...inp, members: inp.members.map((m) => ({ ...m, days: { ...(m.days ?? {}), ...days[m.id] } })) });

/** The days after a set of edits (leave days and days outside the member's dates are left as they are). */
export function applyEdits(inp: PlanCheckInput, days: Days, edits: CellEdit[]): Days {
  const away = awayOn(inp.absences);
  const next: Days = { ...days };
  for (const e of edits) {
    const m = inp.members.find((x) => x.id === e.memberId);
    if (!m || e.date < m.start || e.date > m.end || away(m.employeeId, e.date)) continue;
    next[e.memberId] = { ...next[e.memberId], [e.date]: dayOf(e.code) };
  }
  return next;
}

const issueKey = (i: Issue) => `${i.code}|${i.employeeId ?? ''}|${i.teamId ?? ''}|${i.date ?? ''}`;
const gapKey = (g: PlanCheck['gaps'][number]) => `${g.teamId}|${g.role}|${g.date}|${g.from}`;
/** Problems that stop the plan which `after` has and `before` did not (a team short at a new time counts as new). */
export function newHardProblems(before: PlanCheck, after: PlanCheck): Issue[] {
  const was = new Set(before.issues.filter((i) => i.level === 'block' && i.code !== 'coverage').map(issueKey));
  const wasGap = new Set(before.gaps.map(gapKey));
  const out = after.issues.filter((i) => i.level === 'block' && i.code !== 'coverage' && !was.has(issueKey(i)));
  const gaps = after.gaps.filter((g) => !wasGap.has(gapKey(g)));
  const seen = new Set<string>();
  for (const g of gaps) {
    const k = `${g.teamId}|${g.role}`; if (seen.has(k)) continue; seen.add(k);
    const days = [...new Set(gaps.filter((x) => x.teamId === g.teamId && x.role === g.role).map((x) => x.date))];
    out.push({ level: 'block', code: 'coverage', teamId: g.teamId, date: g.date,
      message: `${g.team} team: ${g.label} below the minimum of ${g.need} on ${days.map(fmtDay).join(', ')} (${g.have} on duty ${g.from}–${g.to}).` });
  }
  return out;
}

export interface Tried { ok: boolean; days: Days; check: PlanCheck; problems: Issue[] }
/** One change (one or more cells together) checked against the plan as it is now. */
export function tryEdits(inp: PlanCheckInput, days: Days, current: PlanCheck, edits: CellEdit[]): Tried {
  const next = applyEdits(inp, days, edits);
  const check = checkPlan(withDays(inp, next));
  const problems = newHardProblems(current, check);
  return { ok: !problems.length, days: next, check, problems };
}

export interface Suggestion { label: string; edits: CellEdit[] }
/**
 * Changes close to the refused one that pass: the same change on a nearby day, or, for a day off, the day off swapped
 * with a teammate of the same place who works that day and is off on another (each one checked, at most `max`).
 */
export function suggestions(inp: PlanCheckInput, days: Days, current: PlanCheck, edits: CellEdit[], names: (employeeId: string) => string, max = 3): Suggestion[] {
  if (edits.length !== 1) return [];
  const [e] = edits;
  const m = inp.members.find((x) => x.id === e.memberId); if (!m) return [];
  const out: Suggestion[] = [];
  const test = (s: Suggestion) => { if (out.length < max && tryEdits(inp, days, current, s.edits).ok) out.push(s); };
  const cur = (mid: string, d: string) => cellOf(inp, inp.members.find((x) => x.id === mid)!, d, days, {});
  const working = (c: CellView) => c === 'W12' || c === 'W8';
  for (const dd of [1, -1, 2, -2, 3, -3]) {
    const d = addDaysIso(e.date, dd);
    if (d < m.start || d > m.end || cur(m.id, d) === e.code || cur(m.id, d) === 'L') continue;
    test({ label: `${e.code === 'O' || e.code === 'U' ? 'Off' : 'The same'} on ${fmtDay(d)} instead`, edits: [{ ...e, date: d }] });
  }
  const was = cur(m.id, e.date);
  if ((e.code === 'O' || e.code === 'U') && working(was)) {
    // a teammate of the same place who is off that day works it instead, and takes a nearby day off in exchange
    for (const o of inp.members.filter((x) => x.teamId === m.teamId && x.slot === m.slot && x.id !== m.id)) {
      if (cur(o.id, e.date) !== 'O') continue;
      for (const dd of [1, -1, 2, -2]) {
        const d = addDaysIso(e.date, dd);
        if (d < o.start || d > o.end || !working(cur(o.id, d))) continue;
        test({ label: `Swap: ${names(o.employeeId)} works ${fmtDay(e.date)} and is off ${fmtDay(d)}`,
          edits: [e, { memberId: o.id, date: e.date, code: was as CellCode }, { memberId: o.id, date: d, code: 'O' }] });
        break;
      }
    }
  }
  return out;
}

/** The edits that exchange two cells (move a day off along a row, or swap the days of two people on one date). */
export function swapEdits(inp: PlanCheckInput, days: Days, marks: Marks, a: { memberId: string; date: string }, b: { memberId: string; date: string }): CellEdit[] | null {
  const ma = inp.members.find((x) => x.id === a.memberId), mb = inp.members.find((x) => x.id === b.memberId);
  if (!ma || !mb) return null;
  const ca = cellOf(inp, ma, a.date, days, marks), cb = cellOf(inp, mb, b.date, days, marks);
  if (ca === 'L' || cb === 'L' || ca === 'X' || cb === 'X' || ca === cb) return null;
  return [{ memberId: a.memberId, date: a.date, code: cb }, { memberId: b.memberId, date: b.date, code: ca }];
}
