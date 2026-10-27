// Today of the progress tracker: the shutdown day on a timeline, the two parts (operations: neutralization and
// handover · M & I: the bar chart and the blinds it installs) with their planned and actual dates, and the late /
// pending / IAT counts. Each card opens its detail; every line in it opens the step, item or page behind it.
import { useMemo, useState } from 'react';
import { equipmentList, lateOrHold, staleItems, stepViews, daysAsHours, CRITICAL_SPARE_D, type MiItem, FO_NAMES, isMisc, attention, focusList, banner, equipBlind, equipViews, kwDay, kwTime, miBlinds, opsResults, phases, pointComplete, neutLabel,
  type Attention, type Banner, type Focus, type NextStep, type EquipView, type StepView, type TrkPoint } from '@/core/tracker';
import type { TrackerData } from '@/data/tracker';
import { BottomSheet, cx } from '@/ui/components';
import { FlagChip } from './ui';
import { PlanningBlock } from './intel/PlanningBlock';

const DAY = 864e5;
const at = (t: number | null) => (t === null || Number.isNaN(t) ? '—' : `${kwDay(new Date(t).toISOString())} ${kwTime(new Date(t).toISOString())}`);
const iso = (s: string | undefined) => (s ? Date.parse(s) : NaN);
const hrs = (x: number) => `${Math.abs(x) >= 10 ? Math.round(Math.abs(x)) : Math.round(Math.abs(x) * 10) / 10} h`;

export type Nav = { tab: 'isolation' | 'equipment' | 'iats' | 'timing' | 'report' | 'guideline'; iso?: 'blind' | 'neut'; lateFirst?: boolean };




const STATE_TONE: Record<Banner['state'], 'green' | 'red' | 'amber'> = { AHEAD: 'green', BEHIND: 'red', ON_PLAN: 'amber' };
const STATE_WORD: Record<Banner['state'], string> = { AHEAD: 'AHEAD', BEHIND: 'BEHIND', ON_PLAN: 'ON PLAN' };

/** The shutdown at a glance (owner, 25 Oct: the situation in 5 seconds, no scrolling): the end, the progress, the 3 items
 *  that set the end, Operations and M & I in one line each, and what needs attention. Each line opens its detail. */
export function ShutdownOverview({ data, now, head = false, onItem, onGo, onDone }: { data: TrackerData; now: number; head?: boolean; onItem: (tag: string) => void; onDone?: (msg: string) => void;
  onGo: (to: 'todo' | 'late' | 'all' | 'ho' | 'hot' | 'focus') => void }) {
  const [sheet, setSheet] = useState<'ops' | 'mi' | null>(null);
  const steps = useMemo(() => stepViews(data, now), [data, now]);
  const eqs = useMemo(() => equipViews(data, now, steps), [data, now, steps]);
  const { ops, mi } = useMemo(() => phases(data, now, steps), [data, now, steps]);
  const s = data.settings; const w = mi.weighted;
  const res = opsResults(data, eqs); const bl = miBlinds(data);
  const start = iso(s.opsStart), miPlan = iso(s.miStart ?? s.hoTarget), end = iso(s.miEnd);
  const day = Math.max(1, Math.floor((now - start) / DAY) + 1), total = Math.round((end - start) / DAY);
  const behind = eqs.filter((e) => e.stage >= 1 && e.plan && e.plan.variance < 0 && e.eq.tracked).sort((a, b) => Number(isMisc(a.eq.group)) - Number(isMisc(b.eq.group)) || a.plan!.variance - b.plan!.variance || b.plan!.days - a.plan!.days);
  const opsBadge = !ops ? null : ops.finishedAt !== null && ops.finishDelayH !== null
    ? { text: ops.finishDelayH <= 0 ? `${hrs(ops.finishDelayH)} early` : `${hrs(ops.finishDelayH)} late`, tone: ops.finishDelayH <= 0 ? 'green' as const : 'red' as const }
    : ops.state === 'NOT_STARTED' ? { text: 'not started', tone: 'grey' as const } : { text: (STATE_WORD[ops.state as Banner['state']] ?? ops.state).toLowerCase(), tone: STATE_TONE[ops.state as Banner['state']] ?? 'grey' };
  // the items that set the end: the least float first (the controlling item, then near critical)
  const top = w ? [...new Map([...(w.controlling ? [w.controlling] : []), ...w.critical, ...w.delays].map((i) => [i.key, i])).values()].sort((a, b) => a.spareD - b.spareD).slice(0, 3) : [];
  const probs = new Set((data.events ?? []).filter((x) => !x.endedAt && x.key).map((x) => x.key));
  const stale = staleItems(data, now).filter((i) => !i.small || ['Pumps / LO', 'PSVs'].includes(i.section)), crit = stale.filter((i) => i.critical).length;
  const lateN = lateOrHold(equipmentList(data, head), eqs).length;
  const lateSteps = head ? [...steps.values()].filter((v) => v.late).length : 0;
  const late = !!w && w.impactD > 0;
  const tone = (t: 'green' | 'red' | 'amber' | 'grey') => (t === 'green' ? 'bg-green-100 text-green-800' : t === 'red' ? 'bg-red-100 text-red-800' : t === 'amber' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600');
  const H3 = ({ children }: { children: React.ReactNode }) => <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{children}</p>;
  const Line = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => <button type="button" onClick={onClick} className="flex min-h-9 w-full items-center gap-2 border-t border-slate-100 py-1 text-left first:border-t-0">{children}<span className="text-sm font-bold text-brand-500">›</span></button>;
  return (
    <div className="mb-2.5 space-y-2">
      {/* 1 · the end */}
      <section className={cx('rounded-2xl border-l-[6px] bg-white p-3 ring-1 ring-slate-200', !w ? 'border-l-slate-300' : late ? 'border-l-status-red' : 'border-l-status-green')}>
        <div className="flex items-baseline justify-between gap-2"><H3>Shutdown end · forecast</H3><span className="flex items-baseline gap-1.5">
          {/* the forecast follows the P6 dates without the activity links: unverified until they are validated */}
          {!s.p6LinksVerified && <span title="P6 activity relationships not validated yet" className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold uppercase text-amber-900">Unverified</span>}
          {total > 0 && <span className="text-[11px] font-semibold text-slate-500">Day {Math.min(day, total)} / {total}</span>}</span></div>
        {w ? <>
          <p className="flex flex-wrap items-baseline gap-x-2"><b className={cx('text-[22px] font-extrabold leading-tight', late ? 'text-status-red' : 'text-brand-700')}>{at(w.estEnd)}</b>
            <span className={cx('rounded-md px-1.5 py-0.5 text-[12px] font-bold', late ? tone('red') : tone('green'))}>{late ? `${daysAsHours(w.impactD)} behind P6` : 'on P6'}</span></p>
          <p className="text-[12px] text-slate-600">P6 {at(w.end)}{w.controlling ? <> · set by <b>{w.controlling.tag}</b>{w.controlling.driving ? ` · ${w.controlling.driving}` : ''}</> : null}</p>
        </> : <p className="text-sm text-slate-600">M &amp; I has not started yet.</p>}
      </section>
      {/* 2 · progress */}
      {w && <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
        <div className="flex items-baseline justify-between gap-2"><H3>M&amp;I work progress · main equipment</H3>
          <span className={cx('text-[12px] font-bold', w.main.physPct >= w.main.planPct ? 'text-status-green' : 'text-status-red')}>{w.main.physPct >= w.main.planPct ? 'on plan' : `${w.main.planPct - w.main.physPct} pts behind`}</span></div>
        <p className="flex items-baseline gap-2"><b className="text-[22px] font-extrabold text-brand-700">{w.main.physPct}%</b><span className="text-[12px] text-slate-600">plan {w.main.planPct}%{w.main.physHiPct > w.main.physPct ? ` · up to ${w.main.physHiPct}%` : ''}</span></p>
        <span className="relative mt-1 block h-2 rounded-full bg-slate-200"><span className={cx('block h-full rounded-full', w.main.physPct >= w.main.planPct ? 'bg-status-green' : 'bg-status-red')} style={{ width: `${Math.min(100, w.main.physPct)}%` }} />
          <span className="absolute -top-1 h-4 w-0.5 bg-slate-900" style={{ left: `${Math.min(100, w.main.planPct)}%` }} /></span>
        {w.small.items > 0 && <p className="mt-1 text-[11px] text-slate-500">Small jobs {w.small.physPct}% · plan {w.small.planPct}%</p>}
      </section>}
      {/* 2b · the official Maintenance Planning figure, apart from the tracker's own progress and forecast */}
      <PlanningBlock d={data} tracker={w ? { planPct: w.main.planPct, actualPct: w.main.physPct } : null} onDone={onDone ?? (() => undefined)} />
      {/* 3 · what sets the end */}
      {top.length > 0 && <section className="rounded-2xl bg-white px-3 py-2 ring-1 ring-slate-200">
        <H3>Critical · setting the end</H3>
        {top.map((i) => <Line key={i.key} onClick={() => onItem(i.tag)}>
          <b className="w-[92px] shrink-0 truncate text-[13px]">{i.tag}{probs.has(i.key) ? ' ⚠' : ''}</b>
          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600">{i.driving ?? i.next ?? `${i.physPct}% / plan ${i.planPct}%`}</span>
          <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', i.spareD < 0 ? tone('red') : i.spareD <= 1 ? tone('amber') : tone('grey'))}>{i.spareD < 0 ? `delays ${daysAsHours(-i.spareD)}` : `${daysAsHours(i.spareD)} float`}</span>
        </Line>)}
      </section>}
      {/* 4 · operations and M & I */}
      <section className="rounded-2xl bg-white px-3 py-1 ring-1 ring-slate-200">
        {ops && res && <Line onClick={() => setSheet('ops')}><b className="w-[92px] shrink-0 text-[13px]">Operations</b>
          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600">HO {res.ho[0]}/{res.ho[1]} · neutralized {res.neut[0]}/{res.neut[1]}</span>
          {opsBadge && <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', tone(opsBadge.tone))}>{opsBadge.text}</span>}</Line>}
        <Line onClick={() => setSheet('mi')}><b className="w-[92px] shrink-0 text-[13px]">M &amp; I</b>
          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600">{mi.actualStart ? `since ${kwDay(new Date(mi.actualStart).toISOString())}` : 'not started'} · blinds {bl.segregation[0] + bl.hp[0] + bl.equipment[0]}/{bl.segregation[1] + bl.hp[1] + bl.equipment[1]}{behind.length ? ` · ${behind.length} behind` : ''}</span>
          {(() => { const st = w?.state ?? mi.banner?.state; return <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold', st ? tone(STATE_TONE[st]) : tone('grey'))}>{st ? STATE_WORD[st].toLowerCase() : 'not started'}</span>; })()}</Line>
      </section>
      {/* 5 · needs attention */}
      {(stale.length > 0 || lateN > 0 || lateSteps > 0) && <section className={cx('rounded-2xl px-3 py-1 ring-1', crit ? 'bg-red-50 ring-red-200' : 'bg-amber-50 ring-amber-200')}>
        {stale.length > 0 && <Line onClick={() => onGo('todo')}><span className="min-w-0 flex-1 text-[13px]"><b className={crit ? 'text-status-red' : 'text-amber-900'}>⏰ {stale.length} without an update</b>{crit ? <span className="text-slate-600"> · {crit} critical</span> : null}</span></Line>}
        {lateN > 0 && <Line onClick={() => onGo('late')}><span className="min-w-0 flex-1 text-[13px]"><b className="text-status-red">{lateN} late or on hold</b><span className="text-slate-600"> · equipment</span></span></Line>}
        {lateSteps > 0 && <Line onClick={() => onGo('focus')}><span className="min-w-0 flex-1 text-[13px]"><b className="text-status-red">{lateSteps} guideline step{lateSteps > 1 ? 's' : ''} late</b><span className="text-slate-600"> · operations</span></span></Line>}
      </section>}
      {sheet === 'ops' && <OpsSheet data={data} eqs={eqs} plan={[start, miPlan]} finished={ops?.finishedAt ?? null} badge={opsBadge?.text ?? ''} onOpen={(a) => { setSheet(null); if (a.kind === 'equipment') onItem(a.ref); else onGo('focus'); }} onNav={(n) => { setSheet(null); onGo(n.tab === 'iats' ? 'hot' : n.tab === 'isolation' ? 'ho' : n.tab === 'equipment' ? (n.lateFirst ? 'late' : 'all') : 'focus'); }} onClose={() => setSheet(null)} />}
      {sheet === 'mi' && <MiSheet data={data} steps={steps} now={now} mi={mi} behind={behind} onOpen={(a) => { setSheet(null); if (a.kind === 'equipment') onItem(a.ref); }} onNav={(n) => { setSheet(null); onGo(n.tab === 'iats' ? 'hot' : n.tab === 'isolation' ? 'ho' : n.tab === 'equipment' ? (n.lateFirst ? 'late' : 'all') : 'focus'); }} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** The operations focus list (late or pending guideline steps and items with their next step), for the Section Head. */
export function FocusList({ data, now, onOpen }: { data: TrackerData; now: number; onOpen: (a: Attention) => void }) {
  const steps = useMemo(() => stepViews(data, now), [data, now]);
  const eqs = useMemo(() => equipViews(data, now, steps), [data, now, steps]);
  const att = attention(steps, eqs);
  return att.length ? <AttentionCard list={focusList(att, eqs, data.activities, data.points)} onOpen={onOpen} /> : <p className="text-sm text-slate-500">Nothing late or pending.</p>;
}

function AttentionCard({ list, onOpen }: { list: Focus[]; onOpen: (a: Attention) => void }) {
  const [all, setAll] = useState(false); const [misc, setMisc] = useState(false);
  const main = list.filter((f) => !f.minor), minor = list.filter((f) => f.minor);
  const shown = all ? main : main.slice(0, 5);
  const row = (f: Focus) => <AttentionRow key={`${f.a.kind}-${f.a.ref}`} a={f.a} next={f.next} onOpen={() => onOpen(f.a)} />;
  return (
    <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      <h2 className="text-xs font-bold uppercase tracking-wide text-status-red">⚠ Focus now · {list.length}</h2>
      <div className="divide-y divide-slate-100">{shown.map(row)}</div>
      {main.length > 5 && <button type="button" onClick={() => setAll((x) => !x)} className="pt-1 text-xs font-semibold text-brand-500">{all ? 'Show less' : `+${main.length - 5} more`}</button>}
      {minor.length > 0 && <>
        <button type="button" onClick={() => setMisc((x) => !x)} className="mt-1 flex w-full items-center gap-1 border-t border-slate-100 pt-2 text-left text-xs font-semibold text-slate-600">
          {misc ? '▾' : '▸'} {minor.length} misc / sub-items ({[...new Set(minor.map((f) => f.a.flag === 'HO_LATE' ? 'not handed over' : f.a.flag === 'PENDING' ? 'pending' : 'late'))].join(', ')})</button>
        {misc && <div className="divide-y divide-slate-100">{minor.map(row)}</div>}
      </>}
    </section>
  );
}

function AttentionRow({ a, next, onOpen }: { a: Attention; next: NextStep | null; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full py-2 text-left">
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{a.label}</span>
        <FlagChip flag={a.flag} />
        {a.detail && <span className="max-w-[40%] truncate text-xs text-slate-600">{a.detail}</span>}
      </span>
      {next && <span className="mt-0.5 flex items-center gap-1 text-[12px] text-brand-500">
        <b className="shrink-0">{next.running ? '▶ Now:' : 'Next:'}</b><span className="min-w-0 flex-1 truncate">{next.text}</span>
        {next.of > 0 && <span className="shrink-0 text-[11px] text-slate-500">{next.n}/{next.of}</span>}<b>›</b>
      </span>}
    </button>
  );
}

const Row = ({ tag, text, chip, chipCls, onClick }: { tag: string; text: string; chip?: string; chipCls?: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left ring-1 ring-slate-200 active:bg-slate-50">
    <b className="w-24 shrink-0 truncate text-[13px]">{tag}</b><span className="min-w-0 flex-1 truncate text-[12px] text-slate-600">{text}</span>
    {chip && <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold', chipCls)}>{chip}</span>}<span className="font-bold text-brand-500">›</span>
  </button>
);
const NavBtn = ({ label, onClick }: { label: string; onClick: () => void }) => <button type="button" onClick={onClick} className="min-h-11 flex-1 rounded-xl bg-brand-100 text-sm font-bold text-brand-600">{label} ›</button>;
const Th = ({ children }: { children: React.ReactNode }) => <th className="px-1 pb-1 text-right text-[10px] font-bold text-slate-500 first:text-left">{children}</th>;

function OpsSheet({ data, eqs, plan, finished, badge, onOpen, onNav, onClose }: { data: TrackerData; eqs: EquipView[]; plan: [number, number]; finished: number | null; badge: string;
  onOpen: (a: { kind: 'step' | 'equipment'; ref: string }) => void; onNav: (n: Nav) => void; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const pts = (data.points ?? []).filter((p) => p.kind === 'neut' && p.beforeHo);
  const items = eqs.filter((e) => e.eq.opsItem && e.eq.tracked);
  const c = (xs: boolean[]) => `${xs.filter(Boolean).length}/${xs.length}`;
  const behind = (xs: boolean[]) => xs.length > 0 && xs.filter(Boolean).length / xs.length < 0.5;
  const open: { key: string; tag: string; text: string; chip: string; cls: string; go: () => void }[] = [
    ...pts.filter((p) => !pointComplete(p)).map((p) => ({ key: p.id, tag: p.ref, text: p.name, chip: neutLabel(p), cls: p.status === 'open' ? 'bg-slate-100 text-slate-600' : 'bg-amber-200 text-amber-950', go: () => onNav({ tab: 'isolation', iso: 'neut' }) })),
    ...items.filter((e) => e.stage === 0).map((e) => ({ key: e.eq.id, tag: e.eq.tag, text: e.eq.hoStep ? `Handover ${e.eq.hoStep}` : 'Not handed over', chip: e.late ? 'HO LATE' : 'not HO', cls: e.late ? 'bg-red-400 text-white' : 'bg-slate-100 text-slate-600', go: () => onOpen({ kind: 'equipment', ref: e.eq.tag }) })),
  ];
  return (
    <BottomSheet open onClose={onClose} title="Operations">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Plan {at(plan[0])} → {at(plan[1])} · Actual {at(plan[0])} → {finished === null ? 'running' : at(finished)} {badge && <b className={badge.includes('EARLY') ? 'text-status-green' : 'text-status-red'}>{badge.toLowerCase()}</b>}</p>
        <table className="w-full text-[13px]">
          <thead><tr><Th>By field operator</Th><Th>Neutralized</Th><Th>Handed over</Th></tr></thead>
          <tbody>
            {Object.entries(FO_NAMES).map(([fo, n]) => { const np = pts.filter((p) => p.fo === fo).map(pointComplete), hi = items.filter((e) => e.eq.fo === fo).map((e) => e.stage >= 1);
              return <tr key={fo} className="border-t border-slate-100"><td className="py-1.5 font-bold">{fo} {n}</td><td className={cx('text-right tabular-nums', behind(np) && 'font-bold text-status-red')}>{c(np)}</td><td className={cx('text-right tabular-nums', behind(hi) && 'font-bold text-status-red')}>{c(hi)}</td></tr>; })}
            <tr className="border-t border-slate-200 font-bold"><td className="py-1.5">Total</td><td className="text-right tabular-nums">{c(pts.map(pointComplete))}</td><td className="text-right tabular-nums">{c(items.map((e) => e.stage >= 1))}</td></tr>
          </tbody>
        </table>
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Still open · {open.length}</p>
        <div className="space-y-1.5">{(all ? open : open.slice(0, 6)).map((o) => <Row key={o.key} tag={o.tag} text={o.text} chip={o.chip} chipCls={o.cls} onClick={o.go} />)}</div>
        {open.length > 6 && !all && <button type="button" onClick={() => setAll(true)} className="w-full rounded-xl py-2 text-sm text-slate-500 ring-1 ring-slate-200">+ {open.length - 6} more</button>}
        <div className="flex gap-2"><NavBtn label="Neutralization" onClick={() => onNav({ tab: 'isolation', iso: 'neut' })} /><NavBtn label="Equipment" onClick={() => onNav({ tab: 'equipment' })} /></div>
      </div>
    </BottomSheet>
  );
}

const pctText = (lo: number, hi: number) => (hi > lo ? `${lo}–${hi}%` : `${lo}%`);
const days = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${daysAsHours(x)}`;
/** An item near the critical path: physical vs plan, schedule variance, float (or the days it delays the end). */
function SpareRow({ i, onClick }: { i: MiItem; onClick: () => void }) {
  return (
    <button type="button" onClick={(x) => { x.stopPropagation(); onClick(); }} className="flex w-full items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-left ring-1 ring-slate-200">
      <span className="min-w-0 flex-1"><b className="text-[13px]">{i.tag}</b> <span className="text-[11px] text-slate-500">{pctText(i.physPct, i.physHiPct)} / plan {i.planPct}% · <span className={i.svD < 0 ? 'text-status-red' : 'text-status-green'}>{days(i.svD)}</span></span>{i.unverified.length > 0 && <span title="unverified" className="font-bold text-amber-600">*</span>}
        <span className="block truncate text-[11px] text-slate-600">Forecast {kwDay(i.forecast)} {kwTime(i.forecast)}{i.driving ? ` · ${i.driving}` : ''}</span></span>
      <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold', i.spareD < 0 ? 'bg-red-600 text-white' : i.spareD <= 1 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900')}>{i.spareD < 0 ? `🔴 delays ${daysAsHours(i.impactD)}` : `${daysAsHours(i.spareD)} float`}</span>
    </button>
  );
}

function MiSheet({ data, steps, now, mi, behind, onOpen, onNav, onClose }: { data: TrackerData; steps: Map<string, StepView>; now: number; mi: ReturnType<typeof phases>['mi']; behind: EquipView[];
  onOpen: (a: { kind: 'step' | 'equipment'; ref: string }) => void; onNav: (n: Nav) => void; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const shifted = useMemo(() => equipViews(data, now, steps).filter((e) => e.stage >= 1), [data, now, steps]);
  const groups = [...[...new Set(shifted.map((e) => e.eq.group))].filter((g) => !isMisc(g)).map((g) => ({ g, b: banner(shifted.filter((e) => e.eq.group === g)) })),
    { g: 'Miscellaneous', b: banner(shifted.filter((e) => isMisc(e.eq.group))) }].filter((x) => x.b.items > 0);
  const pts = (data.points ?? []).filter((p) => p.kind === 'blind');
  const lines = data.activities.filter(equipBlind);
  const blindRow = (label: string, xs: TrkPoint[]) => [label, xs.filter(pointComplete).length, xs.length, xs.filter((p) => p.status === 'out').length] as const;
  const rows = [blindRow('Segregation', pts.filter((p) => p.grp !== 'hp_critical')), blindRow('HP critical (S213)', pts.filter((p) => p.grp === 'hp_critical')),
    ['Equipment', lines.filter((a) => a.actualFinish).length, lines.length, 0] as const];
  return (
    <BottomSheet open onClose={onClose} title="M & I (bar chart)">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Plan {at(mi.planned)} → {at(mi.plannedEnd)} · Actual {at(mi.actualStart)} → {mi.actualStart !== null && mi.estEnd !== null ? <b className={mi.estEnd <= mi.plannedEnd ? 'text-status-green' : 'text-status-red'}>est. {at(mi.estEnd)}</b> : '—'}</p>
        {mi.actualStart !== null && (
          <table className="w-full text-[13px]">
            <thead><tr><Th>By group</Th><Th>Items</Th><Th>Done / plan</Th><Th>{''}</Th></tr></thead>
            <tbody>{groups.map(({ g, b }) => (
              <tr key={g} className="border-t border-slate-100"><td className="py-1.5 font-bold">{g}</td><td className="text-right tabular-nums">{b.items}</td>
                <td className={cx('text-right font-bold tabular-nums', b.state === 'BEHIND' ? 'text-status-red' : b.state === 'AHEAD' ? 'text-status-green' : 'text-slate-700')}>{b.actualPct}% / {b.planPct}%</td>
                <td className="w-24 pl-2"><span className="relative block h-1.5 rounded-full bg-slate-200"><span className={cx('block h-full rounded-full', b.state === 'BEHIND' ? 'bg-status-red' : 'bg-status-green')} style={{ width: `${b.actualPct}%` }} /><span className="absolute -top-1 h-3.5 w-0.5 bg-slate-900" style={{ left: `${b.planPct}%` }} /></span></td></tr>))}
            </tbody>
          </table>
        )}
        {mi.weighted && mi.weighted.critical.length > 0 && <>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Near critical · {CRITICAL_SPARE_D * 24} h float or less</p>
          <div className="space-y-1">{mi.weighted.critical.map((i) => <SpareRow key={i.key} i={i} onClick={() => onOpen({ kind: 'equipment', ref: i.tag })} />)}</div>
        </>}
        {mi.weighted && mi.weighted.support[1] > 0 && <p className="text-xs text-slate-600">Support jobs (not on an item, not in the %): <b>{mi.weighted.support[0]}/{mi.weighted.support[1]}</b> done</p>}
        {mi.weighted && <MiItems items={mi.weighted.items} onOpen={(tag) => onOpen({ kind: 'equipment', ref: tag })} />}
        <div className="space-y-1 text-[11px] text-slate-500">
          <p><b>Physical %</b>: finished lines 100%, running drums by the drums removed, running work with no measure only in the "up to" range. Weight = P6 hours (provisional until weights are approved).</p>
          <p><b>Forecast</b>: the remaining lines laid forward from now — drums at the measured rate, the rest at their P6 duration; parallel lines overlap and a late line moves only what follows it. <b>Variance</b> = P6 finish − forecast. <b>Float</b> = M &amp; I end − forecast; below 0 it delays the shutdown.</p>
          <p className="text-amber-700">Unverified: the P6 links and float are not imported, so the order is taken from the P6 dates.</p>
        </div>
        <table className="w-full text-[13px]">
          <thead><tr><Th>Blinds installed</Th><Th>In</Th><Th>Open</Th><Th>Out</Th></tr></thead>
          <tbody>{rows.map(([l, i, t, o]) => <tr key={l} className="border-t border-slate-100"><td className="py-1.5 font-bold">{l}</td><td className={cx('text-right tabular-nums', t > 0 && i === 0 && 'font-bold text-status-red')}>{i}/{t}</td><td className="text-right tabular-nums">{t - i}</td><td className="text-right tabular-nums">{o}</td></tr>)}</tbody>
        </table>
        {behind.length > 0 && <>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Behind plan · most first</p>
          <div className="space-y-1.5">{(all ? behind : behind.slice(0, 5)).map((e) => <Row key={e.eq.tag} tag={e.eq.tag} text={e.eq.description ?? ''} chip={`−${-e.plan!.variance}${e.plan!.days ? ` · ${daysAsHours(e.plan!.days)}` : ''}`} chipCls="bg-red-100 text-red-800" onClick={() => onOpen({ kind: 'equipment', ref: e.eq.tag })} />)}</div>
          {behind.length > 5 && !all && <button type="button" onClick={() => setAll(true)} className="w-full rounded-xl py-2 text-sm text-slate-500 ring-1 ring-slate-200">+ {behind.length - 5} more</button>}
        </>}
        <div className="flex gap-2"><NavBtn label="Blinds" onClick={() => onNav({ tab: 'isolation', iso: 'blind' })} /><NavBtn label="Equipment" onClick={() => onNav({ tab: 'equipment', lateFirst: true })} /><NavBtn label="Timing" onClick={() => onNav({ tab: 'timing' })} /></div>
      </div>
    </BottomSheet>
  );
}



/** Every item: the three indicators, latest forecast first; small jobs behind a toggle. */
function MiItems({ items, onOpen }: { items: MiItem[]; onOpen: (tag: string) => void }) {
  const [small, setSmall] = useState(false);
  const xs = items.filter((i) => i.done < i.lines && (small || !i.small)).sort((a, b) => b.forecast - a.forecast);
  return (
    <div>
      <div className="flex items-center justify-between"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Equipment · latest forecast first</p>
        <button type="button" onClick={() => setSmall((x) => !x)} className="text-[11px] font-semibold text-brand-500">{small ? 'Main only' : '+ small jobs'}</button></div>
      <table className="mt-1 w-full whitespace-nowrap text-[12px]">
        <thead><tr className="text-[11px] text-slate-500"><th className="text-left font-semibold">Item</th><th className="text-right font-semibold">Physical / plan</th><th className="text-right font-semibold">vs P6</th><th className="text-right font-semibold">Forecast</th><th className="text-right font-semibold">Float</th></tr></thead>
        <tbody>{xs.map((i) => (
          <tr key={i.key} onClick={() => onOpen(i.tag)} className="cursor-pointer border-t border-slate-100">
            <td className="whitespace-normal py-1 font-bold">{i.tag}{i.unverified.length > 0 && <span title={i.unverified.join('\n')} className="ml-0.5 text-amber-600">*</span>}</td>
            <td className="text-right tabular-nums">{pctText(i.physPct, i.physHiPct)} / {i.planPct}%</td>
            <td className={cx('pl-2 text-right tabular-nums', i.svD < 0 ? 'text-status-red' : 'text-status-green')}>{days(i.svD)}</td>
            <td className="pl-2 text-right tabular-nums">{kwDay(i.forecast).replace(/^\w+,? /, '')} {kwTime(i.forecast)}</td>
            <td className={cx('pl-2 text-right font-bold tabular-nums', i.spareD < 0 ? 'text-status-red' : i.spareD <= CRITICAL_SPARE_D ? 'text-amber-700' : 'text-slate-600')}>{i.spareD < 0 ? `−${i.impactD}` : i.spareD}</td>
          </tr>))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-slate-500">* unverified: work running with no measure, or a P6 start passed with no start recorded (open the item).</p>
    </div>
  );
}
