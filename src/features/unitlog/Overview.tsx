// Unit log › Overview (owner, 25 Nov 2026, after two team reviews): TR-1, TR-2 and Common full-width cards with each
// train's key figures first (each opens that train's page: its handover, counts and section tiles), then the handover, then one tile per section; a tile
// opens its drawing and every library limit of that section. Statuses come from the owner's limit library as
// written (src/core/logbook/board.ts); a limit with no reading is shown as "not checked", never as fine.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cx } from '@/ui/components';
import { checksOf, handover, reactorStrip, summarize, trainOfEquipment, whatsappText, type BoardInput, type Check, type HandoverLine, type SectionId, type St, type StripCell, type TrainId } from '@/core/logbook/board';
import { kuwaitParts, type StoredLog, type StoredSample } from '@/core/logbook/view';
import { iowBand, type Limit, type LimitMatch } from '@/core/logbook/limits';
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

export interface OverviewProps { log: StoredLog; controller: StoredLog | null; lab: StoredSample[]; limits: Map<string, Limit>; matches: LimitMatch[]; overrides: Override[] }

export default function Overview(p: OverviewProps) {
  const [params, setParams] = useSearchParams();
  const sec = ORDER.find((x) => x === params.get('sec')) ?? null;
  const train = TRAINS.find((t) => t === params.get('train')) ?? null;
  const side: 1 | 2 = params.get('side') === '2' ? 2 : 1;
  const input: BoardInput = { log: p.log, controller: p.controller, lab: p.lab, limits: p.limits, matches: p.matches, overrides: p.overrides };
  const checks = useMemo(() => checksOf(input), [p.log, p.controller, p.lab, p.limits, p.matches]); // eslint-disable-line react-hooks/exhaustive-deps
  const nav = (set: Record<string, string | null>) => { const nx = new URLSearchParams(params); for (const [k, v] of Object.entries(set)) { if (v) nx.set(k, v); else nx.delete(k); } setParams(nx); };
  if (!p.limits.size) return <p className="rounded-2xl bg-white p-4 text-[14px] text-slate-600 ring-1 ring-slate-200">The limit library is not loaded, so nothing can be checked yet.</p>;
  if (sec) return <SectionPage sec={sec} checks={checks} {...p} side={side} setSide={(t) => nav({ side: String(t) })} backTo={train ? TNAME[train] : 'Overview'} back={() => nav({ sec: null, side: null })} />;

  const lines = handover(input, checks);
  const k = keys(p);
  const openSec = (id: SectionId, t?: TrainId) => nav({ sec: id, side: t === 'TR-2' ? '2' : null });
  if (train) return <TrainPage {...p} train={train} checks={checks} lines={lines} k={k} pick={(t) => nav({ train: t })} back={() => nav({ train: null })} openSec={(id) => openSec(id, train)} />;

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
      <HandoverCard lines={lines} />
      <div className="flex gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className="grid min-h-11 flex-1 place-items-center rounded-xl bg-brand-800 text-[15px] font-bold text-white">Share to WhatsApp</a>
        <CopyButton text={text} />
      </div>
      <div className="flex flex-wrap gap-1.5 text-[13.5px] font-bold">
        {(tot.bad + tot.ov) > 0 && <span className="rounded-lg bg-red-50 px-2.5 py-1.5 text-red-700">● {tot.bad} IOW{tot.ov ? ` · ${tot.ov} override` : ''}</span>}
        {tot.off > 0 && <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-800">▲ {tot.off} off target</span>}
        {greyIow > 0 && <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-600">○ {greyIow} IOW not checked</span>}
        {tot.chk > 0 && <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-600">⚑ {tot.chk} check</span>}
      </div>
      {greyParams.size > 0 && <p className="px-1 text-[12.5px] text-slate-500">{greyParams.size} limits have no reading in this e-logbook; they come with panel entry.</p>}
      <Tiles ids={ORDER} sum={sum} line={(id) => k.both[id]} gasOverride={p.overrides.length > 0} open={(id) => openSec(id)} />
      {cat.some(Boolean) && <div className="flex gap-2.5 rounded-xl bg-white px-3 py-2 text-[14px] ring-1 ring-slate-200"><b className="shrink-0">Catalyst</b>
        <span>addition {cat[0]?.tr1 ?? '—'} / {cat[0]?.tr2 ?? '—'} · withdrawal {cat[1]?.tr1 ?? '—'} / {cat[1]?.tr2 ?? '—'} <span className="text-slate-500">(TR-1 / TR-2)</span></span></div>}
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

function counts(checks: Check[], overrides: Override[], t: TrainId) {
  const cs = checks.filter((c) => c.train === t);
  const ov = overrides.filter((o) => o.train === t).length;
  const c = { bad: cs.filter((x) => x.state === 'bad').length, ov, off: cs.filter((x) => x.state === 'off').length, chk: cs.filter((x) => x.state === 'chk').length, grey: new Set(cs.filter((x) => x.state === 'grey').map((x) => x.paramId)).size };
  const st: St = c.bad || c.ov ? 'bad' : c.off ? 'off' : c.chk ? 'chk' : c.grey ? 'grey' : 'ok';
  return { ...c, st };
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
      {TRAINS.map((t) => { const c = counts(checks, overrides, t); return (
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
function TrainPage(p: OverviewProps & { train: TrainId; checks: Check[]; lines: HandoverLine[]; k: Keys; pick: (t: TrainId) => void; back: () => void; openSec: (id: SectionId) => void }) {
  const t = p.train;
  const mine: HandoverLine[] = p.lines.flatMap((l): HandoverLine[] => {
    if (l.key === 'Override') { const items = l.items.filter((x) => x.text.startsWith(`${t} `)); return items.length ? [{ key: 'Override', items }] : []; }
    if (l.key === 'Both') return t === 'Common' ? [] : [{ key: 'Both trains', items: l.items }];
    if (l.key === t) return [{ key: 'Now', items: l.items }];
    return [];
  });
  const sum = summarize(p.checks, p.overrides, t);
  const ids = ORDER.filter((id) => p.checks.some((c) => c.section === id && c.train === t));
  const c = counts(p.checks, p.overrides, t);
  const cat = p.k.cat(t);
  return (
    <div className="space-y-2.5">
      <button type="button" onClick={p.back} className="-ml-1 flex min-h-11 items-center px-1 text-[16px] font-bold text-brand-800">‹ Overview</button>
      <div className="flex gap-1.5">{TRAINS.map((x) => <button key={x} type="button" onClick={() => p.pick(x)} className={cx('min-h-11 flex-1 rounded-xl border-[1.5px] bg-white text-[15px] font-bold', x === t ? 'border-brand-800 text-brand-800' : 'border-slate-200 text-slate-500')}>{x}</button>)}</div>
      <h2 className="text-[24px] font-bold text-brand-800">{TNAME[t]}</h2>
      {mine.length ? <HandoverCard lines={mine} all /> : <p className="rounded-2xl bg-white px-3 py-2.5 text-[14.5px] font-semibold text-green-700 ring-1 ring-slate-200">✓ Nothing out of range on {TNAME[t]} this shift.</p>}
      <div className="flex flex-wrap gap-1.5 text-[13.5px] font-bold">
        {(c.bad + c.ov) > 0 && <span className="rounded-lg bg-red-50 px-2.5 py-1.5 text-red-700">● {c.bad} IOW{c.ov ? ` · ${c.ov} override` : ''}</span>}
        {c.off > 0 && <span className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-amber-800">▲ {c.off} off target</span>}
        {c.chk > 0 && <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-600">⚑ {c.chk} check</span>}
        {c.grey > 0 && <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-600">○ {c.grey} not checked</span>}
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

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined)}
    className="grid min-h-11 flex-1 place-items-center rounded-xl bg-white text-[15px] font-bold text-slate-900 ring-1 ring-slate-200">{done ? 'Copied' : 'Copy'}</button>;
}

function SectionPage(p: OverviewProps & { sec: SectionId; checks: Check[]; side: 1 | 2; setSide: (t: 1 | 2) => void; backTo: string; back: () => void }) {
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
      <LimitTable checks={p.checks.filter((c) => c.section === p.sec)} common={common} />
      <p className="px-1 text-[12.5px] text-slate-500">Your limit library as written; ○ = the library has a limit but the e-logbook or lab has no value. {common ? 'Shared by both trains.' : 'Train-2 tags generated from Train 1, to verify.'}</p>
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
function LimitTable({ checks: cs, common }: { checks: Check[]; common: boolean }) {
  const ids = [...new Set(cs.map((c) => c.paramId))];
  const rank = (id: string) => Math.min(...cs.filter((c) => c.paramId === id).map((c) => ({ bad: 0, off: 1, chk: 2, ok: 3, grey: 4 }[c.state])));
  ids.sort((a, b) => rank(a) - rank(b));
  const cell = (c: Check | undefined) => (!c ? <span className="text-slate-300">—</span> : c.state === 'ok' ? <span className="tabular-nums">{c.value}</span>
    : <span className={cx('whitespace-nowrap rounded px-1 font-bold tabular-nums', PILL[c.state])}>{ICON[c.state]} {c.value ?? 'none'}</span>);
  return (
    <div className="rounded-2xl bg-white px-2.5 py-1 ring-1 ring-slate-200">
      <table className="w-full text-[14.5px]">
        <thead><tr className="text-[11.5px] font-bold text-slate-500"><td className="py-1.5" /><td className="text-right">{common ? 'Value' : 'TR-1'}</td>{!common && <td className="text-right">TR-2</td>}<td /></tr></thead>
        <tbody>
          {ids.map((id) => { const one = cs.filter((c) => c.paramId === id); const l = one[0].limit; const a = common ? one[0] : one.find((c) => c.train === 'TR-1') ?? one.find((c) => c.train === 'Common'); const b = one.find((c) => c.train === 'TR-2');
            const notes = [...new Set(one.map((c) => c.note).filter((x): x is string => !!x && !/^not in /.test(x) && !/^no sample/.test(x)))];
            const action = one.some((c) => c.state === 'bad' || c.state === 'off') && l.action ? l.action : null;
            return [
              <tr key={id} className="border-t border-slate-100 align-top"><td className="pb-0.5 pr-2 pt-2 leading-tight">{l.description}</td><td className="pt-2 text-right">{cell(a)}</td>{!common && <td className="pl-2 pt-2 text-right">{cell(b)}</td>}<td className="whitespace-nowrap pl-1.5 pt-2 text-[12px] text-slate-500">{one[0].unit}</td></tr>,
              <tr key={`${id}-l`}><td colSpan={4} className="pb-2 text-[12.5px] leading-snug text-slate-500">{one[0].band}{l.source ? ` · ${l.source}` : ''}{notes.length ? ` · ${notes.join(' · ')}` : ''}{action ? <span className="text-slate-700"> · do: {action}</span> : null}</td></tr>,
            ]; })}
        </tbody>
      </table>
    </div>
  );
}
