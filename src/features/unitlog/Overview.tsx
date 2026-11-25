// Unit log › Overview (owner, 25 Nov 2026, after two team reviews): the handover first, then one tile per section;
// a tile opens its drawing and every library limit of that section. Statuses come from the owner's limit library as
// written (src/core/logbook/board.ts); a limit with no reading is shown as "not checked", never as fine.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cx } from '@/ui/components';
import { checksOf, handover, summarize, trainOfEquipment, whatsappText, type BoardInput, type Check, type SectionId, type St, type TrainId } from '@/core/logbook/board';
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

function Svg({ make }: { make: () => SVGSVGElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.replaceChildren(make()); }, [make]);
  return <div ref={ref} />;
}

export interface OverviewProps { log: StoredLog; controller: StoredLog | null; lab: StoredSample[]; limits: Map<string, Limit>; matches: LimitMatch[]; overrides: Override[] }

export default function Overview(p: OverviewProps) {
  const [params, setParams] = useSearchParams();
  const sec = ORDER.find((x) => x === params.get('sec')) ?? null;
  const input: BoardInput = { log: p.log, controller: p.controller, lab: p.lab, limits: p.limits, matches: p.matches, overrides: p.overrides };
  const checks = useMemo(() => checksOf(input), [p.log, p.controller, p.lab, p.limits, p.matches]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (s: SectionId | null) => { const nx = new URLSearchParams(params); if (s) nx.set('sec', s); else nx.delete('sec'); setParams(nx); };
  if (!p.limits.size) return <p className="rounded-2xl bg-white p-4 text-[14px] text-slate-600 ring-1 ring-slate-200">The limit library is not loaded, so nothing can be checked yet.</p>;
  if (sec) return <SectionPage sec={sec} checks={checks} {...p} back={() => open(null)} />;

  const sum = summarize(checks, p.overrides);
  const lines = handover(input, checks);
  const text = whatsappText(p.log, lines);
  const all = Object.values(sum);
  const greyParams = new Set(checks.filter((c) => c.state === 'grey').map((c) => c.paramId));
  const greyIow = [...greyParams].filter((id) => { const l = p.limits.get(id)!; return !!iowBand(l.iowStd) || !!iowBand(l.iowCrit); }).length;
  const tot = { bad: checks.filter((c) => c.state === 'bad').length, ov: p.overrides.length, off: all.reduce((n, s) => n + s.off, 0), chk: all.reduce((n, s) => n + s.chk, 0) };
  const val = (key: string, t: 'tr1' | 'tr2') => p.log.readings.find((r) => r.key === key)?.[t] ?? '—';
  const labOf = (material: string, comp: string, train: TrainId) => p.lab.find((s) => kuwaitParts(s.collectedAt)?.date === p.log.date && s.material === material && trainOfEquipment(s.equipment) === train)?.results.find((r) => r.component === comp)?.value ?? '—';
  const skinMax = (t: 'tr1' | 'tr2') => { const xs = p.log.readings.filter((r) => /^PASS\dSKINTEMPH12/.test(r.key)).map((r) => Number(r[t])).filter((x) => Number.isFinite(x) && r0(x)); return xs.length ? String(Math.max(...xs)) : '—'; };
  const key: Record<SectionId, string> = {
    feed: `Feed TR-1 <b>${val('FEEDRATE', 'tr1')}</b> · TR-2 <b>${val('FEEDRATE', 'tr2')}</b> KBPD`,
    heat: `Skin max TR-1 <b>${skinMax('tr1')}</b> · TR-2 <b>${skinMax('tr2')}</b> °F`,
    rx: `OCR inlet TR-1 <b>${val('INLETTEMPERATURER12105205', 'tr1')}</b> · TR-2 <b>${val('INLETTEMPERATURER12105205', 'tr2')}</b> °F`,
    gas: `Total MEA TR-1 <b>${labOf('RICH MEA', 'Total MEA', 'TR-1')}</b> · TR-2 <b>${labOf('RICH MEA', 'Total MEA', 'TR-2')}</b> wt%`,
    sep: `Wash water TR-1 <b>${val('WASHWATERRATE', 'tr1')}</b> · TR-2 <b>${val('WASHWATERRATE', 'tr2')}</b> gpm`,
    frac: `Naphtha H₂S <b>${p.lab.filter((s) => kuwaitParts(s.collectedAt)?.date === p.log.date && s.material === 'NAPHTHA').map((s) => s.results.find((r) => r.component === 'H2S')?.value).filter(Boolean).join(' · ') || '—'}</b> ppm`,
  };
  const cat = ['CATALYSTADDITIONTR1TR2', 'CATALYSTWITHDRWALTR1TR2'].map((k) => p.log.readings.find((r) => r.key === k));
  return (
    <div className="space-y-2.5">
      {lines.length > 0 && <div className="rounded-2xl bg-white px-3 py-1 ring-1 ring-slate-200">
        {lines.map((l) => (
          <div key={l.key} className="flex gap-2.5 border-t border-slate-100 py-2 text-[14.5px] first:border-0">
            <span className={cx('w-[66px] shrink-0 font-bold', l.key.startsWith('TR') ? 'text-brand-800' : 'text-slate-900')}>{l.key}</span>
            <span className="min-w-0">{l.items.slice(0, 4).map((x, k) => <span key={k} className={cx(x.st !== 'ok' && TXT[x.st], x.st === 'bad' && 'font-semibold')}>{k ? ' · ' : ''}{ICON[x.st]} {x.text}</span>)}{l.items.length > 4 && <span className="text-slate-500"> · +{l.items.length - 4}</span>}</span>
          </div>
        ))}
      </div>}
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
      <div className="grid grid-cols-2 gap-2">
        {ORDER.map((id) => { const s = sum[id]; const st = s.state; return (
          <button key={id} type="button" onClick={() => open(id)} className={cx('flex min-h-[128px] flex-col rounded-2xl bg-white p-2.5 text-left', TILE[st])}>
            <Svg make={() => tileIcon(id)} />
            <span className="mt-1 text-[15px] font-bold leading-tight text-slate-900">{NAMES[id]}</span>
            {s.bad > 0 && <span className="text-[12.5px] font-bold leading-tight text-red-700">● {s.bad} {id === 'gas' && p.overrides.length ? 'IOW / override' : 'IOW breach'}</span>}
            {s.off > 0 && <span className="text-[12.5px] font-bold leading-tight text-amber-800">▲ {s.off} off target</span>}
            {s.grey > 0 && <span className="text-[12.5px] font-bold leading-tight text-slate-600">○ {s.grey} not checked{s.greyIow ? ` · ${s.greyIow} IOW` : ''}</span>}
            {s.chk > 0 && <span className="text-[12.5px] font-bold leading-tight text-slate-600">⚑ {s.chk} check</span>}
            {st === 'ok' && <span className="text-[12.5px] font-bold text-green-700">✓ In range</span>}
            <span className="mt-auto pt-1 text-[12.5px] leading-snug text-slate-600 [&_b]:text-slate-900" dangerouslySetInnerHTML={{ __html: key[id] }} />
          </button>); })}
      </div>
      {cat.some(Boolean) && <div className="flex gap-2.5 rounded-xl bg-white px-3 py-2 text-[14px] ring-1 ring-slate-200"><b className="shrink-0">Catalyst</b>
        <span>addition {cat[0]?.tr1 ?? '—'} / {cat[0]?.tr2 ?? '—'} · withdrawal {cat[1]?.tr1 ?? '—'} / {cat[1]?.tr2 ?? '—'} <span className="text-slate-500">(TR-1 / TR-2)</span></span></div>}
    </div>
  );
}
const r0 = (x: number) => x > 0;

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined)}
    className="grid min-h-11 flex-1 place-items-center rounded-xl bg-white text-[15px] font-bold text-slate-900 ring-1 ring-slate-200">{done ? 'Copied' : 'Copy'}</button>;
}

function SectionPage(p: OverviewProps & { sec: SectionId; checks: Check[]; back: () => void }) {
  const [tr, setTr] = useState<1 | 2>(1);
  const common = p.sec === 'frac';
  const train: TrainId = common ? 'Common' : tr === 1 ? 'TR-1' : 'TR-2';
  const side = tr === 1 ? 'tr1' : 'tr2';
  const ctx: DrawCtx = {
    train: tr,
    r: (key) => p.log.readings.find((r) => r.key === key)?.[side] ?? null,
    st: (id) => { const cs = p.checks.filter((c) => c.paramId === id && (c.train === train || c.train === 'Common')); const order: St[] = ['bad', 'off', 'chk', 'grey', 'ok']; return order.find((s) => cs.some((c) => c.state === s)) ?? 'ok'; },
    lab: (material, comp) => {
      const hits = p.lab.filter((s) => kuwaitParts(s.collectedAt)?.date === p.log.date && (s.material ?? '').toUpperCase() === material.toUpperCase() && [train, 'Common'].includes(trainOfEquipment(s.equipment) ?? 'Common'));
      for (const s of hits) { const r = s.results.find((x) => x.component === comp); if (r) return r.value; }
      return null;
    },
    iow: (id) => iowBand(p.limits.get(id)?.iowStd ?? null)?.hi ?? null,
    feed: p.log.feed.find((f) => f.train === (tr === 1 ? 'TR-1' : 'TR-2')) ?? null, products: p.log.products,
    override: !common && p.overrides.some((o) => o.train === train),
  };
  const make = () => drawSection(p.sec, ctx);
  const cs = p.checks.filter((c) => c.section === p.sec);
  const ids = [...new Set(cs.map((c) => c.paramId))];
  const rank = (id: string) => Math.min(...cs.filter((c) => c.paramId === id).map((c) => ({ bad: 0, off: 1, chk: 2, ok: 3, grey: 4 }[c.state])));
  ids.sort((a, b) => rank(a) - rank(b));
  const cell = (c: Check | undefined) => (!c ? <span className="text-slate-300">—</span> : c.state === 'ok' ? <span className="tabular-nums">{c.value}</span>
    : <span className={cx('whitespace-nowrap rounded px-1 font-bold tabular-nums', PILL[c.state])}>{ICON[c.state]} {c.value ?? 'none'}</span>);
  const ov = p.sec === 'gas' ? p.overrides : [];
  return (
    <div className="space-y-2.5">
      <button type="button" onClick={p.back} className="-ml-1 flex min-h-11 items-center px-1 text-[16px] font-bold text-brand-800">‹ Overview</button>
      <h2 className="-mt-2 text-[24px] font-bold text-brand-800">{NAMES[p.sec]}</h2>
      {!common && <div className="flex gap-1.5">{([1, 2] as const).map((t) => <button key={t} type="button" onClick={() => setTr(t)} className={cx('min-h-11 flex-1 rounded-xl border-[1.5px] bg-white text-[15px] font-bold', tr === t ? 'border-brand-800 text-brand-800' : 'border-slate-200 text-slate-500')}>Train {t}</button>)}</div>}
      <div className="rounded-2xl bg-white p-1.5 ring-1 ring-slate-200"><Svg key={`${p.sec}${tr}`} make={make} /></div>
      {ov.map((o) => <div key={o.id} className="rounded-xl bg-red-50 px-3 py-2 text-[14px] text-red-800"><b>● {o.train} {o.item}</b>{o.reason ? ` (${o.reason})` : ''}{o.startedOn ? ` since ${o.startedOn}` : ''} · {o.expiresOn ? `expires ${o.expiresOn}` : 'expiry not set'}{o.moc ? ` · MOC ${o.moc}` : ' · MOC not set'}<div className="text-[12.5px] text-red-700/80">{o.source}</div></div>)}
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
      <p className="px-1 text-[12.5px] text-slate-500">Your limit library as written; ○ = the library has a limit but the e-logbook or lab has no value. {common ? 'Shared by both trains.' : 'Train-2 tags generated from Train 1, to verify.'}</p>
    </div>
  );
}
