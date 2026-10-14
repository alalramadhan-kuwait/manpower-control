// The train-shutdown planner (rules v2): who of the selected shutdown team works which day and for how many hours, one
// group at a time: the Controllers, the Field Operators (Experienced and Good together), the New Field Operators.
// Pure functions; the app writes the result as the members' own days. Only the group's own members are ever used.
//
// Hard rules first (the final shutdown rules, see SD_MINIMUM in ./v2):
//   - every day, the group's minimum on the full 12-hour shift (07:00–19:00 / 19:00–07:00): Controllers 1; Field
//     Operators 2 different people, at least one Experienced (Senior); an 8-hour duty never counts for the last 4 hours;
//   - never more than 6 days in a row, never both days of a crew rest-day pair (one is allowed), approved leave kept,
//     the rest before joining and after leaving the team as light as possible (ctx.transitionCost);
// then the preferences, in order:
//   1. the plan's days on / days off (3 on / 1 off, the standard for every shutdown employee), the people of a group
//      starting it at different offsets so their days off are spread; when days off clash and the minimum is short, the
//      offsets are changed, not the pattern. The crew roster (M M A A N N Off Off) decides the overtime only (./overtime:
//      a 12 h duty on a roster duty day 4 h, on a roster OFF day 12 h), never the shutdown days off;
//   2. 12-hour duties;
//   3. each person at or below the monthly target (72 h after what they already took that month; months counted apart);
//   4. 8-hour duties for qualified people only where the target needs it, and only on days the minimum is held by others;
//   5. New Field Operators (training, never counted): always 12 hours; near the target they get extra days off instead;
//   6. fair overtime inside the group.
// The minimum is a safety floor, not the staffing target: everyone the pattern puts on duty works, and more qualified
// people than the minimum is welcome. A day is taken away only to keep someone within the 72 h target or a rest rule,
// never just to lower the team's overtime; and nobody is added beyond the pattern to raise the headcount. The 72–80 h
// range is never planned for; it is only reported when coverage cannot be held otherwise.
// Overtime is always the engine's (./overtime): each day against the person's 8-day crew roster (duty day 12 h = 4 h, off day 12 h = 12 h).
//
// When the place cannot be covered on a day (everybody on leave, or a 7th day in a row would be needed), the day is left
// short and reported; the planner never breaks a hard rule to fill it.
import { addDaysIso, type Crew } from '../roster';
import { kuwaitMs } from '../validation';
import { isDutyDay, isRampDay, planDates, type SdMember, type SdPlan } from './index';
import { cycleOvertime, type OtResult } from './overtime';
import type { PersonLine, SpreadContext, SpreadGroup, TrainInfo } from './spread';

/** v2: the hard limit of days in a row. */
export const MAX_RUN = 6;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A person's planned days in a place: works on day k, and the hours that day. */
export interface Draft { works: boolean[]; hours: number[] }

/** Overtime of one person's draft with the cycle engine. */
export function draftOvertime(p: SdPlan, g: Pick<SpreadGroup, 'start'>, m: SdMember, crew: Crew | null | ((date: string) => Crew | null), d: Draft, dates: string[], leaveOn?: (date: string) => boolean): OtResult {
  const duties = dates.flatMap((date, k) => (d.works[k] && d.hours[k] > 0 ? [{ date, start: kuwaitMs(date, g.start ?? '07:00'), hours: d.hours[k] }] : []));
  return cycleOvertime(duties, { from: m.start > p.start ? m.start : p.start, to: m.end < p.end ? m.end : p.end, crewOn: typeof crew === 'function' ? crew : () => crew, leaveOn, normalHours: p.normalHours });
}

/** The two days of each crew rest-day pair inside the plan (index pairs), on the rota kept each day. */
function restPairs(dates: string[], crewOn: (date: string) => Crew | null): [number, number][] {
  const out: [number, number][] = [];
  const rest = (k: number) => !isDutyDay(crewOn(dates[k]), dates[k]);
  for (let k = 0; k + 1 < dates.length; k++) if (rest(k) && rest(k + 1) && (k === 0 || !rest(k - 1))) out.push([k, k + 1]);
  return out;
}

export interface PlannedGroup { days: Map<string, Record<string, boolean>>; hours: Map<string, Record<string, number>>; info: TrainInfo; gaps: string[]; notes: string[] }

/** Plans one level place of a train shutdown team. */
export function planTrainGroup(p: SdPlan, g: SpreadGroup, members: SdMember[], ctx: SpreadContext): PlannedGroup {
  const dates = planDates(p); const n = dates.length; const N = members.length;
  const extra = g.key === 'new';
  // who counts for the group's minimum, and who is Experienced (by the stored classification; see capabilities in ./v2)
  const levelOf = (i: number) => ctx.levelOf?.(members[i].employeeId) ?? (members[i].slot === 'senior' ? 'senior' : members[i].slot === 'good' ? 'good' : null);
  const qual = members.map((_m, i) => !extra && (g.key !== 'fo' || ['senior', 'good'].includes(levelOf(i) ?? '')));
  const exp = members.map((_m, i) => g.key === 'fo' && levelOf(i) === 'senior');
  const composite = g.key === 'fo';
  /** Does this set of people (indices) hold the group's minimum on day k? */
  const holdsMin = (set: number[], k: number) => set.filter((i) => qual[i]).length >= need[k] && (!composite || need[k] <= 0 || set.some((i) => exp[i]));
  const full = p.shiftHours, short = Math.min(p.normalHours, p.shiftHours);
  const fatigue = g.night ? ctx.fullRunNight ?? 3 : ctx.fullRunDay ?? 4;
  const crews = members.map((m) => ctx.crewOf(m.employeeId));
  // the rota each person keeps on each date (a VR's placement can change during the shutdown), as the plan check reads it
  const crewOn = members.map((m, i) => (d: string) => (ctx.crewOn ? ctx.crewOn(m.employeeId, d) : crews[i]));
  const leave = (i: number) => (d: string) => ctx.away(members[i].employeeId, d);
  const inRange = members.map((m) => dates.map((d) => m.start <= d && d <= m.end));
  const avail = members.map((m, i) => dates.map((d, k) => inRange[i][k] && !ctx.away(m.employeeId, d)));
  const duty = crewOn.map((c) => dates.map((d) => isDutyDay(c(d), d)));
  // the group's minimum on duty at every moment of the shift: that many people work the full shift, since an 8-hour
  // duty leaves the last 4 hours uncovered. The New FO group is never needed.
  const need = dates.map((d) => (extra ? 0 : g.need(d)));
  const present = (k: number, without = -1) => members.map((_m, i) => i).filter((i) => i !== without && drafts[i].works[k]);
  const sat = (k: number, without = -1) => need[k] <= 0 || holdsMin(present(k, without), k);
  const ramp = dates.map((d) => isRampDay(p, d));
  const cycle = p.daysOn + p.daysOff;
  const inPhase = dates.map((d) => p.daysOff > 0 && !!p.cycleUntil && d <= p.cycleUntil);
  const isOffAt = (k: number, r: number) => (((k - r) % cycle) + cycle) % cycle >= p.daysOn;
  const target = (i: number, ym: string) => Math.max(0, p.maxOvertime - (ctx.monthTaken?.(members[i].employeeId, ym) ?? 0));
  const hard = (i: number, ym: string) => Math.max(0, (p.maxOvertimeHard ?? p.maxOvertime + 8) - (ctx.monthTaken?.(members[i].employeeId, ym) ?? 0));
  const notes: string[] = [];

  // 1. the pattern: each person's place in the cycle (offset); the people of a place get different ones
  const presence = (i: number, r: number): boolean[] => {
    const w = dates.map((_d, k) => avail[i][k] && (inPhase[k] ? !isOffAt(k, r) : duty[i][k]));
    let run = 0; for (let k = 0; k < n; k++) { if (w[k] && run >= MAX_RUN) w[k] = false; run = w[k] ? run + 1 : 0; }
    return w;
  };
  const offsets = Array.from({ length: Math.max(1, cycle) }, (_, r) => r);
  const pairs = crewOn.map((c) => restPairs(dates, c));
  const pairHits = (i: number, w: boolean[]) => pairs[i].filter(([a, b]) => w[a] && w[b]).length;
  const own = members.map((_m, i) => offsets.map((r) => {
    const w = presence(i, r);
    const restWorked = w.filter((x, k) => x && !duty[i][k]).length;
    const trans = ctx.transitionCost ? ctx.transitionCost(members[i], Object.fromEntries(dates.map((d, k) => [d, w[k]]))) : 0;
    return { w, cost: pairHits(i, w) * 1e4 + trans * 1e3 + restWorked * 10 };
  }));
  const anyPhase = inPhase.some(Boolean);
  let best: number[] = members.map(() => 0);
  if (anyPhase && N > 0) {
    const score = (assign: number[]) => {
      let s = 0;
      for (let k = 0; k < n; k++) { if (need[k] <= 0) continue; const on = assign.map((r, i) => (own[i][r].w[k] ? i : -1)).filter((i) => i >= 0); if (!holdsMin(on, k)) s += 1e6; else if (on.filter((i) => qual[i]).length === need[k]) s += 1; }
      return s + assign.reduce((t, r, i) => t + own[i][r].cost, 0) + new Set(assign).size * -5;
    };
    if (N <= 6) {
      let bestScore = Infinity; const cur: number[] = [];
      const rec = (i: number) => { if (i === N) { const s = score(cur); if (s < bestScore) { bestScore = s; best = [...cur]; } return; } for (const r of offsets) { cur[i] = r; rec(i + 1); } };
      rec(0);
    } else {
      best = members.map((_m, i) => offsets.slice().sort((a, b) => own[i][a].cost - own[i][b].cost || a - b)[i % offsets.length]);
    }
  }
  const drafts: Draft[] = members.map((_m, i) => ({ works: anyPhase ? [...own[i][best[i]].w] : presence(i, 0), hours: dates.map(() => 0) }));

  // 2. coverage first: a day with nobody of the place gets somebody who is free. Never a 7th day: when switching the day
  //    on makes the run too long, a day at the end of that run is given off instead, if someone else of the place is
  //    there that day. Never both days of a crew rest-day pair.
  const ot = (i: number) => draftOvertime(p, g, members[i], crewOn[i], drafts[i], dates, leave(i));
  const monthOt = (i: number, ym: string) => ot(i).months[ym] ?? 0;
  const span = (w: boolean[], k: number) => { let a = k, b = k; while (a - 1 >= 0 && w[a - 1]) a--; while (b + 1 < n && w[b + 1]) b++; return [a, b] as const; };
  /** Days `i` would work with day k switched on, the run kept within the limit (a day of the run given off where someone
   *  else of the place is there); null when it cannot be done without a 7th day or both days of a rest-day pair. */
  const withDay = (i: number, k: number): boolean[] | null => {
    const w = [...drafts[i].works]; w[k] = true;
    for (let guard = 0; guard < 4; guard++) {
      const [a, b] = span(w, k);
      if (b - a + 1 <= MAX_RUN) return pairHits(i, w) <= pairHits(i, drafts[i].works) ? w : null;
      // a day of the run (not k) whose cover does not depend on i, splitting the run into parts within the limit
      const j = Array.from({ length: b - a + 1 }, (_, x) => a + x).filter((x) => x !== k && sat(x, i))
        .filter((x) => x - a <= MAX_RUN && b - x <= MAX_RUN).sort((x, y) => Math.abs(y - k) - Math.abs(x - k))[0];
      if (j === undefined) return null;
      w[j] = false;
    }
    return null;
  };
  const gaps: string[] = [];
  for (let k = 0; k < n; k++) for (let guard = 0; guard < N && !sat(k); guard++) {
    // the minimum not held: bring in a qualified person who is free (an Experienced one when that is what is missing)
    const noExp = composite && !present(k).some((i) => exp[i]);
    const opts = members.map((_m, i) => i).filter((i) => avail[i][k] && !drafts[i].works[k] && qual[i] && (!noExp || exp[i])).map((i) => ({ i, w: withDay(i, k) })).filter((x): x is { i: number; w: boolean[] } => !!x.w)
      .sort((a, b) => monthOt(a.i, dates[k].slice(0, 7)) - monthOt(b.i, dates[k].slice(0, 7)) || a.i - b.i);
    if (opts.length) { drafts[opts[0].i].works = opts[0].w; notes.push(`${dates[k]}: day off moved to cover the place`); } else { gaps.push(dates[k]); break; }
  }
  // both days of a crew rest-day pair worked (the pattern and the rota do not line up, e.g. day staff on 3 on / 1 off):
  // one of the two is given off when someone else of the place holds it, or can be brought in for it
  for (let i = 0; i < N; i++) for (const [a, b] of pairs[i]) {
    if (!drafts[i].works[a] || !drafts[i].works[b]) continue;
    const free = [a, b].find((x) => sat(x, i));
    if (free !== undefined) { drafts[i].works[free] = false; notes.push(`${dates[free]}: one rest day of the pair given back`); continue; }
    let done = false;
    for (const x of [b, a]) for (let y = 0; y < N && !done; y++) {
      if (y === i || !avail[y][x] || drafts[y].works[x] || !holdsMin([...present(x, i), y], x)) continue;
      const w = withDay(y, x); if (!w) continue;
      drafts[y].works = w; drafts[i].works[x] = false; done = true; notes.push(`${dates[x]}: one rest day of the pair given back, covered by another person`);
    }
  }
  for (let k = 0; k < n; k++) if (!sat(k) && !gaps.includes(dates[k])) gaps.push(dates[k]);
  gaps.sort();

  // 3. the hours: each day the minimum on the full shift (the others the normal hours for now, see 6). The full shifts
  //    go to whoever has the least overtime that month so far; for the Field Operators one of them Experienced. The
  //    minimum is a floor, not the target: the others on their pattern stay on duty (reduced days included), and only
  //    the monthly target (4) or a rest rule takes a day away.
  const fullRun = (i: number, k: number) => { let a = 0; while (k - a - 1 >= 0 && drafts[i].hours[k - a - 1] >= full) a++; return a; };
  for (let k = 0; k < n; k++) {
    const on = members.map((_m, i) => i).filter((i) => drafts[i].works[k]);
    for (const i of on) drafts[i].hours[k] = short;
    if (need[k] <= 0 || !on.length) continue;
    const ym = dates[k].slice(0, 7);
    // as many on the full shift as the place's minimum (an 8-hour duty covers only 07:00–15:00 / 19:00–03:00)
    const order = on.filter((i) => qual[i]).sort((a, b) => (fullRun(a, k) >= fatigue ? 1 : 0) - (fullRun(b, k) >= fatigue ? 1 : 0) || monthOt(a, ym) - monthOt(b, ym) || a - b);
    const first = composite ? order.find((i) => exp[i]) : undefined;
    const picks = [...(first !== undefined ? [first] : []), ...order.filter((i) => i !== first)].slice(0, need[k]);
    for (const x of picks) drafts[x].hours[k] = full;
  }

  // 4. monthly overtime: above the target, hand full shifts to someone of the place who has room; still above, give
  //    the person days off on days somebody else holds the full shift (relief days), rest days first
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const holds = (i: number, k: number) => drafts[i].works[k] && drafts[i].hours[k] >= full;
  for (let pass = 0; pass < 3; pass++) for (const ym of months) for (let i = 0; i < N; i++) {
    for (let guard = 0; guard < n && monthOt(i, ym) > target(i, ym); guard++) {
      let moved = false;
      for (let k = 0; k < n && !moved; k++) {
        if (!dates[k].startsWith(ym) || !holds(i, k) || ramp[k]) continue;
        const holders = members.map((_m, x) => x).filter((x) => holds(x, k));
        const j = members.map((_m, x) => x).filter((x) => x !== i && qual[x] && drafts[x].works[k] && !holds(x, k) && fullRun(x, k) < fatigue && holdsMin([...holders.filter((y) => y !== i), x], k))
          .filter((x) => { drafts[x].hours[k] = full; const ok = monthOt(x, ym) <= target(x, ym); drafts[x].hours[k] = short; return ok; })
          .sort((a, b) => monthOt(a, ym) - monthOt(b, ym))[0];
        if (j !== undefined) { drafts[i].hours[k] = short; drafts[j].hours[k] = full; moved = true; }
      }
      if (!moved) {
        // a relief day off (the place stays covered by the full-shift holder), crew rest days first
        const k = dates.map((_d, x) => x).filter((x) => dates[x].startsWith(ym) && drafts[i].works[x] && !holds(i, x) && holdsMin(members.map((_m, y) => y).filter((y) => y !== i && holds(y, x)), x))
          .sort((a, b) => Number(duty[i][a]) - Number(duty[i][b]) || b - a)[0];
        if (k === undefined) break;
        drafts[i].works[k] = false; drafts[i].hours[k] = 0; notes.push(`${dates[k]}: relief day off to keep the overtime within ${p.maxOvertime} h`);
      }
    }
  }

  // 5. fairness: hand a full shift from the person with the most overtime to one with less, while it narrows the gap
  if (!extra && N > 1) {
    const total = (i: number) => ot(i).total;
    for (let guard = 0; guard < n * N; guard++) {
      const order = members.map((_m, i) => i).sort((a, b) => total(b) - total(a));
      const hi = order[0], lo = order[order.length - 1];
      if (total(hi) - total(lo) <= full - short) break;
      const k = dates.map((_d, x) => x).find((x) => !ramp[x] && holds(hi, x) && qual[lo] && drafts[lo].works[x] && !holds(lo, x) && fullRun(lo, x) < fatigue
        && holdsMin([...members.map((_m, y) => y).filter((y) => y !== hi && holds(y, x)), lo], x)
        && (() => { drafts[lo].hours[x] = full; const ok = monthOt(lo, dates[x].slice(0, 7)) <= target(lo, dates[x].slice(0, 7)); drafts[lo].hours[x] = short; return ok; })());
      if (k === undefined) break;
      drafts[hi].hours[k] = short; drafts[lo].hours[k] = full;
    }
  }

  // 6. 12-hour duties are preferred: the others' 8-hour days become full shifts, the person with the least overtime
  //    first, as long as the month stays within the target (and, as a preference, not past the run of full shifts)
  if (!extra) for (let pass = 0; pass < 2; pass++) for (const ym of months) {
    const order = members.map((_m, i) => i).sort((a, b) => monthOt(a, ym) - monthOt(b, ym));
    for (const i of order) for (let k = 0; k < n; k++) {
      if (!dates[k].startsWith(ym) || !drafts[i].works[k] || drafts[i].hours[k] >= full || (pass === 0 && fullRun(i, k) >= fatigue)) continue;
      drafts[i].hours[k] = full;
      if (monthOt(i, ym) > target(i, ym)) drafts[i].hours[k] = short;
    }
  }

  // 7. New Field Operators: always the full shift; above the monthly target, extra days off instead of shorter days
  //    (the last day of a run first, crew rest days first, so the pattern stays readable)
  if (extra) for (let i = 0; i < N; i++) {
    for (let k = 0; k < n; k++) if (drafts[i].works[k]) drafts[i].hours[k] = full;
    for (const ym of months) for (let guard = 0; guard < n && monthOt(i, ym) > target(i, ym); guard++) {
      const k = dates.map((_d, x) => x).filter((x) => dates[x].startsWith(ym) && drafts[i].works[x])
        .sort((a, b) => Number(drafts[i].works[a + 1] ?? false) - Number(drafts[i].works[b + 1] ?? false) || Number(duty[i][a]) - Number(duty[i][b]) || b - a)[0];
      if (k === undefined) break;
      drafts[i].works[k] = false; drafts[i].hours[k] = 0; notes.push(`${dates[k]}: extra day off (New FO near the ${p.maxOvertime} h target, kept on 12 h)`);
    }
  }

  // anything still above the hard limit is reported (the plan check blocks it)
  for (let i = 0; i < N; i++) for (const ym of months) if (monthOt(i, ym) > hard(i, ym)) notes.push(`${members[i].employeeId}: ${r2(monthOt(i, ym))} h in ${ym}, above the ${p.maxOvertimeHard ?? p.maxOvertime} h limit: add a person to the place`);

  const days = new Map<string, Record<string, boolean>>(), hours = new Map<string, Record<string, number>>();
  const people: PersonLine[] = members.map((m, i) => {
    const dd: Record<string, boolean> = {}, hh: Record<string, number> = {};
    dates.forEach((d, k) => { if (!inRange[i][k]) return; dd[d] = drafts[i].works[k]; if (drafts[i].works[k]) hh[d] = drafts[i].hours[k]; });
    days.set(m.id, dd); hours.set(m.id, hh);
    const r = ot(i);
    let week = 0; for (let k = 0; k < n; k++) { let t = 0; for (let j = k; j < Math.min(n, k + 7); j++) t += drafts[i].works[j] ? drafts[i].hours[j] : 0; week = Math.max(week, t); }
    const years: PersonLine['years'] = {};
    for (const [ym, h] of Object.entries(r.months)) { const y = Number(ym.slice(0, 4)); years[y] = { taken: ctx.yearTaken?.(m.employeeId, y) ?? 0, planned: r2((years[y]?.planned ?? 0) + h) }; }
    const worked = drafts[i].works.filter(Boolean).length, fulls = drafts[i].works.filter((w, k) => w && drafts[i].hours[k] >= full).length;
    return { id: m.id, crew: crews[i], days: worked, full: fulls, short: worked - fulls, overtime: r.total, weekHours: week, months: r.months, years };
  });
  const runBreaks = members.reduce((t, _m, i) => t + dates.filter((_d, k) => drafts[i].hours[k] >= full && fullRun(i, k) >= fatigue).length, 0);
  const seen = new Set(crews.filter((c): c is Crew => !!c));
  void addDaysIso;
  return { days, hours, gaps, notes, info: { people, addFrom: gaps.length ? (['A', 'B', 'C', 'D'] as Crew[]).filter((c) => !seen.has(c)) : [], wanted: extra ? 0 : Math.max(2, N), sameCrew: seen.size < crews.filter(Boolean).length, runBreaks } };
}
