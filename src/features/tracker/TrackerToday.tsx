// Today of the progress tracker: the shutdown day on a timeline, the two parts (operations: neutralization and
// handover · M & I: the bar chart and the blinds it installs) with their planned and actual dates, and the late /
// pending / IAT counts. Each card opens its detail; every line in it opens the step, item or page behind it.
import { useMemo, useState } from 'react';
import { FO_NAMES, isMisc, attention, focusList, banner, equipBlind, equipViews, kwDay, kwTime, miBlinds, opsResults, phases, pointComplete, totals, NEUT_LABEL,
  type Attention, type Banner, type Focus, type NextStep, type EquipView, type StepView, type TrkPoint } from '@/core/tracker';
import type { TrackerData } from '@/data/tracker';
import { BottomSheet, cx } from '@/ui/components';
import { FlagChip, Tile } from './ui';

const DAY = 864e5;
const at = (t: number | null) => (t === null || Number.isNaN(t) ? '—' : `${kwDay(new Date(t).toISOString())} ${kwTime(new Date(t).toISOString())}`);
const iso = (s: string | undefined) => (s ? Date.parse(s) : NaN);
const hrs = (x: number) => (Math.abs(x) >= 24 ? `${Math.round(Math.abs(x) / 2.4) / 10} d` : `${Math.round(Math.abs(x) * 10) / 10} h`);

export type Nav = { tab: 'isolation' | 'equipment' | 'timing' | 'report' | 'guideline'; iso?: 'blind' | 'neut'; lateFirst?: boolean };

function Bar({ label, v, onClick }: { label: string; v: [number, number]; onClick?: () => void }) {
  const pct = v[1] ? Math.round((v[0] / v[1]) * 100) : 0;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick?.(); }} className="block w-full pt-1.5 text-left">
      <span className="flex justify-between text-[13px] text-slate-700"><span>{label}</span><b className="tabular-nums text-slate-900">{v[0]}/{v[1]}</b></span>
      <span className="mt-1 block h-2 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-[#0850A0]" style={{ width: `${pct}%` }} /></span>
    </button>
  );
}

/** Plan and actual start / end, an actual earlier than the plan in green, later in red. */
function Dates({ plan, actual, endLabel = 'End' }: { plan: [number, number]; actual: [number | null, number | null, boolean?]; endLabel?: string }) {
  const tone = (a: number | null, p: number) => (a === null || Number.isNaN(p) ? 'text-slate-900' : a <= p ? 'text-[#08A048]' : 'text-[#E02028]');
  return (
    <div className="mt-1.5 grid grid-cols-[3.2rem_1fr_1fr] gap-x-2 text-[12.5px] text-slate-700">
      <span /><span className="text-[10px] font-bold uppercase text-slate-400">Start</span><span className="text-[10px] font-bold uppercase text-slate-400">{endLabel}</span>
      <span>Plan</span><span>{at(plan[0])}</span><span>{at(plan[1])}</span>
      <span>Actual</span><b className={tone(actual[0], plan[0])}>{at(actual[0])}</b><b className={tone(actual[1], plan[1])}>{actual[1] === null ? '—' : `${actual[2] ? 'est. ' : ''}${at(actual[1])}`}</b>
    </div>
  );
}

function Head({ dot, title, badge, tone }: { dot: string; title: string; badge: string; tone: 'green' | 'red' | 'amber' | 'grey' }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cx('h-3 w-3 rounded-full', dot)} />
      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</span>
      <span className={cx('ml-auto rounded-md px-2 py-0.5 text-[11px] font-bold', tone === 'green' ? 'bg-green-100 text-green-800' : tone === 'red' ? 'bg-red-100 text-red-800' : tone === 'amber' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600')}>{badge}</span>
      <span className="text-sm font-bold text-[#0850A0]">›</span>
    </div>
  );
}

const STATE_TONE: Record<Banner['state'], 'green' | 'red' | 'amber'> = { AHEAD: 'green', BEHIND: 'red', ON_PLAN: 'amber' };
const STATE_WORD: Record<Banner['state'], string> = { AHEAD: 'AHEAD', BEHIND: 'BEHIND', ON_PLAN: 'ON PLAN' };

export function TodayTab({ steps, eqs, data, now, onOpen, onNav }: { steps: Map<string, StepView>; eqs: EquipView[]; data: TrackerData; now: number;
  onOpen: (a: { kind: 'step' | 'equipment'; ref: string }) => void; onNav: (n: Nav) => void }) {
  const [sheet, setSheet] = useState<'ops' | 'mi' | null>(null);
  const { ops, mi } = phases(data, now, steps);
  const s = data.settings;
  const tot = totals(steps, eqs, data.iats); const att = attention(steps, eqs);
  const res = opsResults(data, eqs); const bl = miBlinds(data);
  const start = iso(s.opsStart), miPlan = iso(s.miStart ?? s.hoTarget), end = iso(s.miEnd);
  const span = end - start;
  const day = Math.max(1, Math.floor((now - start) / DAY) + 1), days = Math.round(span / DAY);
  const pos = (t: number) => `${Math.min(100, Math.max(0, ((t - start) / span) * 100))}%`;
  // the main items first, the miscellaneous ones (CV shells, PSVs, check valves …) after them
  // M & I behind: the items handed over to it, measured from their own handover
  const behind = eqs.filter((e) => e.stage >= 1 && e.plan && e.plan.variance < 0 && e.eq.tracked).sort((a, b) => Number(isMisc(a.eq.group)) - Number(isMisc(b.eq.group)) || a.plan!.variance - b.plan!.variance || b.plan!.days - a.plan!.days);
  const go = (n: Nav) => { setSheet(null); onNav(n); };
  const open = (a: { kind: 'step' | 'equipment'; ref: string }) => { setSheet(null); onOpen(a); };
  const opsBadge = !ops ? null : ops.finishedAt !== null && ops.finishDelayH !== null
    ? { text: ops.finishDelayH <= 0 ? `${hrs(ops.finishDelayH)} EARLY` : `${hrs(ops.finishDelayH)} LATE`, tone: ops.finishDelayH <= 0 ? 'green' as const : 'red' as const }
    : ops.state === 'NOT_STARTED' ? { text: 'NOT STARTED', tone: 'grey' as const } : { text: STATE_WORD[ops.state as Banner['state']] ?? ops.state, tone: STATE_TONE[ops.state as Banner['state']] ?? 'grey' };
  return (
    <div className="space-y-3">
      {!Number.isNaN(span) && span > 0 && (
        <button type="button" onClick={() => onNav({ tab: 'report' })} className="block w-full rounded-2xl bg-white p-3 text-left ring-1 ring-slate-200">
          <span className="flex items-baseline justify-between"><b className="text-lg text-slate-900">Day {Math.min(day, days)} / {days}</b><span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{kwDay(new Date(now).toISOString())}</span></span>
          <span className="relative mt-3 block h-3 rounded-full bg-[#c7d7ee]">
            <span className="absolute inset-y-0 left-0 rounded-l-full bg-[#08A048]" style={{ width: pos(mi.actualStart ?? Math.min(now, miPlan)) }} />
            {mi.actualStart !== null && <span className="absolute inset-y-0 bg-[#0850A0]" style={{ left: pos(mi.actualStart), width: `calc(${pos(now)} - ${pos(mi.actualStart)})` }} />}
            <span className="absolute -top-1.5 h-6 w-0.5 bg-[#E02028]" style={{ left: pos(now) }} />
          </span>
          <span className="mt-1.5 flex justify-between text-[11px] text-slate-500"><span>Ops {kwDay(s.opsStart ?? '')}</span><span>M &amp; I {kwDay(s.miStart ?? s.hoTarget ?? '')}</span><span>{kwDay(s.miEnd ?? '')}</span></span>
        </button>
      )}

      {ops && res && (
        <div role="button" tabIndex={0} onClick={() => setSheet('ops')} onKeyDown={(e) => e.key === 'Enter' && setSheet('ops')} className="cursor-pointer rounded-2xl bg-white p-3 ring-1 ring-slate-200 active:scale-[0.99]">
          <Head dot={opsBadge?.tone === 'red' ? 'bg-[#E02028]' : 'bg-[#08A048]'} title="Operations" badge={opsBadge?.text ?? ''} tone={opsBadge?.tone ?? 'grey'} />
          <Dates plan={[start, miPlan]} actual={[now >= start ? start : null, ops.finishedAt]} endLabel={`End (${mi.critical.map((c) => c.tag.replace('R-12-', 'R-')).join(', ') || 'critical'} HO)`} />
          <Bar label="Neutralized" v={res.neut} onClick={() => onNav({ tab: 'isolation', iso: 'neut' })} />
          <Bar label="Handed over" v={res.ho} onClick={() => onNav({ tab: 'equipment' })} />
        </div>
      )}

      <div role="button" tabIndex={0} onClick={() => setSheet('mi')} onKeyDown={(e) => e.key === 'Enter' && setSheet('mi')} className="cursor-pointer rounded-2xl bg-white p-3 ring-1 ring-slate-200 active:scale-[0.99]">
        <Head dot={mi.banner?.state === 'BEHIND' ? 'bg-[#E02028]' : mi.banner ? 'bg-[#08A048]' : 'bg-slate-400'} title="M & I" badge={mi.banner ? STATE_WORD[mi.banner.state] : 'NOT STARTED'} tone={mi.banner ? STATE_TONE[mi.banner.state] : 'grey'} />
        <Dates plan={[mi.planned, mi.plannedEnd]} actual={[mi.actualStart, mi.actualStart !== null ? mi.estEnd : null, true]} />
        {mi.banner && (
          <div className="pt-1.5">
            <span className="flex justify-between text-[13px] text-slate-700"><span>Done</span><span><b className="text-slate-900">{mi.banner.actualPct}%</b> <span className="font-semibold text-slate-500">/ plan {mi.banner.planPct}%</span></span></span>
            <span className="relative mt-1 block h-2 rounded-full bg-slate-200">
              <span className={cx('block h-full rounded-full', mi.banner.state === 'BEHIND' ? 'bg-[#E02028]' : 'bg-[#08A048]')} style={{ width: `${mi.banner.actualPct}%` }} />
              <span className="absolute -top-1 h-4 w-0.5 bg-slate-900" style={{ left: `${mi.banner.planPct}%` }} />
            </span>
          </div>
        )}
        <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">Blinds installed</p>
        <Bar label="Segregation" v={bl.segregation} onClick={() => onNav({ tab: 'isolation', iso: 'blind' })} />
        <Bar label="HP critical" v={bl.hp} onClick={() => onNav({ tab: 'isolation', iso: 'blind' })} />
        <Bar label="Equipment" v={bl.equipment} onClick={() => onNav({ tab: 'isolation', iso: 'blind' })} />
        {behind.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1.5">
          {behind.slice(0, 3).map((e) => <button key={e.eq.tag} type="button" onClick={(x) => { x.stopPropagation(); onOpen({ kind: 'equipment', ref: e.eq.tag }); }} className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">{e.eq.tag} −{-e.plan!.variance}</button>)}
          {behind.length > 3 && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">+{behind.length - 3}</span>}
        </div>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Tile value={tot.late} label="late" tone={tot.late ? 'red' : undefined} onClick={() => onNav({ tab: 'equipment', lateFirst: true })} />
        <Tile value={tot.pending} label="pending" tone={tot.pending ? 'amber' : undefined} onClick={() => onNav({ tab: 'equipment', lateFirst: true })} />
        <Tile value={tot.iatOpen} label="IAT open" tone={tot.iatOpen ? 'amber' : undefined} onClick={() => onNav({ tab: 'equipment', lateFirst: true })} />
      </div>
      {att.length > 0 && <AttentionCard list={focusList(att, eqs, data.activities, data.points)} onOpen={onOpen} />}

      {sheet === 'ops' && <OpsSheet data={data} eqs={eqs} plan={[start, miPlan]} finished={ops?.finishedAt ?? null} badge={opsBadge?.text ?? ''} onOpen={open} onNav={go} onClose={() => setSheet(null)} />}
      {sheet === 'mi' && <MiSheet data={data} steps={steps} now={now} mi={mi} behind={behind} onOpen={open} onNav={go} onClose={() => setSheet(null)} />}
    </div>
  );
}

function AttentionCard({ list, onOpen }: { list: Focus[]; onOpen: (a: Attention) => void }) {
  const [all, setAll] = useState(false); const [misc, setMisc] = useState(false);
  const main = list.filter((f) => !f.minor), minor = list.filter((f) => f.minor);
  const shown = all ? main : main.slice(0, 5);
  const row = (f: Focus) => <AttentionRow key={`${f.a.kind}-${f.a.ref}`} a={f.a} next={f.next} onOpen={() => onOpen(f.a)} />;
  return (
    <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-200">
      <h2 className="text-xs font-bold uppercase tracking-wide text-[#E02028]">⚠ Focus now · {list.length}</h2>
      <div className="divide-y divide-slate-100">{shown.map(row)}</div>
      {main.length > 5 && <button type="button" onClick={() => setAll((x) => !x)} className="pt-1 text-xs font-semibold text-[#0850A0]">{all ? 'Show less' : `+${main.length - 5} more`}</button>}
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
      {next && <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-[#0850A0]">
        <b className="shrink-0">{next.running ? '▶ Now:' : 'Next:'}</b><span className="min-w-0 flex-1 truncate">{next.text}</span>
        {next.of > 0 && <span className="shrink-0 text-[11px] text-slate-500">{next.n}/{next.of}</span>}<b>›</b>
      </span>}
    </button>
  );
}

const Row = ({ tag, text, chip, chipCls, onClick }: { tag: string; text: string; chip?: string; chipCls?: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left ring-1 ring-slate-200 active:bg-slate-50">
    <b className="w-24 shrink-0 truncate text-[13px]">{tag}</b><span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-600">{text}</span>
    {chip && <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold', chipCls)}>{chip}</span>}<span className="font-bold text-[#0850A0]">›</span>
  </button>
);
const NavBtn = ({ label, onClick }: { label: string; onClick: () => void }) => <button type="button" onClick={onClick} className="min-h-11 flex-1 rounded-xl bg-[#D6E6F5] text-sm font-bold text-[#004080]">{label} ›</button>;
const Th = ({ children }: { children: React.ReactNode }) => <th className="px-1 pb-1 text-right text-[10.5px] font-bold text-slate-500 first:text-left">{children}</th>;

function OpsSheet({ data, eqs, plan, finished, badge, onOpen, onNav, onClose }: { data: TrackerData; eqs: EquipView[]; plan: [number, number]; finished: number | null; badge: string;
  onOpen: (a: { kind: 'step' | 'equipment'; ref: string }) => void; onNav: (n: Nav) => void; onClose: () => void }) {
  const [all, setAll] = useState(false);
  const pts = (data.points ?? []).filter((p) => p.kind === 'neut' && p.beforeHo);
  const items = eqs.filter((e) => e.eq.opsItem && e.eq.tracked);
  const c = (xs: boolean[]) => `${xs.filter(Boolean).length}/${xs.length}`;
  const behind = (xs: boolean[]) => xs.length > 0 && xs.filter(Boolean).length / xs.length < 0.5;
  const open: { key: string; tag: string; text: string; chip: string; cls: string; go: () => void }[] = [
    ...pts.filter((p) => !pointComplete(p)).map((p) => ({ key: p.id, tag: p.ref, text: p.name, chip: NEUT_LABEL[p.status], cls: p.status === 'open' ? 'bg-slate-100 text-slate-600' : 'bg-[#FFE699] text-amber-950', go: () => onNav({ tab: 'isolation', iso: 'neut' }) })),
    ...items.filter((e) => e.stage === 0).map((e) => ({ key: e.eq.id, tag: e.eq.tag, text: e.eq.hoStep ? `Handover ${e.eq.hoStep}` : 'Not handed over', chip: e.late ? 'HO LATE' : 'not HO', cls: e.late ? 'bg-[#E06666] text-white' : 'bg-slate-100 text-slate-600', go: () => onOpen({ kind: 'equipment', ref: e.eq.tag }) })),
  ];
  return (
    <BottomSheet open onClose={onClose} title="Operations">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Plan {at(plan[0])} → {at(plan[1])} · Actual {at(plan[0])} → {finished === null ? 'running' : at(finished)} {badge && <b className={badge.includes('EARLY') ? 'text-[#08A048]' : 'text-[#E02028]'}>{badge.toLowerCase()}</b>}</p>
        <table className="w-full text-[13px]">
          <thead><tr><Th>By field operator</Th><Th>Neutralized</Th><Th>Handed over</Th></tr></thead>
          <tbody>
            {Object.entries(FO_NAMES).map(([fo, n]) => { const np = pts.filter((p) => p.fo === fo).map(pointComplete), hi = items.filter((e) => e.eq.fo === fo).map((e) => e.stage >= 1);
              return <tr key={fo} className="border-t border-slate-100"><td className="py-1.5 font-bold">{fo} {n}</td><td className={cx('text-right tabular-nums', behind(np) && 'font-bold text-[#E02028]')}>{c(np)}</td><td className={cx('text-right tabular-nums', behind(hi) && 'font-bold text-[#E02028]')}>{c(hi)}</td></tr>; })}
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
        <p className="text-xs text-slate-500">Plan {at(mi.planned)} → {at(mi.plannedEnd)} · Actual {at(mi.actualStart)} → {mi.actualStart !== null && mi.estEnd !== null ? <b className={mi.estEnd <= mi.plannedEnd ? 'text-[#08A048]' : 'text-[#E02028]'}>est. {at(mi.estEnd)}</b> : '—'}</p>
        {mi.actualStart !== null && (
          <table className="w-full text-[13px]">
            <thead><tr><Th>By group</Th><Th>Items</Th><Th>Done / plan</Th><Th>{''}</Th></tr></thead>
            <tbody>{groups.map(({ g, b }) => (
              <tr key={g} className="border-t border-slate-100"><td className="py-1.5 font-bold">{g}</td><td className="text-right tabular-nums">{b.items}</td>
                <td className={cx('text-right font-bold tabular-nums', b.state === 'BEHIND' ? 'text-[#E02028]' : b.state === 'AHEAD' ? 'text-[#08A048]' : 'text-slate-700')}>{b.actualPct}% / {b.planPct}%</td>
                <td className="w-24 pl-2"><span className="relative block h-1.5 rounded-full bg-slate-200"><span className={cx('block h-full rounded-full', b.state === 'BEHIND' ? 'bg-[#E02028]' : 'bg-[#08A048]')} style={{ width: `${b.actualPct}%` }} /><span className="absolute -top-1 h-3.5 w-0.5 bg-slate-900" style={{ left: `${b.planPct}%` }} /></span></td></tr>))}
            </tbody>
          </table>
        )}
        <table className="w-full text-[13px]">
          <thead><tr><Th>Blinds installed</Th><Th>In</Th><Th>Open</Th><Th>Out</Th></tr></thead>
          <tbody>{rows.map(([l, i, t, o]) => <tr key={l} className="border-t border-slate-100"><td className="py-1.5 font-bold">{l}</td><td className={cx('text-right tabular-nums', t > 0 && i === 0 && 'font-bold text-[#E02028]')}>{i}/{t}</td><td className="text-right tabular-nums">{t - i}</td><td className="text-right tabular-nums">{o}</td></tr>)}</tbody>
        </table>
        {behind.length > 0 && <>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Behind plan · most first</p>
          <div className="space-y-1.5">{(all ? behind : behind.slice(0, 5)).map((e) => <Row key={e.eq.tag} tag={e.eq.tag} text={e.eq.description ?? ''} chip={`−${-e.plan!.variance}${e.plan!.days ? ` · ${e.plan!.days} d` : ''}`} chipCls="bg-red-100 text-red-800" onClick={() => onOpen({ kind: 'equipment', ref: e.eq.tag })} />)}</div>
          {behind.length > 5 && !all && <button type="button" onClick={() => setAll(true)} className="w-full rounded-xl py-2 text-sm text-slate-500 ring-1 ring-slate-200">+ {behind.length - 5} more</button>}
        </>}
        <div className="flex gap-2"><NavBtn label="Blinds" onClick={() => onNav({ tab: 'isolation', iso: 'blind' })} /><NavBtn label="Equipment" onClick={() => onNav({ tab: 'equipment', lateFirst: true })} /><NavBtn label="Timing" onClick={() => onNav({ tab: 'timing' })} /></div>
      </div>
    </BottomSheet>
  );
}

