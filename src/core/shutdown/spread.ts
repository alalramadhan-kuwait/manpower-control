// Spread the days off of a shutdown team: when a slot has more people than it needs on a day, the days off are
// staggered so the slot still has its people every day, nobody works longer than a set run without a day off, and the
// overtime is as low (and as even) as the roster allows. Pure functions; the app writes the result as the members' own days.
import type { Crew } from '../roster';
import { SD_SLOTS, areasOf, dayOvertime, groupOf, hoursOn, isDutyDay, isRampDay, memberWorks, phaseOn, planDates, type SdMember, type SdPhase, type SdPlan, type SdTeam } from './index';

/** One place people are counted together: a level slot (train shutdown), or Controllers / a Controller section / an area (total turnaround). */
export interface SpreadGroup {
  /** Same keys as a team day: 'controller', 'senior', 'good', 'new', 'ctl:<section>', 'area:<name>'. */
  key: string; teamId: string; memberIds: string[];
  /** People needed on a date. */
  need: (date: string) => number;
}
export interface SpreadStats {
  /** Person-days missing against the need. */
  short: number;
  /** Days nobody at all is there while somebody is needed. */
  gapDays: number;
  /** Overtime hours of the whole group. */
  overtime: number;
  /** Most overtime any one person has in a calendar month. */
  worst: number;
  /** People above the monthly overtime cap in some month. */
  over: number;
}
export interface SpreadResult {
  group: SpreadGroup; before: SpreadStats; after: SpreadStats;
  /** Proposed days: member id → date → works, for the dates the member is on the team. */
  days: Map<string, Record<string, boolean>>;
  /** With the run limit, the least people that could cover every day (only when some days are still short). */
  minPeople: number | null;
}
export interface SpreadContext {
  crewOf: (employeeId: string) => Crew | null;
  away: (employeeId: string, date: string) => boolean;
  /** Most days in a row a person works without a day off. */
  maxRun: number;
}

/** The groups of a team: level slots for a train shutdown; Controllers (per section) and operators per area for a total turnaround. Operators without a level are left as they are. */
export function spreadGroups(p: SdPlan, t: SdTeam, members: SdMember[], phases: SdPhase[]): SpreadGroup[] {
  const ids = (f: (m: SdMember) => boolean) => members.filter((m) => m.teamId === t.id && f(m)).map((m) => m.id);
  if (p.kind !== 'total') {
    return SD_SLOTS.map((s) => ({ key: s, teamId: t.id, memberIds: ids((m) => m.slot === s), need: (d: string) => (isRampDay(p, d) ? t.rampNeeds[s] : t.needs[s]) }));
  }
  const need = (f: (n: { controller: number; sections?: Record<string, number>; areas: Record<string, number> }) => number) => (d: string) => { const n = phaseOn(phases, d)?.needs[t.id]; return n ? f(n) : 0; };
  const out: SpreadGroup[] = [];
  if (p.sections.length) for (const s of p.sections) out.push({ key: `ctl:${s}`, teamId: t.id, memberIds: ids((m) => m.slot === 'controller' && groupOf(p.sections, m.area) === s), need: need((n) => n.sections?.[s] ?? 0) });
  else out.push({ key: 'controller', teamId: t.id, memberIds: ids((m) => m.slot === 'controller'), need: need((n) => n.controller) });
  const areas = areasOf(p);
  for (const a of areas) out.push({ key: `area:${a}`, teamId: t.id, memberIds: ids((m) => m.slot !== 'controller' && groupOf(areas, m.area) === a), need: need((n) => n.areas[a] ?? 0) });
  return out;
}

const month = (d: string) => d.slice(0, 7);
/** Overtime of one person working `date`, on the plan's hours for that day (no hours of their own). */
const workOt = (p: SdPlan, crew: Crew | null, date: string) => Math.max(0, hoursOn(p, date) - (isDutyDay(crew, date) ? p.normalHours : 0));

function stats(p: SdPlan, g: SpreadGroup, members: SdMember[], ctx: SpreadContext, works: (m: SdMember, date: string) => boolean, otOf: (m: SdMember, date: string) => number): SpreadStats {
  let short = 0, gapDays = 0, overtime = 0;
  const perMonth = new Map<string, Map<string, number>>();
  for (const date of planDates(p)) {
    const need = g.need(date);
    const on = members.filter((m) => works(m, date) && !ctx.away(m.employeeId, date));
    if (need > 0) { short += Math.max(0, need - on.length); if (on.length === 0) gapDays++; }
    for (const m of on) {
      const ot = otOf(m, date); overtime += ot;
      const pm = perMonth.get(m.id) ?? new Map<string, number>(); pm.set(month(date), (pm.get(month(date)) ?? 0) + ot); perMonth.set(m.id, pm);
    }
  }
  const worsts = members.map((m) => Math.max(0, ...(perMonth.get(m.id)?.values() ?? [])));
  return { short, gapDays, overtime, worst: Math.max(0, ...worsts), over: worsts.filter((w) => w > p.maxOvertime).length };
}

/**
 * Days for one group, a day at a time: work the people the day needs, choosing those whose overtime is lowest (a rest
 * day of their own crew costs 12 h, a duty day 4 h), who have the least overtime so far this month, and who are not
 * at the end of their run. Somebody who has worked the longest run allowed always gets the next day off, so when too
 * few people are free the day is left short (and `minPeople` says how many are needed).
 */
export function spreadGroup(p: SdPlan, g: SpreadGroup, all: SdMember[], ctx: SpreadContext): SpreadResult {
  const members = g.memberIds.map((id) => all.find((m) => m.id === id)).filter((m): m is SdMember => !!m);
  const days = new Map<string, Record<string, boolean>>(members.map((m) => [m.id, {}]));
  const run = new Map<string, number>(); const worked = new Map<string, boolean>();
  const ot = new Map<string, number>(); // overtime so far in the month being worked
  let cur = '';
  for (const date of planDates(p)) {
    if (month(date) !== cur) { cur = month(date); ot.clear(); }
    const need = g.need(date);
    const free = members.filter((m) => m.start <= date && date <= m.end && !ctx.away(m.employeeId, date));
    const cost = (m: SdMember) => workOt(p, ctx.crewOf(m.employeeId), date);
    const score = (m: SdMember) => {
      const c = cost(m); const so = ot.get(m.id) ?? 0;
      return c + 0.6 * so + (so + c > p.maxOvertime ? 100 : 0) - (worked.get(m.id) ? 1.5 : 0);
    };
    // the run limit is firm: someone at the end of their run rests, and the day is left short if nobody else can work
    const fresh = free.filter((m) => (run.get(m.id) ?? 0) < ctx.maxRun).sort((a, b) => score(a) - score(b));
    const pick = new Set(fresh.slice(0, need).map((m) => m.id));
    for (const m of members) {
      if (date < m.start || date > m.end) { run.set(m.id, 0); worked.set(m.id, false); continue; }
      const w = pick.has(m.id);
      days.get(m.id)![date] = w;
      run.set(m.id, w ? (run.get(m.id) ?? 0) + 1 : 0); worked.set(m.id, w);
      if (w) ot.set(m.id, (ot.get(m.id) ?? 0) + cost(m));
    }
  }
  // polish two starting points, the day-by-day result and the plan as it stands (when it keeps the run limit), and keep the better
  const dates = planDates(p);
  const fromGreedy = improve(p, g, members, ctx, (i, d) => days.get(members[i].id)![d] === true);
  const pattern = (i: number, d: string) => memberWorks(p, members[i], d);
  const runsOk = members.every((m, i) => { let r = 0; return dates.every((d) => { r = pattern(i, d) && !ctx.away(m.employeeId, d) ? r + 1 : 0; return r <= ctx.maxRun; }); });
  const fromPlan = runsOk ? improve(p, g, members, ctx, pattern) : null;
  const best = fromPlan && fromPlan.objective < fromGreedy.objective ? fromPlan : fromGreedy;
  members.forEach((m, i) => dates.forEach((d, k) => { if (m.start <= d && d <= m.end) days.get(m.id)![d] = best.works[i]?.[k] === true; }));
  const after = stats(p, g, members, ctx, (m, date) => days.get(m.id)?.[date] === true, (m, date) => workOt(p, ctx.crewOf(m.employeeId), date));
  const before = stats(p, g, members, ctx, (m, date) => memberWorks(p, m, date), (m, date) => dayOvertime(p, m, ctx.crewOf(m.employeeId), date));
  const maxNeed = Math.max(0, ...planDates(p).map(g.need));
  const minPeople = after.short > 0 && maxNeed > 0 ? Math.ceil((maxNeed * (ctx.maxRun + 1)) / ctx.maxRun) : null;
  return { group: g, before, after, days, minPeople };
}

const W_SHORT = 1000; const W_FAIR = 0.05; const W_CAP = 20;

/**
 * Polishes the day-by-day result: tries turning a day off, swapping who works a day, and moving a working day to
 * another day of the same person, keeping every change that lowers (missing people, then overtime with a lean to an
 * even share and under the monthly cap) without breaking the run limit. Returns the days worked and the score.
 */
function improve(p: SdPlan, g: SpreadGroup, members: SdMember[], ctx: SpreadContext, init: (i: number, date: string) => boolean): { works: boolean[][]; objective: number } {
  const dates = planDates(p); const n = dates.length; const mcount = members.length;
  if (!mcount || !n) return { works: [], objective: 0 };
  const months = [...new Set(dates.map(month))]; const mi = dates.map((d) => months.indexOf(month(d)));
  const need = dates.map((d) => g.need(d));
  const free = members.map((m) => dates.map((d) => m.start <= d && d <= m.end && !ctx.away(m.employeeId, d)));
  const cost = members.map((m) => dates.map((d) => workOt(p, ctx.crewOf(m.employeeId), d)));
  const w = members.map((_, i) => dates.map((d, k) => free[i][k] && init(i, d)));
  const cnt = dates.map((_, k) => w.reduce((c, row) => c + (row[k] ? 1 : 0), 0));
  const mot = members.map((_, i) => months.map((_, q) => dates.reduce((t, _d, k) => t + (w[i][k] && mi[k] === q ? cost[i][k] : 0), 0)));
  const cov = (k: number) => W_SHORT * Math.max(0, need[k] - cnt[k]);
  const mterm = (i: number, q: number) => W_FAIR * mot[i][q] ** 2 + W_CAP * Math.max(0, mot[i][q] - p.maxOvertime);
  const set = (i: number, k: number, v: boolean): number => {
    if (w[i][k] === v) return 0;
    const before = cov(k) + mterm(i, mi[k]) + (w[i][k] ? cost[i][k] : 0);
    w[i][k] = v; cnt[k] += v ? 1 : -1; mot[i][mi[k]] += v ? cost[i][k] : -cost[i][k];
    return cov(k) + mterm(i, mi[k]) + (v ? cost[i][k] : 0) - before;
  };
  const runOk = (i: number, k: number) => {
    let r = 0;
    for (let x = Math.max(0, k - ctx.maxRun); x <= Math.min(n - 1, k + ctx.maxRun); x++) { r = w[i][x] ? r + 1 : 0; if (r > ctx.maxRun) return false; }
    return true;
  };
  const trial = (moves: [number, number, boolean][]): boolean => {
    if (moves.some(([i, k, v]) => v && !free[i][k])) return false;
    let d = 0; for (const [i, k, v] of moves) d += set(i, k, v);
    if (d < -1e-6 && moves.every(([i, k, v]) => !v || runOk(i, k))) return true;
    for (const [i, k, v] of [...moves].reverse()) set(i, k, !v);
    return false;
  };
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let k = 0; k < n; k++) for (let i = 0; i < mcount; i++) {
      if (w[i][k]) {
        if (trial([[i, k, false]])) { changed = true; continue; }
        let done = false;
        for (let j = 0; j < mcount && !done; j++) if (j !== i && !w[j][k] && trial([[i, k, false], [j, k, true]])) { changed = true; done = true; }
        for (let e = Math.max(0, k - 2 * ctx.maxRun); e <= Math.min(n - 1, k + 2 * ctx.maxRun) && !done; e++) if (e !== k && !w[i][e] && trial([[i, k, false], [i, e, true]])) { changed = true; done = true; }
      } else if (free[i][k] && cnt[k] < need[k] && trial([[i, k, true]])) changed = true;
    }
    if (!changed) break;
  }
  const objective = dates.reduce((t, _, k) => t + cov(k), 0) + members.reduce((t, _, i) => t + months.reduce((u, _q, q) => u + mterm(i, q), 0) + dates.reduce((u, _d, k) => u + (w[i][k] ? cost[i][k] : 0), 0), 0);
  return { works: w, objective };
}

/** Every group of every team that has people placed or needs some, spread. */
export function spreadPlan(p: SdPlan, teams: SdTeam[], members: SdMember[], phases: SdPhase[], ctx: SpreadContext): SpreadResult[] {
  const dates = planDates(p);
  return teams.flatMap((t) => spreadGroups(p, t, members, phases)).filter((g) => g.memberIds.length > 0 || dates.some((d) => g.need(d) > 0)).map((g) => spreadGroup(p, g, members, ctx));
}

/** The default longest run without a day off: the plan's days on, or 6 when everybody works every day. */
export const defaultMaxRun = (p: SdPlan) => (p.daysOff > 0 ? p.daysOn : 6);
