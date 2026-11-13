// The start-up report for WhatsApp (owner, 13 Nov 2026, design A): the steps grouped into stages so the picture stays
// short (the MPT heat-up steps one row, the two sulfiding stages one row …), each stage's fixed plan against its
// actual / expected times face to face, the variance, and the reason given for the time lost. The plan starts at the
// first step's actual start and runs the standard hours in order; it never moves. Reasons are only those recorded on
// the steps (delay / wait notes, holds); time lost with no reason says so, never guessed.
import { DELAY_MIN_H, reasonLabel } from './stages';

const H = 3_600_000;
const r1 = (x: number) => Math.round(x * 10) / 10;

export interface ReportStep {
  id: string; title: string; stdHours: number | null; status: 'not_started' | 'running' | 'done' | 'not_required';
  startedAt: string | null; doneAt: string | null; kind?: 'step' | 'hold'; expectedDoneAt?: string | null;
  delayReason?: string | null; delayNote?: string | null; waitReason?: string | null; waitNote?: string | null;
}
export type StageState = 'done' | 'run' | 'next';
export interface ReportStage {
  label: string; sub: string; state: StageState; oil: boolean;
  planStart: number | null; planEnd: number | null; start: number | null; end: number | null;
  /** hours the stage ends after (+) or before (−) its plan end */
  varH: number | null; reasons: string[];
}
export interface StartupReport { stages: ReportStage[]; planEnd: number | null; expectedEnd: number | null; varH: number | null; stdTotal: number; done: number; total: number }

type Cls = 'oil' | 'sulf' | 'feed' | 'heat' | 'h2' | 'comp' | 'prep' | null;
const CLASSES: [Exclude<Cls, null>, RegExp, string][] = [
  ['oil', /black\s*oil/i, 'Black oil cut-in'],
  ['sulf', /sul(f|ph)id/i, 'Catalyst sulfiding'],
  ['feed', /feed pump|flushing oil|pre-?wet|fill(ing)? (the )?reactors/i, 'Feed-in & pre-wetting'],
  ['heat', /heat\s?-?up|min(imum)? skin|\bMPT\b|increasing (temp|pressure)/i, 'Heat-up & pressure as per MPT'],
  ['h2', /\bH2\b|hydrogen/i, 'H2 pressure test'],
  ['comp', /compressor|\bC-(12-)?\d01\b/i, 'Recycle gas compressor'],
  ['prep', /vacuum|deblind|\bN2\b|purg|segregat/i, 'Preparation'],
];
export const stepClass = (title: string): Cls => CLASSES.find(([, re]) => re.test(title))?.[0] ?? null;
const shortName = (t: string) => { const s = t.split(/ · | \(| @ /)[0].trim(); return s.length > 30 ? `${s.slice(0, 28)}…` : s; };
const hrs = (h: number) => `${r1(h)} h`;

/** The stages, in order: consecutive steps of one kind merge (a hold stays with the stage it sits in). */
export function startupReport(steps: ReportStep[], now: number): StartupReport {
  const live = steps.filter((s) => s.status !== 'not_required');
  const counted = live.filter((s) => s.kind !== 'hold');
  const starts = counted.map((s) => (s.startedAt ? Date.parse(s.startedAt) : null)).filter((x): x is number => x !== null);
  const t0 = starts.length ? Math.min(...starts) : null;
  // the fixed plan of each step, and its actual / expected times (a step starts when the one before is done, never before now)
  let p = t0; let t = t0; let prevDone: number | null = null;
  type Row = { s: ReportStep; cls: Cls; ps: number | null; pe: number | null; a: number | null; e: number | null; why: string[] };
  const rows: Row[] = [];
  for (const s of live) {
    const a0 = s.startedAt ? Date.parse(s.startedAt) : null, d0 = s.doneAt ? Date.parse(s.doneAt) : null, std = (s.stdHours ?? 0) * H;
    const why: string[] = [];
    if (s.kind === 'hold') {
      const e = s.status === 'done' && d0 !== null ? d0 : now;
      if (a0 !== null) { why.push(`Hold: ${s.title} (${hrs((e - a0) / H)})`); if (t !== null) t = Math.max(t, e); prevDone = s.status === 'done' ? e : null; }
      rows.push({ s, cls: rows.length ? rows[rows.length - 1].cls : null, ps: null, pe: null, a: a0, e: a0 !== null ? e : null, why });
      continue;
    }
    const ps = p, pe = p !== null ? p + std : null; p = pe;
    // waiting before it: the step before done, this one started later (or not yet)
    if (prevDone !== null) {
      const w = ((a0 ?? now) - prevDone) / H;
      if (w >= DELAY_MIN_H && (a0 !== null || s.status === 'not_started')) why.push(`Waited ${hrs(w)} before ${shortName(s.title)}: ${s.waitNote?.trim() || reasonLabel(s.waitReason) || 'no reason given'}`);
    }
    let a: number | null, e: number | null;
    if (s.status === 'done' && a0 !== null && d0 !== null) {
      a = a0; e = d0; const over = (d0 - a0 - std) / H;
      if (s.stdHours != null && over >= DELAY_MIN_H) why.push(`${shortName(s.title)} +${hrs(over)}: ${s.delayNote?.trim() || reasonLabel(s.delayReason) || 'no reason given'}`);
      t = d0; prevDone = d0;
    } else if (s.status === 'running' && a0 !== null) {
      a = a0; e = s.expectedDoneAt ? Math.max(now, Date.parse(s.expectedDoneAt)) : Math.max(a0 + std, now);
      const over = (now - a0 - std) / H;
      if (s.stdHours != null && over >= DELAY_MIN_H) why.push(`${shortName(s.title)} +${hrs(over)} so far: ${s.delayNote?.trim() || reasonLabel(s.delayReason) || 'no reason given'}`);
      t = e; prevDone = null;
    } else {
      a = t !== null ? Math.max(t, now) : null; e = a !== null ? a + std : null; t = e; prevDone = null;
    }
    rows.push({ s, cls: stepClass(s.title), ps, pe, a, e, why });
  }
  // merge consecutive rows of one kind (a step of no known kind is a stage of its own)
  const groups: Row[][] = [];
  for (const r of rows) { const g = groups[groups.length - 1]; if (g && r.cls !== null && g[0].cls === r.cls) g.push(r); else groups.push([r]); }
  const stages = groups.map((g): ReportStage => {
    const st = g.filter((r) => r.s.kind !== 'hold');
    const n = st.length, h = st.reduce((x, r) => x + (r.s.stdHours ?? 0), 0);
    const cls = g[0].cls; const label = n === 1 ? st[0].s.title : CLASSES.find(([c]) => c === cls)?.[2] ?? st[0]?.s.title ?? g[0].s.title;
    const state: StageState = st.every((r) => r.s.status === 'done') ? 'done' : st.some((r) => r.s.status !== 'not_started') ? 'run' : 'next';
    const planStart = st[0]?.ps ?? null, planEnd = st[st.length - 1]?.pe ?? null;
    const start = g.find((r) => r.a !== null)?.a ?? null, end = [...g].reverse().find((r) => r.e !== null)?.e ?? null;
    return { label, sub: n > 1 ? `${n} steps · ${r1(h)} h` : `${r1(h)} h`, state, oil: cls === 'oil', planStart, planEnd, start, end,
      varH: planEnd !== null && end !== null ? r1((end - planEnd) / H) : null, reasons: g.flatMap((r) => r.why) };
  });
  const stdTotal = counted.reduce((x, s) => x + (s.stdHours ?? 0), 0);
  const planEnd = t0 !== null ? t0 + stdTotal * H : null;
  return { stages, planEnd, expectedEnd: t, varH: planEnd !== null && t !== null ? r1((t - planEnd) / H) : null, stdTotal,
    done: counted.filter((s) => s.status === 'done').length, total: counted.length };
}
