// Unit log (owner, 24–25 Nov 2026: "build logbook dashboard based on it; it have the normal logbook and samples result"):
// the ARDS shift log, the trains' readings and the lab results, read from the e-mails the owner's Mac saves at 6:50 am
// and pm. ARDS only; the HTU log is behind a switch ("only for information"), and the Controller I log adds its ARDS part.
// Read only, and nothing is judged: no limits are set, so no value is called high or low.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BottomSheet, Chip, EmptyState, ErrorBox, Spinner, cx } from '@/ui/components';
import { fetchLabSamples, fetchLimits, fetchOverrides, fetchUnitLogs } from '@/data/unitLog';
import type { Override } from '@/core/logbook/board';
import Overview from './Overview';
import { limitBand, limitForLab, limitForReading, limitState, type Limit, type LimitMatch, type LimitState } from '@/core/logbook/limits';
import {
  byShiftDesc, eventsIn, followUps, isSkin, kuwaitParts, labDays, labTrend, readingBy, samplePoint, samplesOn, sameShift, skinGrid, trendOf,
  type StoredLog, type StoredSample,
} from '@/core/logbook/view';
import type { RemarkSection } from '@/core/logbook/parse';

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const when = (iso: string | null) => { const k = kuwaitParts(iso); return k ? `${day(k.date)} ${k.time}` : '—'; };
const shiftName = (l: StoredLog) => `${day(l.date)} · ${l.shift ?? '?'}`;
const pair = (a: string | null | undefined, b: string | null | undefined) => (a ?? '—') === (b ?? '—') ? (a ?? '—') : `${a ?? '—'} / ${b ?? '—'}`;

type Tab = 'overview' | 'shift' | 'trains' | 'lab';

// The limit library (owner's spec §4.1): a value is coloured by its traffic light; nothing is coloured without a library.
interface Lib { limits: Map<string, Limit>; matches: LimitMatch[] }
const LibCtx = createContext<Lib>({ limits: new Map(), matches: [] });
const TONE: Record<LimitState, string> = { normal: '', off: 'bg-amber-100 text-amber-900', breach: 'bg-red-100 text-red-800', critical: 'bg-red-700 text-white' };
const WORD: Record<LimitState, string> = { normal: 'In range', off: 'Off target', breach: 'Limit breach', critical: 'Critical' };
const Val = ({ v, st }: { v: ReactNode; st: LimitState | null }) => <span className={cx('rounded px-1 tabular-nums', st && TONE[st])}>{v}</span>;
function readingLimit(lib: Lib, key: string) { return limitForReading(key, lib.matches, lib.limits); }
const stateOf = (lib: Lib, key: string, v: string | null) => { const m = readingLimit(lib, key); return m ? limitState(v, m.limit, m.scale) : null; };
interface Exception { what: string; where: string; value: string; band: string; state: LimitState; limit: Limit }
/** What is outside its limits in this log and in that day's lab results, worst first. */
function exceptionsOf(lib: Lib, log: StoredLog, lab: StoredSample[]): Exception[] {
  const out: Exception[] = [];
  for (const r of log.readings) {
    const m = readingLimit(lib, r.key); if (!m) continue;
    for (const [side, v] of [['TR-1', r.tr1], ['TR-2', r.tr2]] as const) {
      const st = limitState(v, m.limit, m.scale);
      if (st && st !== 'normal') out.push({ what: r.label, where: side, value: `${v} ${r.unit ?? ''}`.trim(), band: limitBand(m.limit), state: st, limit: m.limit });
    }
  }
  for (const smp of samplesOn(lab, log.date)) for (const r of smp.results) {
    const l = limitForLab(smp.material, smp.equipment, r.component, lib.matches, lib.limits); if (!l) continue;
    const st = limitState(r.value, l);
    if (st && st !== 'normal') out.push({ what: `${r.component}`, where: `${samplePoint(smp)} · ${kuwaitParts(smp.collectedAt)?.time ?? ''}`, value: `${r.value}${r.unit ? ` ${r.unit}` : ''}`, band: limitBand(l), state: st, limit: l });
  }
  const rank = { critical: 0, breach: 1, off: 2, normal: 3 };
  return out.sort((a, b) => rank[a.state] - rank[b.state]);
}
const TABS: { key: Tab; label: string }[] = [{ key: 'overview', label: 'Overview' }, { key: 'trains', label: 'Trains' }, { key: 'lab', label: 'Lab' }, { key: 'shift', label: 'Shift log' }];

export default function UnitLogPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((x) => x.key === params.get('tab'))?.key ?? 'overview') as Tab;
  const [logs, setLogs] = useState<StoredLog[] | null>(null);
  const [lab, setLab] = useState<StoredSample[] | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [i, setI] = useState(0);
  const [lib, setLib] = useState<Lib>({ limits: new Map(), matches: [] });
  const [overrides, setOverrides] = useState<Override[]>([]);

  useEffect(() => {
    Promise.all([fetchUnitLogs(), fetchLabSamples()]).then(([l, s]) => { setLogs(l.logs); setLast(l.lastReceived); setLab(s); }).catch(setErr);
    fetchLimits().then(setLib).catch(() => undefined);
    fetchOverrides().then(setOverrides).catch(() => undefined);
  }, []);

  const ards = useMemo(() => byShiftDesc((logs ?? []).filter((l) => l.kind === 'ards')), [logs]);
  if (err) return <ErrorBox error={err} />;
  if (!logs || !lab) return <Spinner />;
  const go = (k: Tab) => { const n = new URLSearchParams(params); n.set('tab', k); n.delete('sec'); n.delete('train'); n.delete('side'); setParams(n, { replace: true }); };

  return (
    <LibCtx.Provider value={lib}>
    <div className="space-y-3 lg:max-w-3xl">
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm" role="tablist">
        {TABS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} onClick={() => go(x.key)}
            className={cx('min-h-11 flex-1 rounded-lg text-[15px] font-medium', tab === x.key ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{x.label}</button>
        ))}
      </div>
      {tab === 'lab' ? <LabView samples={lab} /> : !ards.length ? <EmptyState title="No shift log yet" body="Logs arrive after the 6:50 am and pm e-mail export on the Mac." /> : (
        <>
          <Picker label={<><b>{shiftName(ards[i])}</b><div className="text-[12.5px] text-slate-500">{ards[i].crew ?? '?'} Shift · Log #{ards[i].logNo}{tab === 'overview' ? ' · mode not set (Normal limits)' : ''}</div></>}
            older={i < ards.length - 1 ? () => setI(i + 1) : undefined} newer={i > 0 ? () => setI(i - 1) : undefined} />
          {tab === 'overview' ? <Overview log={ards[i]} controller={logs.find((l) => l.kind === 'controller1' && sameShift(l, ards[i])) ?? null} lab={lab} limits={lib.limits} matches={lib.matches} overrides={overrides} />
            : tab === 'shift' ? <ShiftView log={ards[i]} before={ards.slice(i + 1)} all={logs} lab={lab} /> : <TrainsView log={ards[i]} before={ards.slice(i + 1)} />}
        </>
      )}
      <p className="text-[11px] text-slate-500">From the log and lab e-mails, read at 6:50 am and pm{last ? ` · last received ${when(last)}` : ''}. {lib.limits.size
        ? <>Colours follow the limit library: <span className="rounded bg-amber-100 px-1 text-amber-900">off target</span> <span className="rounded bg-red-100 px-1 text-red-800">IOW breach</span> <span className="rounded bg-red-700 px-1 text-white">critical</span>; limits marked “verify” are still to be checked.</>
        : 'Read only: nothing here is marked high or low until limits are set.'}</p>
    </div>
    </LibCtx.Provider>
  );
}

function Picker({ label, older, newer }: { label: ReactNode; older?: () => void; newer?: () => void }) {
  const b = 'h-11 w-11 shrink-0 rounded-xl bg-white text-lg ring-1 ring-slate-200 disabled:opacity-30';
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={b} disabled={!older} onClick={older} aria-label="Older">‹</button>
      <div className="min-w-0 flex-1 text-center text-[14px] leading-tight text-slate-800">{label}</div>
      <button type="button" className={b} disabled={!newer} onClick={newer} aria-label="Newer">›</button>
    </div>
  );
}

const Head = ({ children, tone = 'text-slate-500' }: { children: ReactNode; tone?: string }) => <h3 className={cx('px-1 pt-1 text-[11px] font-bold uppercase tracking-wide', tone)}>{children}</h3>;
const Box = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cx('rounded-2xl bg-white ring-1 ring-slate-200', className)}>{children}</div>;

// ── Shift log ─────────────────────────────────────────────────────────────────────────────────────────────────
function ShiftView({ log, before, all, lab }: { log: StoredLog; before: StoredLog[]; all: StoredLog[]; lab: StoredSample[] }) {
  const lib = useContext(LibCtx);
  const ex = exceptionsOf(lib, log, lab);
  const [htu, setHtu] = useState(false);
  const [allTags, setAllTags] = useState(false);
  const ctl = all.find((l) => l.kind === 'controller1' && sameShift(l, log));
  const sections = [...log.sections, ...(ctl?.sections ?? [])];
  const events = eventsIn(sections);
  const tags = followUps(log.sections, before.map((b) => b.sections));
  const htuLog = all.find((l) => l.kind === 'htu' && sameShift(l, log));
  const feed = readingBy(log, 'FEEDRATE'), wabt = readingBy(log, 'WABTTOTAL'), sys = readingBy(log, 'SYSTEMPRESSURE');
  const lsar = log.products.find((p) => /^LSAR$/i.test(p.product));
  const figs = [feed && [pair(feed.tr1, feed.tr2), `Feed ${feed.unit ?? ''}`], wabt && [pair(wabt.tr1, wabt.tr2), `WABT ${wabt.unit ?? ''}`],
    sys && [pair(sys.tr1, sys.tr2), `System ${sys.unit ?? ''}`], lsar && [lsar.value ?? '—', `LSAR ${lsar.unit ?? ''}`]].filter(Boolean) as [string, string][];
  return (
    <>
      {figs.length > 0 && <Box className="grid grid-cols-4 gap-1 px-2 py-2.5 text-center">
        {figs.map(([v, l]) => <div key={l}><div className="text-[17px] font-bold leading-tight text-slate-900">{v}</div><div className="text-[10px] font-semibold uppercase text-slate-500">{l}</div></div>)}
      </Box>}
      {figs.length > 0 && <p className="-mt-2 px-1 text-[11px] text-slate-500">TR-1 / TR-2 when they differ</p>}
      {lib.limits.size > 0 && <>
        <Head tone={ex.some((x) => x.state !== 'off') ? 'text-red-800' : 'text-amber-800'}>Outside limits · {ex.length ? ex.length : 'none'}</Head>
        {ex.length > 0 && <Box className="divide-y divide-slate-100">
          {ex.map((x, k) => (
            <div key={k} className="px-3 py-2 text-[13px]">
              <div className="flex items-start gap-2">
                <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold', TONE[x.state])}>{WORD[x.state]}</span>
                <span className="min-w-0 flex-1"><b>{x.what}</b> <span className="text-slate-500">· {x.where}</span></span>
                <b className="shrink-0 tabular-nums">{x.value}</b>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">Limit {x.band}{x.limit.status === 'verify' ? ' (verify)' : ''} · {x.limit.source}{x.limit.action ? ` · ${x.limit.action}` : ''}</div>
            </div>
          ))}
        </Box>}
      </>}
      {events.length > 0 && <>
        <Head tone="text-red-800">Events this shift</Head>
        <Box className="divide-y divide-slate-100">{events.map((e) => <div key={e.text} className="flex gap-2 px-3 py-2 text-[13px]"><Chip tone="red" className="shrink-0">{e.word}</Chip><span>{e.text}{e.group ? <span className="text-slate-500"> · {e.group}</span> : null}</span></div>)}</Box>
      </>}
      {tags.length > 0 && <>
        <Head tone="text-amber-800">Equipment named · {tags.length}</Head>
        <Box className="divide-y divide-slate-100">
          {(allTags ? tags : tags.slice(0, 8)).map((t) => (
            <div key={t.tag} className="flex items-start gap-2 px-3 py-2 text-[13px]">
              <b className="w-[72px] shrink-0 text-brand-800">{t.tag}</b>
              <span className="min-w-0 flex-1 text-slate-700">{t.text}</span>
              <Chip tone={t.logs > 1 ? 'amber' : 'neutral'} className="shrink-0">{t.logs > 1 ? `${t.logs} logs` : 'new'}</Chip>
            </div>
          ))}
          {tags.length > 8 && <button type="button" className="w-full px-3 py-2 text-left text-[13px] font-semibold text-brand-700" onClick={() => setAllTags(!allTags)}>{allTags ? 'Show fewer' : `All ${tags.length} ›`}</button>}
        </Box>
        <p className="-mt-2 px-1 text-[11px] text-slate-500">Tags the remarks name; “3 logs” = named in this log and the 2 before it.</p>
      </>}
      <Remarks sections={sections} />
      <label className="flex items-center gap-2 px-1 pt-1 text-[13px] text-slate-700">
        <input type="checkbox" checked={htu} onChange={(e) => setHtu(e.target.checked)} /> Show the HTU log (information only)
      </label>
      {htu && (htuLog ? <><Head>HTU · Log #{htuLog.logNo}</Head><Remarks sections={htuLog.sections} open /></> : <p className="px-1 text-[13px] text-slate-500">No HTU log for this shift.</p>)}
    </>
  );
}

function Remarks({ sections, open = false }: { sections: RemarkSection[]; open?: boolean }) {
  if (!sections.length) return <p className="px-1 text-[13px] text-slate-500">No remarks in this log.</p>;
  return (
    <div className="space-y-2">
      {sections.map((s, si) => (
        <details key={`${s.role}${si}`} open={open || si === 0} className="rounded-2xl bg-white ring-1 ring-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Remarks · {s.role} · {s.groups.reduce((n, g) => n + g.items.length, 0)}</summary>
          <div className="space-y-2 px-3 pb-3">
            {s.groups.map((g, gi) => (
              <div key={gi}>
                {g.group && <div className="text-[12px] font-bold text-slate-800">{g.group}</div>}
                <ul className="ms-4 list-disc text-[13px] text-slate-700">{g.items.map((it, k) => <li key={k}>{it}</li>)}</ul>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

// ── Trains ────────────────────────────────────────────────────────────────────────────────────────────────────
function TrainsView({ log, before }: { log: StoredLog; before: StoredLog[] }) {
  const lib = useContext(LibCtx);
  const [trend, setTrend] = useState<string | null>(null);
  const prev = before[0];
  const rows = log.readings.filter((r) => !isSkin(r));
  const grid = skinGrid(log.readings);
  const was = (key: string, side: 'tr1' | 'tr2', now: string | null) => { const p = readingBy(prev, key)?.[side]; return prev && p !== undefined && p !== now ? p ?? '—' : null; };
  const series = trend ? trendOf([log, ...before], trend) : [];
  return (
    <>
      {prev && <p className="-mt-1 px-1 text-[12px] text-slate-500">Small grey number: the log before ({shiftName(prev)}) when it was different. Tap a row for its trend.</p>}
      <Box className="overflow-hidden">
        <table className="w-full text-[13px]">
          <thead><tr className="text-[10px] uppercase tracking-wide text-slate-500"><th className="px-3 py-1.5 text-left">Reading</th><th className="px-1 text-right">TR-1</th><th className="px-1 text-right">TR-2</th><th className="px-3 text-right">Unit</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.key} className="cursor-pointer active:bg-slate-50" onClick={() => setTrend(r.key)}>
                <td className="px-3 py-1.5 text-[12px] leading-tight text-slate-800">{r.label}{(() => { const m = readingLimit(lib, r.key); return m ? <div className="text-[10px] text-slate-500">{limitBand(m.limit)}{m.scale !== 1 ? ` ${m.limit.unit}` : ''}{m.limit.status === 'verify' ? ' · verify' : ''}</div> : null; })()}</td>
                {(['tr1', 'tr2'] as const).map((side) => { const w = was(r.key, side, r[side]); return (
                  <td key={side} className="px-1 text-right">{r[side] !== null ? <Val v={r[side]} st={stateOf(lib, r.key, r[side])} /> : <span className="text-slate-400">—</span>}{w !== null && <div className="text-[10px] text-slate-400">{w}</div>}</td>); })}
                <td className="px-3 text-right text-[11px] text-slate-500">{r.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
      {grid && <>
        <Head>Heater skin temperatures · {grid.unit}{(() => { const b = grid.keys.map((k) => readingLimit(lib, k.replace('#', '1'))).filter(Boolean).map((m) => `${m!.limit.paramId} ${limitBand(m!.limit)}`); return b.length ? <span className="font-normal normal-case"> · {b.join(' · ')}</span> : null; })()}</Head>
        <Box className="overflow-hidden">
          <table className="w-full text-[13px] tabular-nums">
            <thead><tr className="text-[10px] uppercase tracking-wide text-slate-500"><th className="px-3 py-1.5 text-left">Pass</th>{grid.heaters.map((h) => <th key={h} className="px-2 text-right">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {grid.passes.map((p) => <tr key={p.pass}><td className="px-3 py-1.5">{p.pass}</td>{p.values.map((v, k) => <td key={k} className="px-2 text-right">{v !== null ? <Val v={v} st={stateOf(lib, grid.keys[Math.floor(k / 2)]?.replace('#', String(p.pass)) ?? '', v)} /> : <Chip tone="red">no reading</Chip>}</td>)}</tr>)}
            </tbody>
          </table>
        </Box>
      </>}
      {log.feed.length > 0 && <>
        <Head>Feed & charge filter</Head>
        <Box className="divide-y divide-slate-100 text-[13px]">
          {log.feed.map((f) => <div key={f.train} className="flex justify-between px-3 py-1.5"><b>{f.train}</b><span className="text-slate-700">{f.total ?? '—'} KBPD · hot {f.hot ?? '—'} · cold {f.cold ?? '—'} · backwash {f.backwashMin ?? '—'} min</span></div>)}
        </Box>
      </>}
      {log.products.length > 0 && <>
        <Head>Products</Head>
        <Box className="grid grid-cols-4 gap-1 px-2 py-2.5 text-center">
          {log.products.map((p) => <div key={p.product}><div className="text-[17px] font-bold text-slate-900">{p.value ?? '—'}</div><div className="text-[10px] leading-tight text-slate-500">{p.product} {p.unit}<br />{p.route}</div></div>)}
        </Box>
      </>}
      <BottomSheet open={!!trend} onClose={() => setTrend(null)} title={series[0]?.r?.label ?? 'Trend'}>
        <table className="w-full text-[13px] tabular-nums">
          <thead><tr className="text-[10px] uppercase text-slate-500"><th className="py-1 text-left">Shift</th><th className="text-right">TR-1</th><th className="text-right">TR-2</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{series.map(({ log: l, r }) => <tr key={l.logNo}><td className="py-1.5">{shiftName(l)} · {l.crew}</td><td className="text-right">{r!.tr1 ?? '—'}</td><td className="text-right">{r!.tr2 ?? '—'}</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-[11px] text-slate-500">{series[0]?.r?.unit} · the logs received so far, newest first.</p>
      </BottomSheet>
    </>
  );
}

// ── Lab ───────────────────────────────────────────────────────────────────────────────────────────────────────
function LabView({ samples }: { samples: StoredSample[] }) {
  const lib = useContext(LibCtx);
  const days = labDays(samples);
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<{ s: StoredSample; component: string } | null>(null);
  if (!days.length) return <EmptyState title="No lab results yet" body="Results arrive after the 6:50 am and pm e-mail export on the Mac." />;
  const list = samplesOn(samples, days[i]);
  const latest = kuwaitParts(list[list.length - 1]?.collectedAt ?? null)?.time;
  const series = pick ? labTrend(samples, pick.s, pick.component) : [];
  return (
    <>
      <Picker label={<><b>{day(days[i])}</b><span className="text-slate-500"> · {list.length} sample{list.length === 1 ? '' : 's'}{latest ? ` · latest ${latest}` : ''}</span></>}
        older={i < days.length - 1 ? () => setI(i + 1) : undefined} newer={i > 0 ? () => setI(i - 1) : undefined} />
      <Box className="divide-y divide-slate-100">
        {list.map((s) => (
          <div key={s.sampleId} className="px-3 py-2">
            <div className="flex justify-between gap-2 text-[13px]"><b className="text-slate-900">{samplePoint(s)}</b><span className="shrink-0 text-slate-500">{kuwaitParts(s.collectedAt)?.time ?? '—'}</span></div>
            {s.note && <div className="text-[11px] text-slate-500">{s.note}</div>}
            <div className="mt-1 flex flex-wrap gap-1">
              {s.results.map((r) => { const l = limitForLab(s.material, s.equipment, r.component, lib.matches, lib.limits); const st = l ? limitState(r.value, l) : null; return (
                <button key={r.component} type="button" onClick={() => setPick({ s, component: r.component })}
                  className={cx('rounded-lg px-2 py-0.5 text-left text-[12px] ring-1 active:bg-slate-100', st && st !== 'normal' ? cx(TONE[st], 'ring-transparent') : 'bg-slate-50 ring-slate-200')}>
                  <span className={st && st !== 'normal' ? '' : 'text-slate-500'}>{r.component}</span> <b className="tabular-nums">{r.value}</b>{r.unit ? <span className={st && st !== 'normal' ? '' : 'text-slate-500'}> {r.unit}</span> : null}
                  {l && <span className="ms-1 text-[10px] opacity-70">({limitBand(l)})</span>}
                </button>); })}
              {!s.results.length && <span className="text-[12px] text-slate-500">No results on the report.</span>}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-400">{s.sampleId}</div>
          </div>
        ))}
      </Box>
      <BottomSheet open={!!pick} onClose={() => setPick(null)} title={pick ? `${pick.component} · ${samplePoint(pick.s)}` : 'Trend'}>
        <table className="w-full text-[13px] tabular-nums">
          <tbody className="divide-y divide-slate-100">{series.map(({ s, r }) => <tr key={s.sampleId}><td className="py-1.5">{when(s.collectedAt)}</td><td className="text-right font-semibold">{r!.value}</td><td className="ps-2 text-[11px] text-slate-500">{r!.unit}</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-[11px] text-slate-500">Every result for this point received so far, newest first.{(() => { const l = pick && limitForLab(pick.s.material, pick.s.equipment, pick.component, lib.matches, lib.limits); return l ? ` Limit ${limitBand(l)} · ${l.source ?? ''}` : ' No limit set for it.'; })()}</p>
      </BottomSheet>
    </>
  );
}
