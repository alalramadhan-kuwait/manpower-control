// One shutdown, one page (owner, 28 Oct 2026): the start-up steps against their standard hours, and each unit
// section's run record (down and running periods) from the Calendar shutdowns. Display only: no plan is changed.
const H = 3_600_000;
const DAY = 86_400_000;
const r1 = (x: number) => Math.round(x * 10) / 10;

export interface StdStep { id: string; stdHours: number | null; status: 'not_started' | 'running' | 'done' | 'not_required'; startedAt: string | null; doneAt: string | null }
export interface StdStepView { id: string; planStart: number | null; planEnd: number | null; actualH: number | null; overH: number | null; late: boolean }

/**
 * Each step's plan, one after another by its standard hours, re-planned on the actual times: a step starts when the
 * one before it was done (or, while that one runs, at its start + standard, never before now); the first from the stage
 * start. A step not required takes none. Actual hours run from its start to its done time (or now while running);
 * over = actual − standard. Late: not started after its planned start, or running past its planned end.
 */
export function stdTimeline(steps: StdStep[], stageStart: number | null, now: number): StdStepView[] {
  let t = stageStart;
  return steps.map((s) => {
    const a = s.startedAt ? Date.parse(s.startedAt) : null; const b = s.doneAt ? Date.parse(s.doneAt) : s.status === 'running' ? now : null;
    const actualH = a !== null && b !== null && b >= a ? r1((b - a) / H) : null;
    const overH = actualH !== null && s.stdHours !== null ? r1(actualH - s.stdHours) : null;
    const std = (s.stdHours ?? 0) * H;
    if (s.status === 'not_required') return { id: s.id, planStart: t, planEnd: t, actualH, overH, late: false };
    const planStart = t;
    let planEnd: number | null;
    if (s.status === 'done') { planEnd = t !== null ? t + std : null; if (s.doneAt) t = Date.parse(s.doneAt); }
    else if (s.status === 'running' && a !== null) { planEnd = a + std; t = Math.max(planEnd, now); }
    else { planEnd = t !== null ? Math.max(t, now) + std : null; t = planEnd; }
    const late = (s.status === 'not_started' && planStart !== null && now > planStart) || (s.status === 'running' && planEnd !== null && now > planEnd);
    return { id: s.id, planStart, planEnd, actualH, overH, late };
  });
}

/** The stage in figures: standard hours in all, done / counted steps, actual start and finish when known. */
export function stageSummary(steps: StdStep[]): { stdH: number; done: number; total: number; startedAt: number | null; finishedAt: number | null } {
  const counted = steps.filter((s) => s.status !== 'not_required');
  const starts = counted.map((s) => (s.startedAt ? Date.parse(s.startedAt) : null)).filter((x): x is number => x !== null);
  const done = counted.filter((s) => s.status === 'done').length;
  const ends = counted.map((s) => (s.doneAt ? Date.parse(s.doneAt) : null)).filter((x): x is number => x !== null);
  return { stdH: r1(counted.reduce((n, s) => n + (s.stdHours ?? 0), 0)), done, total: counted.length,
    startedAt: starts.length ? Math.min(...starts) : null, finishedAt: counted.length && done === counted.length && ends.length ? Math.max(...ends) : null };
}

// ── Run record ──────────────────────────────────────────────────────────────────────────────────────────────
export interface DownEvent { id: string; title: string; unitCodes: string[]; start: string; end: string; tentative?: boolean }
export interface RunPeriod { kind: 'down' | 'run'; start: string; end: string | null; days: number; eventId: string | null; title: string | null }
const day = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const iso = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

/**
 * A section's record up to today, newest first: each shutdown that took it down (past or running; tentative and
 * future ones are not record) and the running time between two of them. Overlapping shutdowns join into one down
 * period. Running before the first recorded shutdown is not known, so it is not shown.
 */
export function runRecord(events: DownEvent[], code: string, today: string): RunPeriod[] {
  const t = day(today);
  const downs = events.filter((e) => e.unitCodes.includes(code) && !e.tentative && day(e.start) <= t).sort((a, b) => a.start.localeCompare(b.start));
  const merged: { s: number; e: number; ids: string[]; titles: string[] }[] = [];
  for (const e of downs) {
    const s = day(e.start), en = day(e.end); const last = merged[merged.length - 1];
    if (last && s <= last.e + 1) { last.e = Math.max(last.e, en); last.ids.push(e.id); last.titles.push(e.title); }
    else merged.push({ s, e: en, ids: [e.id], titles: [e.title] });
  }
  const out: RunPeriod[] = [];
  merged.forEach((m, i) => {
    const running = m.e >= t;
    out.push({ kind: 'down', start: iso(m.s), end: running ? null : iso(m.e), days: (running ? t : m.e) - m.s + 1, eventId: m.ids[m.ids.length - 1], title: [...new Set(m.titles)].join(' + ') });
    if (!running) {
      const next = merged[i + 1]; const until = next ? next.s - 1 : t;
      if (until > m.e) out.push({ kind: 'run', start: iso(m.e + 1), end: next ? iso(until) : null, days: until - m.e, eventId: null, title: null });
    }
  });
  return out.reverse();
}

/** The procedure numbers in a step's procedure text: "SOP-12-2004/2009" is SOP-12-2004 and SOP-12-2009. */
export function sopRefs(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? '').matchAll(/SOP-(\d{2})-(\d{4})((?:\s*[/,&]\s*\d{4})*)/gi)) {
    out.push(`SOP-${m[1]}-${m[2]}`);
    for (const n of m[3].match(/\d{4}/g) ?? []) out.push(`SOP-${m[1]}-${n}`);
  }
  return [...new Set(out)];
}

// ── Start-up against its plan ───────────────────────────────────────────────────────────────────────────────
export type DelayReason = 'equipment' | 'maintenance' | 'process' | 'safety' | 'other';
export const DELAY_REASONS: { key: DelayReason; label: string }[] = [
  { key: 'equipment', label: 'Equipment problem' }, { key: 'maintenance', label: 'Waiting on Maintenance' }, { key: 'process', label: 'Process conditions' },
  { key: 'safety', label: 'Safety hold' }, { key: 'other', label: 'Other' }];
export const reasonLabel = (k: string | null | undefined) => DELAY_REASONS.find((r) => r.key === k)?.label ?? null;
/** Less than this is not a delay worth a reason (hours). */
export const DELAY_MIN_H = 0.25;

export interface VsPlan {
  /** the first step's actual start, the plan end (start + all standard hours, fixed), the end expected now */
  start: number | null; planEnd: number | null; expectedEnd: number | null; finished: boolean;
  /** behind (+) or ahead (−) of the plan end, and what makes it up: steps longer than standard, waiting between steps */
  behindH: number | null; overH: number; waitH: number;
  /** each step's own: hours over its standard, hours waited before it (still waiting: up to now) */
  over: Map<string, number>; wait: Map<string, number>;
  /** progress by standard hours (steps done, a running step up to its standard) against the plan at this moment */
  actualPct: number; planPct: number;
}

/**
 * The start-up against its plan. The plan starts with the first step's actual start and lasts the standard hours of
 * every step (a step not required counts none); it never moves. The expected end follows the actual times (a step
 * after the one before it, never before now). The time behind splits into steps over standard and waiting time
 * between steps (the previous step done, the next not started).
 */
export function startupVsPlan(steps: (StdStep & { seq?: number })[], now: number): VsPlan {
  const counted = steps.filter((s) => s.status !== 'not_required');
  const starts = counted.map((s) => (s.startedAt ? Date.parse(s.startedAt) : null)).filter((x): x is number => x !== null);
  const start = starts.length ? Math.min(...starts) : null;
  const stdTotal = counted.reduce((n, s) => n + (s.stdHours ?? 0), 0);
  const over = new Map<string, number>(); const wait = new Map<string, number>();
  let t = start; let prevDone: number | null = null; let doneStd = 0;
  for (const s of counted) {
    const a = s.startedAt ? Date.parse(s.startedAt) : null; const d = s.doneAt ? Date.parse(s.doneAt) : null; const std = s.stdHours ?? 0;
    if (prevDone !== null) { const w = ((a ?? now) - prevDone) / H; if (w >= DELAY_MIN_H && (a !== null || s.status === 'not_started')) wait.set(s.id, r1(w)); }
    if (s.status === 'done' && a !== null && d !== null) { const o = (d - a) / H - std; if (o >= DELAY_MIN_H) over.set(s.id, r1(o)); doneStd += std; t = d; prevDone = d; }
    else if (s.status === 'running' && a !== null) { const o = (now - a) / H - std; if (o >= DELAY_MIN_H) over.set(s.id, r1(o)); doneStd += Math.min(std, (now - a) / H); t = Math.max(a + std * H, now); prevDone = null; }
    else { if (t !== null) t = Math.max(t, now) + std * H; prevDone = null; }
  }
  const finished = counted.length > 0 && counted.every((s) => s.status === 'done');
  const planEnd = start !== null ? start + stdTotal * H : null;
  const sum = (m: Map<string, number>) => r1([...m.values()].reduce((n, x) => n + x, 0));
  return { start, planEnd, expectedEnd: start !== null ? t : null, finished, behindH: planEnd !== null && t !== null ? r1((t - planEnd) / H) : null,
    overH: sum(over), waitH: sum(wait), over, wait,
    actualPct: stdTotal ? Math.round((doneStd / stdTotal) * 100) : 0,
    planPct: start !== null && stdTotal ? Math.round(Math.min(1, Math.max(0, (now - start) / (stdTotal * H))) * 100) : 0 };
}
