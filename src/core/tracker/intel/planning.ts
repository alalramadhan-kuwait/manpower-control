// Maintenance Planning progress intelligence (Engine B, 27 Oct 2026).
// Maintenance Planning reports its own planned and actual completion (e.g. 51.01% / 51.01%). That official figure is
// stored as reported, day by day, apart from the tracker's work progress (hours-weighted P6 lines) and the shutdown
// finish forecast (critical path). Nothing merges them. To find how Planning calculates it, every candidate method the
// available data allows is computed at the report's cutoff and compared with the reported figures; a method is
// "verified" only when it reproduces several dated figures, "partial" when one, else "unverified" with the inputs that
// are missing named. No weight is ever invented to force a match.
import { qtyProgress, type TrkActivity, type TrkData } from '..';

export interface PlanningRecord { id?: string; reportDate: string; cutoff: string | null; planned: number; actual: number; source: string; revision: number; supersedes?: string | null; createdAt?: string }
export type Verification = 'verified' | 'partial' | 'unverified';
export interface Candidate { code: 'A' | 'B' | 'C' | 'D' | 'E'; name: string; formula: string; planned: number | null; actual: number | null; basis: string; total: number; earned: number; scheduled: number; n: number }

const H = 36e5; const r2 = (x: number) => Math.round(x * 100) / 100;
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

/** The M & I lines the tracker measures: tracked, not a detail step, not Operations, with P6 dates. */
export function planningLines(d: TrkData): TrkActivity[] {
  return d.activities.filter((a) => a.tracked && !a.detail && a.group !== 'Operations' && !a.outOfScope && a.start && a.finish);
}
const hours = (a: TrkActivity) => Math.max(0, a.durationH ?? (ms(a.finish) - ms(a.start)) / H);
const planFrac = (a: TrkActivity, t: number) => { const s = ms(a.start), f = ms(a.finish); return f > s ? Math.min(1, Math.max(0, (t - s) / (f - s))) : t >= s ? 1 : 0; };
/** Completion fraction at `t`: finished 1, running its measured share (drums) else `running`, not started 0. */
function doneFrac(d: TrkData, a: TrkActivity, t: number, running: number): number {
  if (a.actualFinish && ms(a.actualFinish) <= t) return 1;
  if (a.actualStart && ms(a.actualStart) <= t) {
    const sc = d.engine?.scopes.find((x) => x.key === a.key && x.scope === 'removal' && x.activityIds.includes(a.activityId));
    if (sc?.working) { const es = d.engine!.entries.filter((x) => x.scopeId === sc.id && Date.parse(`${x.shiftDate}T12:00:00Z`) <= t + 36 * H); return (qtyProgress({ working: sc.working, initial: sc.initial, completeAt: sc.completeAt }, es).actualPct ?? 0) / 100; }
    return running;
  }
  return 0;
}

/** Every method the data allows, at a reporting cutoff. */
export function planningCandidates(d: TrkData, cutoff: number): Candidate[] {
  const ls = planningLines(d); const n = ls.length;
  if (!n) return [];
  const pct = (x: number, w: number) => (w > 0 ? r2(100 * x / w) : null);
  const sumH = ls.reduce((t, a) => t + hours(a), 0);
  const earnedH = ls.reduce((t, a) => t + hours(a) * doneFrac(d, a, cutoff, 0), 0), schedH = ls.reduce((t, a) => t + hours(a) * planFrac(a, cutoff), 0);
  const earnedB = ls.reduce((t, a) => t + doneFrac(d, a, cutoff, 0.5), 0), schedB = ls.reduce((t, a) => t + planFrac(a, cutoff), 0);
  const doneC = ls.filter((a) => a.actualFinish && ms(a.actualFinish) <= cutoff).length, schedC = ls.filter((a) => ms(a.finish) <= cutoff).length;
  const dur = (a: TrkActivity) => Math.max(0, ms(a.finish) - ms(a.start)) / H; const sumD = ls.reduce((t, a) => t + dur(a), 0);
  const earnedD = ls.reduce((t, a) => t + dur(a) * doneFrac(d, a, cutoff, 0), 0), schedD = ls.reduce((t, a) => t + dur(a) * planFrac(a, cutoff), 0);
  const keys = [...new Set(ls.map((a) => a.key))];
  const perItem = (f: (a: TrkActivity) => number) => keys.map((k) => { const xs = ls.filter((a) => a.key === k); const w = xs.reduce((t, a) => t + hours(a), 0); return w ? xs.reduce((t, a) => t + hours(a) * f(a), 0) / w : 0; });
  const avg = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / (xs.length || 1);
  return [
    { code: 'A', name: 'Weighted work hours', formula: '100 × Σ earned hours / Σ P6 hours; planned = Σ scheduled hours by the cutoff / Σ P6 hours', planned: pct(schedH, sumH), actual: pct(earnedH, sumH), basis: `${n} M & I lines, ${Math.round(sumH)} P6 hours; a running line earns its measured share (drums) else 0`, total: sumH, earned: earnedH, scheduled: schedH, n },
    { code: 'B', name: 'Weighted activity progress (equal weights)', formula: '100 × Σ completion fraction / number of activities (running = 50%)', planned: pct(schedB, n), actual: pct(earnedB, n), basis: `${n} lines, equal weight`, total: n, earned: earnedB, scheduled: schedB, n },
    { code: 'C', name: 'Activity count', formula: '100 × completed activities / total activities; planned = activities due by the cutoff', planned: pct(schedC, n), actual: pct(doneC, n), basis: `${doneC} of ${n} finished`, total: n, earned: doneC, scheduled: schedC, n },
    { code: 'D', name: 'Duration-based schedule progress', formula: '100 × Σ (P6 duration × planned fraction by the cutoff) / Σ P6 duration; actual by the same durations', planned: pct(schedD, sumD), actual: pct(earnedD, sumD), basis: `${Math.round(sumD)} calendar hours of P6 bars`, total: sumD, earned: earnedD, scheduled: schedD, n },
    { code: 'E', name: 'Equipment-weighted (equal items)', formula: '100 × mean of each item\'s hours-weighted progress; planned the same by P6 dates', planned: r2(100 * avg(perItem((a) => planFrac(a, cutoff)))), actual: r2(100 * avg(perItem((a) => doneFrac(d, a, cutoff, 0)))), basis: `${keys.length} items, equal weight`, total: keys.length, earned: avg(perItem((a) => doneFrac(d, a, cutoff, 0))) * keys.length, scheduled: avg(perItem((a) => planFrac(a, cutoff))) * keys.length, n }];
}

export interface Reconstruction { status: Verification; matches: { code: Candidate['code']; name: string; dates: string[]; plannedOnly: string[]; actualOnly: string[] }[]; checked: number; missing: string[]; note: string }
/** The reported figures against every candidate at each report's cutoff (19:00 of the report day unless given). */
export function reconstruct(d: TrkData, records: PlanningRecord[], tolerancePts = 0.5): Reconstruction {
  const latest = new Map<string, PlanningRecord>();
  for (const r of [...records].sort((a, b) => a.revision - b.revision)) latest.set(r.reportDate, r);
  const recs = [...latest.values()];
  const matches = (['A', 'B', 'C', 'D', 'E'] as const).map((code) => ({ code, name: '', dates: [] as string[], plannedOnly: [] as string[], actualOnly: [] as string[] }));
  for (const r of recs) {
    const cutoff = r.cutoff ? Date.parse(r.cutoff) : Date.parse(`${r.reportDate}T16:00:00Z`);
    for (const c of planningCandidates(d, cutoff)) {
      const m = matches.find((x) => x.code === c.code)!; m.name = c.name;
      const p = c.planned !== null && Math.abs(c.planned - r.planned) <= tolerancePts, a = c.actual !== null && Math.abs(c.actual - r.actual) <= tolerancePts;
      if (p && a) m.dates.push(r.reportDate); else if (p) m.plannedOnly.push(r.reportDate); else if (a) m.actualOnly.push(r.reportDate);
    }
  }
  const best = [...matches].sort((a, b) => b.dates.length - a.dates.length || (b.plannedOnly.length + b.actualOnly.length) - (a.plannedOnly.length + a.actualOnly.length))[0];
  const status: Verification = best && best.dates.length >= 2 ? 'verified' : best && (best.dates.length === 1 || best.plannedOnly.length + best.actualOnly.length >= 2) ? 'partial' : 'unverified';
  const missing = ['Planning\'s own activity list and scope (which work orders / activities are counted)', 'budgeted man-hours or weights per activity (the tracker has P6 durations only)',
    'the reporting cutoff time of each figure', 'the completion rule for a running activity (0 %, 50 %, measured)', recs.length < 2 ? `at least two dated Planning figures (${recs.length} held)` : ''].filter(Boolean);
  const identical = recs.filter((r) => r.planned === r.actual).length;
  const note = !recs.length ? 'No Planning figure stored yet.'
    : status === 'verified' ? `Method ${best.code} (${best.name}) reproduces ${best.dates.length} dated figures within ${tolerancePts} pts.`
    : status === 'partial' ? `Method ${best.code} (${best.name}) reproduces ${best.dates.length ? `one date` : `only one of the two figures`}: not proof of the method.`
    : `No candidate reproduces the reported figures from the tracker's P6 data: the official method or its inputs are not in this system.${identical === recs.length ? ' Planned and actual are identical in every record: they may be one figure copied, rounded, or a manually adjusted value; this is not evidence of a perfect schedule.' : ''}`;
  return { status, matches: matches.filter((m) => m.name), checked: recs.length, missing, note };
}

export interface PlanningView { latest: PlanningRecord | null; variance: number | null; history: { date: string; planned: number; actual: number; variance: number; dPlanned: number | null; dActual: number | null; source: string; revision: number }[] }
/** The daily history as shown: one row per report date (the latest revision), the change since the previous day. */
export function planningView(records: PlanningRecord[]): PlanningView {
  const latest = new Map<string, PlanningRecord>();
  for (const r of [...records].sort((a, b) => a.revision - b.revision)) latest.set(r.reportDate, r);
  const rows = [...latest.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  const history = rows.map((r, i) => ({ date: r.reportDate, planned: r.planned, actual: r.actual, variance: r2(r.actual - r.planned), dPlanned: i ? r2(r.planned - rows[i - 1].planned) : null, dActual: i ? r2(r.actual - rows[i - 1].actual) : null, source: r.source, revision: r.revision }));
  const last = rows[rows.length - 1] ?? null;
  return { latest: last, variance: last ? r2(last.actual - last.planned) : null, history };
}

/** Why the official figure and the tracker's work progress differ: the known scope and rule differences, in words. */
export function reconciliationNotes(d: TrkData, official: PlanningRecord | null, tracker: { planPct: number; actualPct: number } | null): string[] {
  if (!official || !tracker) return [];
  const ls = planningLines(d); const ops = d.activities.filter((a) => a.tracked && a.group === 'Operations').length;
  const running = ls.filter((a) => a.actualStart && !a.actualFinish).length;
  return [`Tracker ${tracker.actualPct}% vs Planning ${official.actual}% (${r2(tracker.actualPct - official.actual)} pts): different measures, not an error.`,
    `Scope: the tracker weighs ${ls.length} M & I lines by P6 hours and leaves out ${ops} Operations lines and support jobs; Planning's activity list and weights are not held here.`,
    `Running work: the tracker credits a running line only with its measured share (drums) or 0; ${running} line${running === 1 ? '' : 's'} running now. Planning may credit a percentage.`,
    `Cutoff: the tracker reads the moment it is opened; the Planning figure is as of its report${official.cutoff ? ` (${official.cutoff})` : ' (cutoff time not given)'}.`,
    'Baseline: both read the P6 baseline dates; a re-baselined or updated plan at Planning would move its planned %.'];
}
