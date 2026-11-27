// Unit log › Overview (owner, 25 Nov 2026, after two team reviews): TR-1, TR-2 and Common full-width cards with each
// train's key figures first (each opens that train's page: its handover, counts and section tiles), then the handover, then one tile per section; a tile
// opens its drawing and every library limit of that section. Statuses come from the owner's limit library as
// written (src/core/logbook/board.ts); a limit with no reading is shown as "not checked", never as fine.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BottomSheet, cx } from '@/ui/components';
import { checksOf, handover, reactorStrip, trainCounts, summarize, trainOfEquipment, whatsappText, type BoardInput, type Check, type HandoverLine, type SectionId, type St, type StripCell, type TrainId } from '@/core/logbook/board';
import { kuwaitParts, labTrend, type StoredLog, type StoredSample } from '@/core/logbook/view';
import { productCards, shiftEnd, type ProductCard } from '@/core/logbook/products';
import { dueFor, lastLabel, scheduleStatus, type DueState, type ScheduleItem } from '@/core/logbook/schedule';
import { enablePush, pushEndpoint, pushState } from '@/data/push';
import { fetchLimitChanges, setLimit, setUnitLogAlerts, undoLimitChange, unitLogAlertsOn, type LimitChange } from '@/data/unitLog';
import { iowBand, limitBand, type Limit, type LimitMatch } from '@/core/logbook/limits';
import type { Override } from '@/core/logbook/board';
import { drawSection, tileIcon, type DrawCtx } from './drawings';

const ICON: Record<St, string> = { bad: '●', off: '▲', chk: '⚑', grey: '○', ok: '✓' };
const TXT: Record<St, string> = { bad: 'text-red-700', off: 'text-amber-800', chk: 'text-slate-600', grey: 'text-slate-600', ok: 'text-green-700' };
const PILL: Record<St, string> = { bad: 'bg-red-50 text-red-700', off: 'bg-amber-50 text-amber-800', chk: 'bg-slate-100 text-slate-600', grey: 'bg-slate-100 text-slate-600', ok: '' };
const TILE: Record<St, string> = { bad: 'border-2 border-red-600', off: 'border-2 border-amber-500', chk: 'border border-slate-300', grey: 'border-2 border-dashed border-slate-400', ok: 'border border-slate-200' };
const NAMES: Record<SectionId, string> = { feed: 'Feed & charge', heat: 'Heaters', rx: 'Reactors', gas: 'Gas loop', sep: 'Separators & water', frac: 'Fractionation' };
const ORDER: SectionId[] = ['feed', 'heat', 'rx', 'gas', 'sep', 'frac'];
const TRAINS: TrainId[] = ['TR-1', 'TR-2', 'Common'];
const TNAME: Record<TrainId, string> = { 'TR-1': 'Train 1', 'TR-2': 'Train 2', Common: 'Common' };

function Svg({ make }: { make: () => SVGSVGElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.replaceChildren(make()); }, [make]);
  return <div ref={ref} />;
}

export interface OverviewProps { log: StoredLog; controller: StoredLog | null; lab: StoredSample[]; limits: Map<string, Limit>; matches: LimitMatch[]; overrides: Override[]; schedule?: ScheduleItem[]; canEdit?: boolean; onLimitsChanged?: () => void }

export default function Overview(p: OverviewProps) {
  return <EditCtx.Provider value={{ canEdit: !!p.canEdit, changed: p.onLimitsChanged ?? (() => undefined) }}><OverviewBody {...p} /></EditCtx.Provider>;
}

function OverviewBody(p: OverviewProps) {
  const [params, setParams] = useSearchParams();
  const sec = ORDER.find((x) => x === params.get('sec')) ?? null;
  const train = TRAINS.find((t) => t === params.get('train')) ?? null;
  const side: 1 | 2 = params.get('side') === '2' ? 2 : 1;
  const input: BoardInput = { log: p.log, controller: p.controller, lab: p.lab, limits: p.limits, matches: p.matches, overrides: p.overrides };
  const checks = useMemo(() => checksOf(input), [p.log, p.controller, p.lab, p.limits, p.matches]); // eslint-disable-line react-hooks/exhaustive-deps
  const nav = (set: Record<string, string | null>) => { const nx = new URLSearchParams(params); for (const [k, v] of Object.entries(set)) { if (v) nx.set(k, v); else nx.delete(k); } setParams(nx); };
  if (!p.limits.size) return <p className="rounded-2xl bg-white p-4 text-[14px] text-slate-600 ring-1 ring-slate-200">The limit library is not loaded, so nothing can be checked yet.</p>;
  const show = SHOWS.find((x) => x === params.get('show')) ?? null;
  const setShow = (x: Show | null) => nav({ show: x });
  if (sec) return <SectionPage sec={sec} checks={checks} {...p} side={side} setSide={(t) => nav({ side: String(t) })} show={show} setShow={setShow}
    backTo={show ? SHOW_NAME[show] : train ? TNAME[train] : 'Overview'} back={() => nav({ sec: null, side: null })} />;

  const lines = handover(input, checks);
  const k = keys(p);
  const openSec = (id: SectionId, t?: TrainId) => nav({ sec: id, side: t === 'TR-2' ? '2' : null });
  if (show) return <StatePage {...p} checks={checks} train={train} show={show} setShow={setShow} back={() => nav({ show: null })} openSec={(id) => openSec(id, train ?? undefined)} />;
  if (train) return <TrainPage {...p} train={train} checks={checks} lines={lines} k={k} pick={(t) => nav({ train: t })} back={() => nav({ train: null })} openSec={(id) => openSec(id, train)} setShow={setShow} />;

  const sum = summarize(checks, p.overrides);
  const text = whatsappText(p.log, lines);
  const all = Object.values(sum);
  const greyParams = new Set(checks.filter((c) => c.state === 'grey').map((c) => c.paramId));
  const greyIow = [...greyParams].filter((id) => { const l = p.limits.get(id)!; return !!iowBand(l.iowStd) || !!iowBand(l.iowCrit); }).length;
  const tot = { bad: checks.filter((c) => c.state === 'bad').length, ov: p.overrides.length, off: all.reduce((n, s) => n + s.off, 0), chk: all.reduce((n, s) => n + s.chk, 0) };
  const cat = ['CATALYSTADDITIONTR1TR2', 'CATALYSTWITHDRWALTR1TR2'].map((k) => p.log.readings.find((r) => r.key === k));
  return (
    <div className="space-y-2.5">
      <TrainCards checks={checks} overrides={p.overrides} log={p.log} limits={p.limits} pick={(t) => nav({ train: t })} />
      <ProductCards cards={productCards(p.lab, shiftEnd(p.log.date, p.log.shift), p.log.date, p.limits, p.matches)} lab={p.lab} states={scheduleStatus(p.lab, p.schedule ?? [], asOfShift(p.log))} />
      <HandoverCard lines={lines} />
      <div className="flex gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="grid min-h-11 flex-1 place-items-center rounded-xl bg-brand-800 text-[15px] font-bold text-white">Share to WhatsApp</a>
        <CopyButton text={text} />
      </div>
      <div className="flex flex-wrap gap-1.5 text-[13.5px] font-bold">
        {(tot.bad + tot.ov) > 0 && <button type="button" onClick={() => setShow('bad')} className="min-h-11 rounded-lg bg-red-50 px-2.5 text-red-700">● {tot.bad} IOW{tot.ov ? ` · ${tot.ov} override` : ''} ›</button>}
        {tot.off > 0 && <button type="button" onClick={() => setShow('off')} className="min-h-11 rounded-lg bg-amber-50 px-2.5 text-amber-800">▲ {tot.off} off target ›</button>}
        {tot.chk > 0 && <button type="button" onClick={() => setShow('chk')} className="min-h-11 rounded-lg bg-slate-100 px-2.5 text-slate-600">⚑ {tot.chk} check ›</button>}
        {greyParams.size > 0 && <button type="button" onClick={() => setShow('grey')} className="min-h-11 rounded-lg bg-slate-100 px-2.5 text-slate-600">○ {greyParams.size} not checked{greyIow ? ` (${greyIow} IOW)` : ''} ›</button>}
      </div>
      {greyParams.size > 0 && <p className="px-1 text-[12.5px] text-slate-500">Tap a count to see its limits. Not checked = the library has a limit but this e-logbook has no reading; they come with panel entry.</p>}
      <Tiles ids={ORDER} sum={sum} line={(id) => k.both[id]} gasOverride={p.overrides.length > 0} open={(id) => openSec(id)} />
      {cat.some(Boolean) && <div className="flex gap-2.5 rounded-xl bg-white px-3 py-2 text-[14px] ring-1 ring-slate-200"><b className="shrink-0">Catalyst</b>
        <span>addition {cat[0]?.tr1 ?? '—'} / {cat[0]?.tr2 ?? '—'} · withdrawal {cat[1]?.tr1 ?? '—'} / {cat[1]?.tr2 ?? '—'} <span className="text-slate-500">(TR-1 / TR-2)</span></span></div>}
      <AlertsToggle />
    </div>
  );
}

/** Each tile's key figure: for both trains (Overview) or one train (its page). */
interface Keys { both: Record<SectionId, string>; one: (id: SectionId, t: TrainId) => string; cat: (t: TrainId) => string | null }
function keys(p: OverviewProps): Keys {
  const val = (key: string, t: 'tr1' | 'tr2') => p.log.readings.find((r) => r.key === key)?.[t] ?? '—';
  const day = p.lab.filter((s) => kuwaitParts(s.collectedAt)?.date === p.log.date);
  const labOf = (material: string, comp: string, train: TrainId) => day.find((s) => s.material === material && trainOfEquipment(s.equipment) === train)?.results.find((r) => r.component === comp)?.value ?? '—';
  const skinMax = (t: 'tr1' | 'tr2') => { const xs = p.log.readings.filter((r) => /^PASS\dSKINTEMPH12/.test(r.key)).map((r) => Number(r[t])).filter((x) => Number.isFinite(x) && x > 0); return xs.length ? String(Math.max(...xs)) : '—'; };
  const naphtha = day.filter((s) => s.material === 'NAPHTHA').map((s) => s.results.find((r) => r.component === 'H2S')?.value).filter(Boolean).join(' · ') || '—';
  const one = (id: SectionId, t: TrainId): string => {
    if (id === 'frac') return `Naphtha H₂S <b>${naphtha}</b> ppm`;
    if (t === 'Common') return '';
    const s = t === 'TR-2' ? 'tr2' : 'tr1';
    return { feed: `Feed <b>${val('FEEDRATE', s)}</b> KBPD`, heat: `Skin max <b>${skinMax(s)}</b> °F`, rx: `OCR inlet <b>${val('INLETTEMPERATURER12105205', s)}</b> °F`,
      gas: `Total MEA <b>${labOf('RICH MEA', 'Total MEA', t)}</b> wt%`, sep: `Wash water <b>${val('WASHWATERRATE', s)}</b> gpm` }[id];
  };
  const both = Object.fromEntries(ORDER.map((id) => [id, id === 'frac' ? one(id, 'Common') : one(id, 'TR-1').replace('<b>', 'TR-1 <b>').replace(/ (\S+)$/, '') + ` · TR-2 ${one(id, 'TR-2').replace(/^.*?<b>/, '<b>')}`])) as Record<SectionId, string>;
  const cat = (t: TrainId) => { if (t === 'Common') return null; const s = t === 'TR-2' ? 'tr2' : 'tr1'; const r = ['CATALYSTADDITIONTR1TR2', 'CATALYSTWITHDRWALTR1TR2'].map((k) => p.log.readings.find((x) => x.key === k)?.[s]); return r.some(Boolean) ? `addition ${r[0] ?? '—'} · withdrawal ${r[1] ?? '—'}` : null; };
  return { both, one, cat };
}


/** The key figures on each train's card (owner, 25 Nov 2026: "train 1 card will show the KPI for train 1"); each is a library
 *  parameter, so its colour is that train's check. Common adds the products of the shift. */
const KPI: Record<TrainId, { id: string; label: string }[]> = {
  'TR-1': [{ id: 'FEED-RATE', label: 'Feed' }, { id: 'FB-CAT', label: 'WABT' }, { id: 'OCR-TIN', label: 'OCR in' }, { id: 'OCR-MAXBED', label: 'OCR bed' },
    { id: 'RG-PURITY', label: 'H₂ purity' }, { id: 'MEA-CONC', label: 'Rich MEA' }, { id: 'H1-SKIN', label: 'Skin max' }, { id: 'H1-INJW', label: 'Inj. water' }],
  'TR-2': [], Common: [{ id: 'NAP-H2S', label: 'Naph. H₂S' }, { id: 'SW-CL', label: 'SW Cl' }, { id: 'SW-FE', label: 'SW Fe' }, { id: 'SW-PH', label: 'SW pH' }],
};
KPI['TR-2'] = KPI['TR-1'];
const UNIT_SHORT: Record<string, string> = { KBPD: 'KBPD', '°F': '°F', '%vol': '%', '%wt': '%', 'wt%': '%', gpm: 'gpm', ppm: 'ppm', pH: '' };

/** TR-1, TR-2 and Common, one full-width card each: counts, then that train's key figures; each opens the train's page. */
function TrainCards({ checks, overrides, log, limits, pick }: { checks: Check[]; overrides: Override[]; log: StoredLog; limits: Map<string, Limit>; pick: (t: TrainId) => void }) {
  const products = log.products;
  const kpis = (t: TrainId) => KPI[t].map((x) => { const c = checks.find((y) => y.paramId === x.id && (y.train === t || (t !== 'Common' && y.train === 'Common'))); return { ...x, c }; }).filter((x) => x.c);
  const prods = products.filter((x) => x.value && /naphtha|distillate|diesel|lsar/i.test(x.product)).slice(0, 4);
  return (
    <div className="space-y-2">
      {TRAINS.map((t) => { const c = trainCounts(checks, overrides, t); return (
        <button key={t} type="button" onClick={() => pick(t)} className={cx('block w-full rounded-2xl bg-white p-2.5 text-left', TILE[c.st])}>
          <span className="flex items-center gap-2">
            <span className="text-[18px] font-bold leading-none text-brand-800">{TNAME[t]}</span>
            <span className="flex min-w-0 flex-1 flex-wrap justify-end gap-x-2 text-[12.5px] font-bold">
              {(c.bad + c.ov) > 0 && <span className="text-red-700">● {c.bad ? `${c.bad} IOW` : ''}{c.bad && c.ov ? ' · ' : ''}{c.ov ? `${c.ov} override` : ''}</span>}
              {c.off > 0 && <span className="text-amber-800">▲ {c.off} off</span>}
              {c.chk > 0 && <span className="text-slate-600">⚑ {c.chk}</span>}
              {c.st === 'ok' && <span className="text-green-700">✓ In range</span>}
            </span>
            <span className="text-[18px] font-bold leading-none text-brand-800">›</span>
          </span>
          <span className="mt-2 grid grid-cols-4 gap-1">
            {kpis(t).map(({ id, label, c: k }) => (
              <span key={id} className={cx('flex flex-col rounded-lg px-1.5 py-1', k!.state === 'ok' ? 'bg-slate-50' : PILL[k!.state])}>
                <span className="truncate text-[11px] font-semibold leading-tight text-slate-500">{label}</span>
                <span className={cx('whitespace-nowrap text-[15px] font-bold leading-tight tabular-nums', k!.state === 'ok' ? 'text-slate-900' : TXT[k!.state])}>
                  {k!.state !== 'ok' ? `${ICON[k!.state]} ` : ''}{k!.value ?? '—'}<span className="text-[10.5px] font-semibold text-slate-500"> {UNIT_SHORT[k!.unit] ?? k!.unit}</span></span>
              </span>))}
            {t !== 'Common' && <Strips strip={reactorStrip(log, limits, t)} wash={log.readings.find((r) => r.key === 'WASHWATERRATE')?.[t === 'TR-2' ? 'tr2' : 'tr1'] ?? null} />}
            {t === 'Common' && prods.map((x) => (
              <span key={x.product} className="flex flex-col rounded-lg bg-slate-50 px-1.5 py-1">
                <span className="truncate text-[11px] font-semibold leading-tight text-slate-500">{x.product.replace(/\s*\(.*\)/, '')}</span>
                <span className="whitespace-nowrap text-[15px] font-bold leading-tight tabular-nums text-slate-900">{x.value}<span className="text-[10.5px] font-semibold text-slate-500"> {x.unit ?? ''}</span></span>
              </span>))}
          </span>
        </button>); })}
    </div>
  );
}

/** ΔP and ΔT across each reactor in flow order (OCR → x01 … x04, then the net rise), and wash water, on a train card. */
function Strips({ strip, wash }: { strip: { dp: StripCell[]; dt: StripCell[] }; wash: string | null }) {
  const row = (label: string, unit: string, cells: StripCell[]) => (
    <span className="col-span-4 flex items-stretch gap-1">
      <span className="flex w-[46px] shrink-0 flex-col justify-center text-[12px] font-bold leading-tight text-slate-700">{label}<span className="text-[10.5px] font-semibold text-slate-500">{unit}</span></span>
      <span className="grid flex-1 grid-cols-6 gap-1">
        {cells.map((c) => (
          <span key={c.name} className={cx('flex flex-col items-center rounded-md py-0.5', c.st === 'ok' ? 'bg-slate-50' : PILL[c.st])}>
            <span className="text-[10.5px] font-semibold leading-tight text-slate-500">{c.name.replace(/^R-/, '')}</span>
            <span className={cx('text-[13.5px] font-bold leading-tight tabular-nums', c.st === 'ok' ? 'text-slate-900' : TXT[c.st])}>{c.st !== 'ok' && c.st !== 'grey' ? ICON[c.st] : ''}{c.value ?? '—'}</span>
          </span>))}
      </span>
    </span>);
  return (<>
    {row('ΔP', 'psi', strip.dp)}
    {row('ΔT', '°F', strip.dt)}
    <span className="col-span-4 text-[12.5px] text-slate-600">Wash water <b className="text-slate-900 tabular-nums">{wash ?? '—'}</b> gpm</span>
  </>);
}

function Tiles({ ids, sum, line, gasOverride, open }: { ids: SectionId[]; sum: ReturnType<typeof summarize>; line: (id: SectionId) => string; gasOverride: boolean; open: (id: SectionId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {ids.map((id) => { const s = sum[id]; const st = s.state; return (
        <button key={id} type="button" onClick={() => open(id)} className={cx('flex min-h-[128px] flex-col rounded-2xl bg-white p-2.5 text-left', TILE[st])}>
          <Svg make={() => tileIcon(id)} />
          <span className="mt-1 text-[15px] font-bold leading-tight text-slate-900">{NAMES[id]}</span>
          {s.bad > 0 && <span className="text-[12.5px] font-bold leading-tight text-red-700">● {s.bad} {id === 'gas' && gasOverride ? 'IOW / override' : 'IOW breach'}</span>}
          {s.off > 0 && <span className="text-[12.5px] font-bold leading-tight text-amber-800">▲ {s.off} off target</span>}
          {s.grey > 0 && <span className="text-[12.5px] font-bold leading-tight text-slate-600">○ {s.grey} not checked{s.greyIow ? ` · ${s.greyIow} IOW` : ''}</span>}
          {s.chk > 0 && <span className="text-[12.5px] font-bold leading-tight text-slate-600">⚑ {s.chk} check</span>}
          {st === 'ok' && <span className="text-[12.5px] font-bold text-green-700">✓ In range</span>}
          <span className="mt-auto pt-1 text-[12.5px] leading-snug text-slate-600 [&_b]:text-slate-900" dangerouslySetInnerHTML={{ __html: line(id) }} />
        </button>); })}
    </div>
  );
}

function HandoverCard({ lines, all = false }: { lines: HandoverLine[]; all?: boolean }) {
  if (!lines.length) return null;
  return (
    <div className="rounded-2xl bg-white px-3 py-1 ring-1 ring-slate-200">
      {lines.map((l) => (
        <div key={l.key} className="flex gap-2.5 border-t border-slate-100 py-2 text-[14.5px] first:border-0">
          <span className={cx('w-[66px] shrink-0 font-bold leading-tight', l.key.startsWith('TR') ? 'text-brand-800' : 'text-slate-900')}>{l.key}</span>
          <span className="min-w-0">{l.items.slice(0, all ? undefined : 4).map((x, k) => <span key={k} className={cx(x.st !== 'ok' && TXT[x.st], x.st === 'bad' && 'font-semibold')}>{k ? ' · ' : ''}{ICON[x.st]} {x.text}</span>)}{!all && l.items.length > 4 && <span className="text-slate-500"> · +{l.items.length - 4}</span>}</span>
        </div>
      ))}
    </div>
  );
}

/** One train: its part of the handover, its counts and its section tiles; a tile opens the drawing on this train. */
function TrainPage(p: OverviewProps & { train: TrainId; checks: Check[]; lines: HandoverLine[]; k: Keys; pick: (t: TrainId) => void; back: () => void; openSec: (id: SectionId) => void; setShow: (x: Show) => void }) {
  const t = p.train;
  const mine: HandoverLine[] = p.lines.flatMap((l): HandoverLine[] => {
    if (l.key === 'Override') { const items = l.items.filter((x) => x.text.startsWith(`${t} `)); return items.length ? [{ key: 'Override', items }] : []; }
    if (l.key === 'Both') return t === 'Common' ? [] : [{ key: 'Both trains', items: l.items }];
    if (l.key === t) return [{ key: 'Now', items: l.items }];
    return [];
  });
  const sum = summarize(p.checks, p.overrides, t);
  const ids = ORDER.filter((id) => p.checks.some((c) => c.section === id && c.train === t));
  const c = trainCounts(p.checks, p.overrides, t);
  const cat = p.k.cat(t);
  return (
    <div className="space-y-2.5">
      <button type="button" onClick={p.back} className="-ml-1 flex min-h-11 items-center px-1 text-[16px] font-bold text-brand-800">‹ Overview</button>
      <div className="flex gap-1.5">{TRAINS.map((x) => <button key={x} type="button" onClick={() => p.pick(x)} className={cx('min-h-11 flex-1 rounded-xl border-[1.5px] bg-white text-[15px] font-bold', x === t ? 'border-brand-800 text-brand-800' : 'border-slate-200 text-slate-500')}>{x}</button>)}</div>
      <h2 className="text-[24px] font-bold text-brand-800">{TNAME[t]}</h2>
      {mine.length ? <HandoverCard lines={mine} all /> : <p className="rounded-2xl bg-white px-3 py-2.5 text-[14.5px] font-semibold text-green-700 ring-1 ring-slate-200">✓ Nothing out of range on {TNAME[t]} this shift.</p>}
      <div className="flex flex-wrap gap-1.5 text-[13.5px] font-bold">
        {(c.bad + c.ov) > 0 && <button type="button" onClick={() => p.setShow('bad')} className="min-h-11 rounded-lg bg-red-50 px-2.5 text-red-700">● {c.bad} IOW{c.ov ? ` · ${c.ov} override` : ''} ›</button>}
        {c.off > 0 && <button type="button" onClick={() => p.setShow('off')} className="min-h-11 rounded-lg bg-amber-50 px-2.5 text-amber-800">▲ {c.off} off target ›</button>}
        {c.chk > 0 && <button type="button" onClick={() => p.setShow('chk')} className="min-h-11 rounded-lg bg-slate-100 px-2.5 text-slate-600">⚑ {c.chk} check ›</button>}
        {c.grey > 0 && <button type="button" onClick={() => p.setShow('grey')} className="min-h-11 rounded-lg bg-slate-100 px-2.5 text-slate-600">○ {c.grey} not checked ›</button>}
      </div>
      {t === 'Common'
        ? <><div className="rounded-2xl bg-white p-1.5 ring-1 ring-slate-200"><Svg make={() => drawSection('frac', drawCtx(p, p.checks, 'Common', 1))} /></div>
            <LimitTable checks={p.checks.filter((c) => c.train === 'Common')} common />
            <p className="px-1 text-[12.5px] text-slate-500">Shared by both trains: H-103, the fractionator side (T-102 to T-105) and V-115. ○ = the library has a limit but the e-logbook or lab has no value.</p></>
        : <Tiles ids={ids} sum={sum} line={(id) => p.k.one(id, t)} gasOverride={p.overrides.some((o) => o.train === t)} open={p.openSec} />}
      {cat && <div className="flex gap-2.5 rounded-xl bg-white px-3 py-2 text-[14px] ring-1 ring-slate-200"><b className="shrink-0">Catalyst</b><span>{cat}</span></div>}
    </div>
  );
}

const ARROW = { up: '↑', down: '↓', same: '=', } as const;
const LTONE = { off: 'bg-amber-50 text-amber-800', breach: 'bg-red-50 text-red-700', critical: 'bg-red-700 text-white' } as const;
/** Product quality (owner, 26 Nov 2026): one full-width card per product with its latest lab results and which way each
 *  moved since the sample before; a value opens every result for it. */
/** The moment a shift is looked at: its end, or now while it is still running. */
const asOfShift = (log: StoredLog) => { const [d, hm] = shiftEnd(log.date, log.shift).split(' '); return new Date(Math.min(Date.now(), Date.parse(`${d}T${hm}:00+03:00`))); };

function ProductCards({ cards, lab, states }: { cards: ProductCard[]; lab: StoredSample[]; states: DueState[] }) {
  const [pick, setPick] = useState<{ c: ProductCard; component: string } | null>(null);
  const pv = pick?.c.values.find((v) => v.component === pick.component);
  const series = pv ? labTrend(lab, pv.sample, pv.component) : [];
  const lim = pv?.limit ?? null;
  return (
    <div className="space-y-2">
      <h3 className="px-1 pt-1 text-[13px] font-bold uppercase tracking-wide text-slate-500">Product quality</h3>
      {cards.map((c) => { const worst = c.values.some((v) => v.state === 'breach' || v.state === 'critical') ? 'bad' : c.values.some((v) => v.state === 'off') ? 'off' : c.sample ? 'ok' : 'grey';
        const late = (v: ProductCard['values'][number]) => { const d = dueFor(states, v.sample.material, v.sample.equipment, v.component); return d?.overdue ? d : null; };
        const nLate = c.values.filter((v) => late(v)).length; return (
        <div key={c.def.material} className={cx('rounded-2xl bg-white p-2.5', TILE[worst as St])}>
          <div className="flex items-baseline gap-2">
            <span className="text-[17px] font-bold leading-none text-brand-800">{c.def.name}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-slate-500">{c.sample ? `${c.sample.equipment ?? ''} · ${c.when ?? ''}` : 'no sample yet'}</span>
            {nLate > 0 && <span className="shrink-0 rounded-md border border-dashed border-violet-500 bg-violet-50 px-1.5 text-[12.5px] font-bold text-violet-800">⏱ {nLate} overdue</span>}
            {worst === 'ok' && !nLate && c.values.some((v) => v.limit) && <span className="text-[12.5px] font-bold text-green-700">✓ In spec</span>}
          </div>
          {c.values.length > 0 && <div className="mt-2 grid grid-cols-4 gap-1">
            {c.values.map((v) => { const bad = v.state && v.state !== 'normal'; const d = late(v); return (
              <button key={v.component} type="button" onClick={() => setPick({ c, component: v.component })} className={cx('flex flex-col rounded-lg px-1.5 py-1 text-left active:ring-2 active:ring-brand-800', bad ? LTONE[v.state as keyof typeof LTONE] : d ? 'bg-violet-50' : 'bg-slate-50', d && 'border border-dashed border-violet-500')}>
                <span className="truncate text-[11px] font-semibold leading-tight text-slate-500">{v.label}</span>
                <span className="whitespace-nowrap text-[15px] font-bold leading-tight tabular-nums">{bad ? (v.state === 'off' ? '▲ ' : '● ') : ''}{v.value}
                  {v.move && v.move !== 'same' && <span className="ms-0.5 text-[11px] font-semibold text-slate-500" title={`was ${v.prev}`}>{ARROW[v.move]}</span>}
                  {v.unit && <span className="text-[10.5px] font-semibold text-slate-500"> {v.unit.replace('%mass', '%').replace('%vol', '%')}</span>}</span>
                {d && <span className="text-[10.5px] font-bold leading-tight text-violet-800">⏱ {lastLabel(d)}</span>}
              </button>); })}
          </div>}
        </div>); })}
      <p className="px-1 text-[12px] text-slate-500">Latest lab result up to the end of this shift; ↑ ↓ against the result before; ⏱ = overdue by the sample schedule (date of the last result). Tap a value for all its results.</p>
      <BottomSheet open={!!pick} onClose={() => setPick(null)} title={pick ? `${pick.c.def.name} · ${pick.component}` : 'Trend'}>
        <table className="w-full text-[13px] tabular-nums">
          <tbody className="divide-y divide-slate-100">{series.map(({ s, r }) => { const k = kuwaitParts(s.collectedAt); return <tr key={s.sampleId}><td className="py-1.5">{k ? `${k.date.slice(8, 10)}/${k.date.slice(5, 7)} ${k.time}` : '—'}</td><td className="text-right font-semibold">{r!.value}</td><td className="ps-2 text-[11px] text-slate-500">{r!.unit}</td></tr>; })}</tbody>
        </table>
        <p className="mt-2 text-[11px] text-slate-500">Every result received so far, newest first.{lim ? ` Limit ${limitBand(lim)} · ${lim.source ?? ''}` : ' No limit for it in the library.'}</p>
      </BottomSheet>
    </div>
  );
}

/** This phone: a push for each new log and new lab results (owner, 26 Nov 2026). */
function AlertsToggle() {
  const [state, setState] = useState<'loading' | 'unsupported' | 'blocked' | 'off' | 'on'>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { let live = true; (async () => {
    const ps = await pushState().catch(() => 'unsupported' as const);
    if (ps !== 'on') { if (live) setState(ps === 'blocked' ? 'blocked' : ps === 'off' ? 'off' : 'unsupported'); return; }
    const ep = await pushEndpoint(); const on = ep ? await unitLogAlertsOn(ep).catch(() => false) : false;
    if (live) setState(on ? 'on' : 'off');
  })(); return () => { live = false; }; }, []);
  const flip = async () => {
    setBusy(true); setMsg(null);
    try {
      if (state === 'off' && (await pushState()) !== 'on') await enablePush('iPhone');
      const ep = await pushEndpoint(); if (!ep) throw new Error('This phone gave no push address.');
      const ok = await setUnitLogAlerts(ep, state !== 'on');
      if (!ok) throw new Error('This phone is not registered for alerts yet. Turn on shift alerts in More first.');
      setState(state === 'on' ? 'off' : 'on');
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  if (state === 'loading') return null;
  return (
    <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[14px]"><b>🔔 Phone alerts</b><span className="text-slate-500"> · new log and lab results</span></span>
        {state === 'on' || state === 'off'
          ? <button type="button" disabled={busy} onClick={flip} className={cx('min-h-11 min-w-[64px] rounded-xl px-3 text-[14px] font-bold', state === 'on' ? 'bg-brand-800 text-white' : 'bg-slate-100 text-slate-700')}>{busy ? '…' : state === 'on' ? 'On' : 'Off'}</button>
          : <span className="text-[12.5px] text-slate-500">{state === 'blocked' ? 'Blocked in phone settings' : 'Open the app from the Home Screen icon'}</span>}
      </div>
      {msg && <p className="mt-1 text-[12.5px] text-red-700">{msg}</p>}
    </div>
  );
}

// ── Tap a count to see its limits (owner, 27 Nov 2026: "allow me to click and see what is off target and what is not checked")
const SHOWS = ['bad', 'off', 'chk', 'grey'] as const;
type Show = (typeof SHOWS)[number];
const SHOW_NAME: Record<Show, string> = { bad: 'IOW breach', off: 'Off target', chk: 'To check', grey: 'Not checked' };
const SHOW_CHIP: Record<Show, string> = { bad: 'IOW breach', off: 'off target', chk: 'to check', grey: 'not checked' };
const SHOW_TONE: Record<Show, string> = { bad: 'bg-red-50 text-red-700', off: 'bg-amber-50 text-amber-800', chk: 'bg-slate-100 text-slate-600', grey: 'bg-slate-100 text-slate-600' };
/** The limits with at least one value in that state (both trains' values stay, for comparison). */
const onlyState = (cs: Check[], show: Show | null) => { if (!show) return cs; const ids = new Set(cs.filter((c) => c.state === show).map((c) => c.paramId)); return cs.filter((c) => ids.has(c.paramId)); };
/** Counted as on the Overview: values for IOW / off / check, limits for not checked. */
const countOf = (cs: Check[], s: Show) => (s === 'grey' ? new Set(cs.filter((c) => c.state === 'grey').map((c) => c.paramId)).size : cs.filter((c) => c.state === s).length);

function StateFilter({ checks, show, setShow }: { checks: Check[]; show: Show | null; setShow: (x: Show | null) => void }) {
  const n = new Set(checks.map((c) => c.paramId)).size;
  return (
    <div className="flex flex-wrap gap-1.5 text-[13.5px] font-bold" role="group" aria-label="Show">
      <button type="button" aria-pressed={!show} onClick={() => setShow(null)} className={cx('min-h-11 rounded-lg px-3', !show ? 'bg-brand-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>All {n}</button>
      {SHOWS.map((x) => { const k = countOf(checks, x); return k > 0 && (
        <button key={x} type="button" aria-pressed={show === x} onClick={() => setShow(show === x ? null : x)} className={cx('min-h-11 rounded-lg px-3', SHOW_TONE[x], show === x && 'ring-2 ring-brand-800')}>{ICON[x]} {k} {SHOW_CHIP[x]}</button>); })}
    </div>
  );
}

/** Every limit in one state, by section (whole unit, or one train when it came from a train page). */
function StatePage(p: OverviewProps & { checks: Check[]; train: TrainId | null; show: Show; setShow: (x: Show | null) => void; back: () => void; openSec: (id: SectionId) => void }) {
  const scope = p.train ? p.checks.filter((c) => c.train === p.train) : p.checks;
  const ov = p.show === 'bad' ? p.overrides.filter((o) => !p.train || o.train === p.train) : [];
  const groups = ORDER.map((id) => ({ id, cs: onlyState(scope.filter((c) => c.section === id), p.show) })).filter((g) => g.cs.length);
  return (
    <div className="space-y-2.5">
      <button type="button" onClick={p.back} className="-ml-1 flex min-h-11 items-center px-1 text-[16px] font-bold text-brand-800">‹ {p.train ? TNAME[p.train] : 'Overview'}</button>
      <h2 className="-mt-2 text-[24px] font-bold text-brand-800">{SHOW_NAME[p.show]}{p.train ? ` · ${TNAME[p.train]}` : ''}</h2>
      <StateFilter checks={scope} show={p.show} setShow={(x) => p.setShow(x ?? null)} />
      {ov.map((o) => <div key={o.id} className="rounded-xl bg-red-50 px-3 py-2 text-[14px] text-red-800"><b>● Override {o.train} {o.item}</b>{o.reason ? ` (${o.reason})` : ''}</div>)}
      {groups.map((g) => (
        <section key={g.id} className="space-y-1.5">
          <button type="button" onClick={() => p.openSec(g.id)} className="flex min-h-11 w-full items-center px-1 text-left text-[16px] font-bold text-slate-900">{NAMES[g.id]}<span className="ms-auto text-[13px] font-semibold text-brand-800">drawing ›</span></button>
          <LimitTable checks={g.cs} common={!!p.train || g.id === 'frac'} />
        </section>
      ))}
      {!groups.length && !ov.length && <p className="rounded-2xl bg-white px-3 py-2.5 text-[14.5px] text-slate-600 ring-1 ring-slate-200">Nothing {SHOW_NAME[p.show].toLowerCase()} this shift.</p>}
      {p.show === 'grey' && <p className="px-1 text-[12.5px] text-slate-500">Not checked: the library has a limit but this e-logbook or that day's lab has no value. They come with panel entry.</p>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined)}
    className="grid min-h-11 flex-1 place-items-center rounded-xl bg-white text-[15px] font-bold text-slate-900 ring-1 ring-slate-200">{done ? 'Copied' : 'Copy'}</button>;
}

function SectionPage(p: OverviewProps & { sec: SectionId; checks: Check[]; side: 1 | 2; setSide: (t: 1 | 2) => void; show: Show | null; setShow: (x: Show | null) => void; backTo: string; back: () => void }) {
  const tr = p.side; const setTr = p.setSide;
  const common = p.sec === 'frac';
  const train: TrainId = common ? 'Common' : tr === 1 ? 'TR-1' : 'TR-2';
  const ctx = drawCtx(p, p.checks, train, tr);
  const make = () => drawSection(p.sec, ctx);
  const ov = p.sec === 'gas' ? p.overrides : [];
  return (
    <div className="space-y-2.5">
      <button type="button" onClick={p.back} className="-ml-1 flex min-h-11 items-center px-1 text-[16px] font-bold text-brand-800">‹ {p.backTo}</button>
      <h2 className="-mt-2 text-[24px] font-bold text-brand-800">{NAMES[p.sec]}</h2>
      {!common && <div className="flex gap-1.5">{([1, 2] as const).map((t) => <button key={t} type="button" onClick={() => setTr(t)} className={cx('min-h-11 flex-1 rounded-xl border-[1.5px] bg-white text-[15px] font-bold', tr === t ? 'border-brand-800 text-brand-800' : 'border-slate-200 text-slate-500')}>Train {t}</button>)}</div>}
      <div className="rounded-2xl bg-white p-1.5 ring-1 ring-slate-200"><Svg key={`${p.sec}${tr}`} make={make} /></div>
      {ov.map((o) => <div key={o.id} className="rounded-xl bg-red-50 px-3 py-2 text-[14px] text-red-800"><b>● {o.train} {o.item}</b>{o.reason ? ` (${o.reason})` : ''}{o.startedOn ? ` since ${o.startedOn}` : ''} · {o.expiresOn ? `expires ${o.expiresOn}` : 'expiry not set'}{o.moc ? ` · MOC ${o.moc}` : ' · MOC not set'}<div className="text-[12.5px] text-red-700/80">{o.source}</div></div>)}
      <StateFilter checks={p.checks.filter((c) => c.section === p.sec)} show={p.show} setShow={p.setShow} />
      <LimitTable checks={onlyState(p.checks.filter((c) => c.section === p.sec), p.show)} common={common} />
      <p className="px-1 text-[12px] text-slate-500">Tap a row for its limit, source and history.</p>
    </div>
  );
}

function drawCtx(p: OverviewProps, checks: Check[], train: TrainId, tr: 1 | 2): DrawCtx {
  const sideKey = tr === 1 ? 'tr1' : 'tr2';
  return {
    train: tr,
    r: (key) => p.log.readings.find((r) => r.key === key)?.[sideKey] ?? null,
    st: (id) => { const cs = checks.filter((c) => c.paramId === id && (c.train === train || c.train === 'Common')); const order: St[] = ['bad', 'off', 'chk', 'grey', 'ok']; return order.find((s) => cs.some((c) => c.state === s)) ?? 'ok'; },
    lab: (material, comp) => {
      const hits = p.lab.filter((s) => kuwaitParts(s.collectedAt)?.date === p.log.date && (s.material ?? '').toUpperCase() === material.toUpperCase() && [train, 'Common'].includes(trainOfEquipment(s.equipment) ?? 'Common'));
      for (const s of hits) { const r = s.results.find((x) => x.component === comp); if (r) return r.value; }
      return null;
    },
    iow: (id) => iowBand(p.limits.get(id)?.iowStd ?? null)?.hi ?? null,
    feed: p.log.feed.find((f) => f.train === (tr === 1 ? 'TR-1' : 'TR-2')) ?? null, products: p.log.products,
    override: train !== 'Common' && p.overrides.some((o) => o.train === train),
  };
}

/** The limits of a section (or of Common), worst first: value per train, then band, source, notes and the action. */
/** Who may change limits on this page, and how the page reloads them after a change. */
const EditCtx = createContext<{ canEdit: boolean; changed: () => void }>({ canEdit: false, changed: () => undefined });

/** The limits of a section (or a state), worst first: one short row each (name, value per train, unit); a tap opens the
 *  band, source, notes, action, its change history and, for the Section Head, "Change limit". */
function LimitTable({ checks: cs, common }: { checks: Check[]; common: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const ids = [...new Set(cs.map((c) => c.paramId))];
  const rank = (id: string) => Math.min(...cs.filter((c) => c.paramId === id).map((c) => ({ bad: 0, off: 1, chk: 2, ok: 3, grey: 4 }[c.state])));
  ids.sort((a, b) => rank(a) - rank(b));
  const cell = (c: Check | undefined) => (!c ? <span className="text-slate-300">—</span> : c.state === 'ok' ? <span className="tabular-nums">{c.value}</span>
    : <span className={cx('whitespace-nowrap rounded px-1 font-bold tabular-nums', PILL[c.state])}>{ICON[c.state]} {c.value ?? '—'}</span>);
  return (
    <div className="rounded-2xl bg-white px-2.5 py-1 ring-1 ring-slate-200">
      <div className="flex py-1.5 text-[11.5px] font-bold text-slate-500"><span className="flex-1" /><span className="w-[72px] text-right">{common ? 'Value' : 'TR-1'}</span>{!common && <span className="w-[72px] text-right">TR-2</span>}<span className="w-[46px]" /></div>
      {ids.map((id) => { const one = cs.filter((c) => c.paramId === id); const a = common ? one[0] : one.find((c) => c.train === 'TR-1') ?? one.find((c) => c.train === 'Common'); const b = one.find((c) => c.train === 'TR-2');
        return (
          <div key={id} className="border-t border-slate-100">
            <button type="button" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)} className="flex min-h-11 w-full items-center py-1.5 text-left text-[14.5px]">
              <span className="min-w-0 flex-1 pr-2 leading-tight">{one[0].limit.description.replace(/\s*\(.*?\)\s*$/, '')}</span>
              <span className="w-[72px] text-right">{cell(a)}</span>{!common && <span className="w-[72px] text-right">{cell(b)}</span>}
              <span className="w-[46px] whitespace-nowrap pl-1.5 text-[12px] text-slate-500">{one[0].unit}<span className="ms-1 text-slate-400">{open === id ? '▴' : '▾'}</span></span>
            </button>
            {open === id && <LimitDetail checks={one} />}
          </div>); })}
    </div>
  );
}

const valText = (v: Record<string, unknown>) => {
  const lo = v.normal_lo as number | null, hi = v.normal_hi as number | null;
  const n = lo != null && hi != null ? `${lo}–${hi}` : hi != null ? `≤ ${hi}` : lo != null ? `≥ ${lo}` : 'no range';
  return `${n}${v.iow_std ? ` · IOW ${v.iow_std}` : ''}${v.iow_crit ? ` · crit ${v.iow_crit}` : ''}${v.target ? ` · target ${v.target}` : ''}`;
};

function LimitDetail({ checks: one }: { checks: Check[] }) {
  const { canEdit, changed } = useContext(EditCtx);
  const l = one[0].limit;
  const [hist, setHist] = useState<LimitChange[] | null>(null);
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let live = true; fetchLimitChanges(l.paramId).then((h) => live && setHist(h)).catch(() => live && setHist([])); return () => { live = false; }; }, [l.paramId, l]);
  const notes = [...new Set(one.map((c) => c.note).filter((x): x is string => !!x && !/^not in /.test(x) && !/^no sample/.test(x)))];
  const action = one.some((c) => c.state === 'bad' || c.state === 'off') && l.action ? l.action : null;
  const undo = async (id: number) => { setErr(null); try { await undoLimitChange(id); changed(); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="mb-2 space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-[13px] leading-snug text-slate-700">
      <div><b>Limit</b> {one[0].band || 'no number'}{l.trip ? <span className="text-slate-500"> · trip {l.trip}</span> : null}</div>
      {action && <div><b>Do</b> {action}</div>}
      {notes.length > 0 && <div className="text-slate-600">{notes.join(' · ')}</div>}
      {l.source && <div className="text-[12px] text-slate-500">{l.source}</div>}
      {hist && hist.length > 0 && <div className="border-t border-slate-200 pt-1 text-[12px] text-slate-600">
        {hist.slice(0, 2).map((h, k) => <div key={h.id}>{new Date(h.changedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: {valText(h.oldValues)} → <b>{valText(h.newValues)}</b> · {h.reason}
          {k === 0 && canEdit && !h.undoes && <button type="button" onClick={() => undo(h.id)} className="ms-2 min-h-8 font-bold text-brand-800 underline">Undo</button>}</div>)}
      </div>}
      {canEdit && <button type="button" onClick={() => setEdit(true)} className="mt-1 min-h-11 w-full rounded-xl bg-white text-[14px] font-bold text-brand-800 ring-1 ring-slate-200">Change limit</button>}
      {err && <p className="text-[12.5px] text-red-700">{err}</p>}
      {edit && <LimitForm limit={l} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); changed(); }} />}
    </div>
  );
}

function LimitForm({ limit: l, onClose, onSaved }: { limit: Limit; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ target: l.target ?? '', lo: l.normalLo?.toString() ?? '', hi: l.normalHi?.toString() ?? '', iowStd: l.iowStd ?? '', iowCrit: l.iowCrit ?? '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (x: string) => (x.trim() === '' ? null : Number(x));
  const save = async () => {
    setErr(null);
    const lo = num(v.lo), hi = num(v.hi);
    if ((lo !== null && Number.isNaN(lo)) || (hi !== null && Number.isNaN(hi))) { setErr('Normal low and high must be numbers.'); return; }
    if (v.reason.trim().length < 3) { setErr('Give a reason for the change.'); return; }
    setBusy(true);
    try { await setLimit(l.paramId, { target: v.target.trim() || null, normalLo: lo, normalHi: hi, iowStd: v.iowStd.trim() || null, iowCrit: v.iowCrit.trim() || null }, v.reason.trim()); onSaved(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const field = (key: keyof typeof v, label: string, mode: 'decimal' | 'text' = 'text') => (
    <label className="block text-[13px] font-semibold text-slate-600">{label}
      <input value={v[key]} inputMode={mode} onChange={(e) => setV({ ...v, [key]: e.target.value })} className="mt-1 block min-h-11 w-full rounded-xl border border-slate-300 px-3 text-[16px] text-slate-900" /></label>);
  return (
    <BottomSheet open onClose={onClose} title={`Change limit · ${l.description}`}>
      <div className="space-y-2.5 pb-2">
        <div className="grid grid-cols-2 gap-2">{field('lo', `Normal low${l.unit ? ` (${l.unit})` : ''}`, 'decimal')}{field('hi', `Normal high${l.unit ? ` (${l.unit})` : ''}`, 'decimal')}</div>
        <div className="grid grid-cols-2 gap-2">{field('iowStd', 'IOW standard')}{field('iowCrit', 'IOW critical')}</div>
        {field('target', 'Target')}
        {field('reason', 'Reason (required)')}
        <p className="text-[12px] text-slate-500">Empty = no limit on that side. IOW: one number (a maximum) or a band like 15–20.{l.trip ? ` Trip ${l.trip} stays as it is.` : ''} The old values are kept and the change can be undone.</p>
        {err && <p className="text-[13px] font-semibold text-red-700">{err}</p>}
        <div className="flex gap-2"><button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl bg-white font-bold text-slate-700 ring-1 ring-slate-200">Cancel</button>
          <button type="button" disabled={busy} onClick={save} className="min-h-11 flex-1 rounded-xl bg-brand-800 font-bold text-white">{busy ? 'Saving…' : 'Save'}</button></div>
      </div>
    </BottomSheet>
  );
}
