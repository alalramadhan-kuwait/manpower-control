// PV planner: the annual leave plan entered by cycle. One calendar per shift (columns are that crew's 8-day cycles, M1 to Off2),
// a tap books or frees a whole cycle, back-to-back cycles make one longer leave. The Section Head's rules are checked as you tap.
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, Sun } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CREWS, addDaysIso, type Crew } from '@/core/roster';
import { PV_RULES, blockReason, checkPv, cyclesOf, panelFill, runsOf, type PvContext, type PvCycle, type PvIssue, type PvPerson, type PvRole, type PvShift } from '@/core/pv';
import { applyPvBlocks, fetchPv, type PvData } from '@/data/pv';
import { BottomSheet, Button, Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { shortDate } from '@/ui/leave';

const ROLES = new Set<string>(['controller', 'vr_controller', 'morning_controller', 'panel_operator', 'field_operator']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
type Tab = Crew | 'ctl';
type Span = 'year' | 'q1' | 'q2' | 'q3' | 'q4';
const SPANS: { key: Span; label: string; sub: string }[] = [{ key: 'q1', label: 'Q1', sub: 'Jan–Mar' }, { key: 'q2', label: 'Q2', sub: 'Apr–Jun' }, { key: 'q3', label: 'Q3', sub: 'Jul–Sep' }, { key: 'q4', label: 'Q4', sub: 'Oct–Dec' }, { key: 'year', label: 'Year', sub: 'all 46' }];
const quarterOf = (c: PvCycle): Span => `q${Math.ceil(Number(c.start.slice(5, 7)) / 3)}` as Span;

interface Model {
  year: number;
  people: Map<string, PvPerson>;
  cycles: Record<Crew, PvCycle[]>;
  groups: Record<Crew, { controllers: PvPerson[]; panel: PvPerson[]; acting: PvPerson[]; field: PvPerson[]; ranked: PvPerson[]; short: number }>;
  picks: Map<string, Set<number>>;
  existing: Map<string, { id: string; start: string; end: string }[]>;
  others: Map<string, { start: string; end: string; code: string }[]>;
  shutdowns: PvData['shutdowns'];
  ctlLeave: { employeeId: string; start: string; end: string; code: string }[];
}

function buildModel(data: PvData): Model {
  const { year } = data;
  const people = new Map<string, PvPerson>();
  for (const r of data.people) {
    if (!r.position_code || !ROLES.has(r.position_code)) continue;
    people.set(r.id, { id: r.id, name: r.display_name, number: r.employee_number, crew: r.crew_code, role: r.position_code as PvRole, grade: r.grade, gradeSince: r.last_promotion_date, sick: data.sick.get(r.id) ?? 0 });
  }
  const cycles = Object.fromEntries(CREWS.map((c) => [c, cyclesOf(c, year)])) as Record<Crew, PvCycle[]>;
  const groups = {} as Model['groups'];
  for (const c of CREWS) {
    const shift = [...people.values()].filter((p) => p.crew === c);
    const fill = panelFill(shift);
    const acting = new Set(fill.acting.map((p) => p.id));
    groups[c] = { controllers: shift.filter((p) => p.role === 'controller').sort((a, b) => a.name.localeCompare(b.name)), panel: fill.panel, acting: fill.acting, ranked: fill.ranked, short: fill.short,
      field: shift.filter((p) => p.role === 'field_operator' && !acting.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)) };
  }
  const picks = new Map<string, Set<number>>(), existing: Model['existing'] = new Map(), others: Model['others'] = new Map();
  const ctlLeave: Model['ctlLeave'] = [];
  const isCtl = (id: string) => ['controller', 'vr_controller', 'morning_controller'].includes(people.get(id)?.role ?? '');
  for (const l of data.leaves) {
    if (!(l.in_current_plan && (l.status === 'approved' || l.status === 'planned'))) continue;
    const p = people.get(l.employee_id); if (!p) continue;
    const mine = p.crew ? cycles[p.crew] : [];
    const a = mine.findIndex((c) => c.start === l.start_date), b = mine.findIndex((c) => c.end === l.end_date);
    const annual = (l.absence_type_code ?? '').startsWith('annual_leave');
    if (annual && a >= 0 && b >= a) {
      const set = picks.get(p.id) ?? new Set<number>(); for (let i = a; i <= b; i++) set.add(i); picks.set(p.id, set);
      existing.set(p.id, [...(existing.get(p.id) ?? []), { id: l.id, start: l.start_date, end: l.end_date }]);
    } else {
      others.set(p.id, [...(others.get(p.id) ?? []), { start: l.start_date, end: l.end_date, code: l.absence_type_code ?? '' }]);
      if (isCtl(p.id)) ctlLeave.push({ employeeId: p.id, start: l.start_date, end: l.end_date, code: l.absence_type_code ?? '' });
    }
  }
  return { year, people, cycles, groups, picks, existing, others, shutdowns: data.shutdowns, ctlLeave };
}

const shortName = (n: string) => { const w = n.split(' '); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : n; };
const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start <= b.end && b.start <= a.end;
const rangeLabel = (c: PvCycle) => `${Number(c.start.slice(8))} ${MONTHS[Number(c.start.slice(5, 7)) - 1]} – ${Number(c.end.slice(8))} ${MONTHS[Number(c.end.slice(5, 7)) - 1]}`;

export default function PvPage() {
  const [params, setParams] = useSearchParams();
  const year = Number(params.get('year')) || new Date().getFullYear() + 1;
  const span: Span = (SPANS.find((x) => x.key === params.get('span'))?.key) ?? 'q1';
  const tab: Tab = (['A', 'B', 'C', 'D', 'ctl'] as const).find((t) => t === params.get('shift')) ?? 'A';
  const [data, setData] = useState<PvData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [local, setLocal] = useState<Map<string, Set<number>>>(new Map());
  const [busy, setBusy] = useState(0);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<{ p: PvPerson; index: number; reason: string } | null>(null);
  const [sheet, setSheet] = useState<PvPerson | null>(null);
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v === null) n.delete(k); else n.set(k, v); setParams(n, { replace: true }); };
  const load = useCallback(() => fetchPv(year).then((d) => { setData(d); setLocal(new Map()); }).catch(setError), [year]);
  useEffect(() => { setData(null); load(); }, [load]);
  const model = useMemo(() => (data ? buildModel(data) : null), [data]);
  const picks = useMemo(() => { const m = new Map(model?.picks); for (const [id, s] of local) m.set(id, s); return m; }, [model, local]);
  const names = useMemo(() => new Map([...(model?.people ?? [])].map(([id, p]) => [id, p.name])), [model]);
  const shifts = useMemo<PvShift[]>(() => (model ? CREWS.map((c) => ({ crew: c, cycles: model.cycles[c], controllers: model.groups[c].controllers.map((p) => p.id), panel: [...model.groups[c].panel, ...model.groups[c].acting].map((p) => p.id), field: model.groups[c].field.map((p) => p.id) })) : []), [model]);
  const ctx = useMemo<PvContext>(() => ({ shifts, picks, controllerLeave: (model?.ctlLeave ?? []).map((l) => ({ employeeId: l.employeeId, start: l.start, end: l.end })), shutdowns: model?.shutdowns, names }), [shifts, picks, model, names]);
  const issues = useMemo(() => (model ? checkPv({ ...ctx, shifts }) : [] as PvIssue[]), [model, ctx, shifts]);

  async function book(p: PvPerson, index: number) {
    if (!model || !p.crew) return;
    const cycles = model.cycles[p.crew];
    const next = new Set(picks.get(p.id) ?? []); if (next.has(index)) next.delete(index); else next.add(index);
    setLocal((m) => new Map(m).set(p.id, next)); setSaveError(null); setBusy((n) => n + 1);
    try {
      await applyPvBlocks({ employeeId: p.id, year, existing: model.existing.get(p.id) ?? [], blocks: runsOf(next).map(([a, b]) => ({ start: cycles[a].start, end: cycles[b].end })) });
    } catch (e) { setSaveError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy((n) => n - 1); }
  }
  /** A tap: booking a cycle that breaks a rule asks first; freeing one never does. */
  function tap(p: PvPerson, index: number) {
    const on = picks.get(p.id)?.has(index) ?? false;
    const reason = on ? null : blockReason(ctx, p.id, index);
    if (reason) setPending({ p, index, reason }); else void book(p, index);
  }
  useEffect(() => { if (busy === 0 && local.size > 0) { load(); setSaved(true); const t = setTimeout(() => setSaved(false), 2500); return () => clearTimeout(t); } }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader title="PV plan" subtitle="Annual leave by whole cycle" info={<div className="space-y-2 text-sm text-slate-700">
        <p>A cycle is 8 days: 6 duty days as one block, then 2 off days. A leave starts on the first day of the crew&apos;s cycle and covers whole cycles; cycles side by side make one longer leave. Tap a cycle to book it, tap again to free it. Tap a name to see the whole year of that person.</p>
        <p><b>Rules:</b> two Controllers are never off together (all shifts) · Panel: one off at a time per shift · Field: two at most per shift · summer (June to September) is peak time: one leave of two cycles at the longest · a shutdown team member takes no leave in the shutdown.</p>
        <p><b>Panel seats:</b> each shift keeps {PV_RULES.panelSeats}. When there are fewer Panel Operators than that, Grade 13 Field Operators fill the seats for the plan: longest in grade first, then the least sick leave.</p>
        <p>A cycle that would break a rule is shown in pink with the reason. You can still book it after a confirmation; it stays red until it is approved or moved.</p>
      </div>} />
      <div className="mb-2 flex items-center gap-2">
        <div className="flex flex-1 items-center justify-between rounded-xl bg-white px-1 py-0.5 ring-1 ring-slate-200 lg:w-64 lg:flex-none">
          <button type="button" aria-label="Previous year" onClick={() => set('year', String(year - 1))} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 active:bg-slate-100"><ChevronLeft className="h-5 w-5" /></button>
          <span className="text-base font-semibold text-brand-800">{year}</span>
          <button type="button" aria-label="Next year" onClick={() => set('year', String(year + 1))} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 active:bg-slate-100"><ChevronRight className="h-5 w-5" /></button>
        </div>
        <StatusLine issues={issues} saving={busy > 0} saved={saved} ready={!!model} />
      </div>
      <div role="tablist" className="mb-2 grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1 text-sm lg:max-w-2xl">
        {([...CREWS, 'ctl'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => set('shift', t === 'A' ? null : t)} className={cx('flex min-h-10 items-center justify-center gap-1 rounded-lg font-medium', tab === t ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>
            {t === 'ctl' ? 'Controllers' : <><CrewBadge crew={t} size="sm" />{t}</>}
          </button>
        ))}
      </div>
      {tab !== 'ctl' && (
        <div role="tablist" aria-label="Part of the year" className="mb-2 grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1 text-sm lg:max-w-2xl">
          {SPANS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={span === x.key} onClick={() => set('span', x.key === 'q1' ? null : x.key)} className={cx('min-h-10 rounded-lg font-medium leading-tight', span === x.key ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>
              {x.label}<span className="block text-[10px] font-normal text-slate-500">{x.sub}</span>
            </button>
          ))}
        </div>
      )}
      {error ? <ErrorBox error={error} /> : !model ? <Spinner /> : tab === 'ctl' ? <ControllersTimeline model={model} picks={picks} issues={issues} /> : (
        <ShiftGrid model={model} crew={tab} span={span} picks={picks} issues={issues} ctx={ctx} busy={busy > 0} onTap={tap} onPerson={setSheet} />
      )}
      {saveError && <p role="alert" className="mt-2 flex items-start gap-1 text-sm text-status-red"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{saveError}</p>}

      <BottomSheet open={!!pending} onClose={() => setPending(null)} title="This breaks a rule">
        {pending && model && (
          <div className="space-y-3">
            <p className="text-sm text-slate-800"><b>{pending.p.name}</b> · {rangeLabel(model.cycles[pending.p.crew!][pending.index])}</p>
            <p className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-status-red ring-1 ring-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{pending.reason}</p>
            <p className="text-xs text-slate-600">You can book it anyway: it stays red in the plan until it is approved or moved.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setPending(null)}>Choose another</Button>
              <Button onClick={() => { const x = pending; setPending(null); void book(x.p, x.index); }}>Book anyway</Button>
            </div>
          </div>
        )}
      </BottomSheet>
      {sheet && model && <PersonSheet model={model} person={sheet} picks={picks} ctx={ctx} busy={busy > 0} onTap={tap} onClose={() => setSheet(null)} />}
    </div>
  );
}

function StatusLine({ issues, saving, saved, ready }: { issues: PvIssue[]; saving: boolean; saved: boolean; ready: boolean }) {
  const n = new Set(issues.map((i) => i.text)).size;
  if (!ready) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs font-medium">
      {saving ? <span className="flex items-center gap-1 text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</span> : saved ? <span className="flex items-center gap-1 text-status-green"><Check className="h-3.5 w-3.5" />Saved</span> : null}
      {n > 0
        ? <span className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1.5 text-status-red ring-1 ring-red-200"><AlertTriangle className="h-3.5 w-3.5" />{n} {n === 1 ? 'break' : 'breaks'}</span>
        : <span className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1.5 text-green-800 ring-1 ring-green-200"><Check className="h-3.5 w-3.5" />Rules met</span>}
    </div>
  );
}

function ShiftGrid({ model, crew, span, picks, issues, ctx, busy, onTap, onPerson }: { model: Model; crew: Crew; span: Span; picks: Map<string, Set<number>>; issues: PvIssue[]; ctx: PvContext; busy: boolean; onTap: (p: PvPerson, i: number) => void; onPerson: (p: PvPerson) => void }) {
  const cycles = model.cycles[crew], g = model.groups[crew];
  const scroller = useRef<HTMLDivElement>(null);
  const mine = issues.filter((i) => i.crew === crew || i.crew === null);
  const bad = new Set<string>();
  for (const i of mine) for (const id of i.employeeIds) {
    if (i.kind === 'summer' || i.kind === 'leaves') { for (const c of picks.get(id) ?? []) if (i.kind === 'leaves' || cycles[c]?.summer) bad.add(`${id}|${c}`); }
    else if (i.cycle != null) bad.add(`${id}|${i.cycle}`);
  }
  const shown = span === 'year' ? cycles : cycles.filter((c) => quarterOf(c) === span);
  const detail = span !== 'year';
  const grid = { gridTemplateColumns: `var(--name) repeat(${shown.length}, minmax(var(--col), 1fr))` };
  const gridMin = { minWidth: `calc(var(--name) + ${shown.length} * var(--col))` };
  const [overflow, setOverflow] = useState(true);
  useEffect(() => { const el = scroller.current; if (!el) return; const f = () => setOverflow(el.scrollWidth > el.clientWidth + 2); f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect(); }, [cycles.length]);
  const panelIds = [...g.panel, ...g.acting].map((p) => p.id);
  const sections: { title: string; sub?: string; people: PvPerson[]; ids: string[]; max?: number; acting?: Set<string> }[] = [
    { title: 'Controller', people: g.controllers, ids: g.controllers.map((p) => p.id) },
    { title: `Panel · ${PV_RULES.panelSeats} seats`, sub: 'one at a time', people: [...g.panel, ...g.acting], ids: panelIds, max: PV_RULES.panelMaxOff, acting: new Set(g.acting.map((p) => p.id)) },
    { title: 'Field', sub: 'two at most', people: g.field, ids: g.field.map((p) => p.id), max: PV_RULES.fieldMaxOff }
  ];
  const jump = (m: number) => {
    const i = cycles.findIndex((c) => Number(c.start.slice(5, 7)) >= m); const box = scroller.current; if (i < 0 || !box) return;
    const col = box.querySelector<HTMLElement>(`[data-cycle="${i}"]`), name = box.querySelector<HTMLElement>('[data-name]');
    if (col) box.scrollTo({ left: col.offsetLeft - (name?.offsetWidth ?? 0), behavior: 'smooth' });
  };
  const everyone = [...g.controllers, ...g.panel, ...g.acting, ...g.field];
  const withLeave = everyone.filter((p) => (picks.get(p.id)?.size ?? 0) > 0).length;
  const booked = everyone.reduce((n, p) => n + (picks.get(p.id)?.size ?? 0), 0);
  const inSummer = everyone.reduce((n, p) => n + [...(picks.get(p.id) ?? [])].filter((i) => cycles[i]?.summer).length, 0);
  const breaks = new Set(mine.map((i) => i.text)).size;
  const tiles: { label: string; value: string; tone?: 'bad' | 'ok' }[] = [
    { label: 'People with leave booked', value: `${withLeave} of ${everyone.length}` }, { label: 'Cycles booked', value: String(booked) },
    { label: 'In summer', value: String(inSummer) }, { label: 'Rules broken', value: String(breaks), tone: breaks > 0 ? 'bad' : 'ok' }
  ];
  return (
    <div className="space-y-2">
     <div className="min-w-0 space-y-2">
      <div className="hidden grid-cols-4 gap-2 lg:grid">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
            <div className={cx('text-xl font-semibold tabular-nums', t.tone === 'bad' ? 'text-status-red' : t.tone === 'ok' ? 'text-status-green' : 'text-brand-800')}>{t.value}</div>
            <div className="text-xs text-slate-500">{t.label}</div>
          </div>
        ))}
      </div>
      <div className={cx('flex gap-1 overflow-x-auto pb-0.5', !overflow && 'hidden')} aria-label="Jump to month">
        {MONTHS.map((m, i) => (
          <button key={m} type="button" onClick={() => jump(i + 1)} className={cx('min-h-8 shrink-0 rounded-full px-3 text-xs font-medium ring-1', i + 1 >= 6 && i + 1 <= 9 ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-white text-slate-700 ring-slate-300')}>{m}</button>
        ))}
      </div>
      <Card className="p-0">
        <div ref={scroller} className="overflow-x-auto">
          <div className={cx('pb-1 [--name:156px] lg:[--name:190px]', detail ? '[--col:60px] lg:[--col:56px]' : '[--col:34px] lg:[--col:20px]')} style={gridMin}>
            <div className="sticky top-0 z-10 grid bg-white" style={grid}>
              <div data-name className="sticky left-0 z-20 flex flex-col justify-end bg-white px-2 pb-1 text-[10px] leading-[14px] text-slate-500">
                <span className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide">{crew} Shift · {shown.length} cycles</span>
                <span>Cycle starts (6 duty days)</span>
                <span className="mt-[8px]">Cycle ends (after 2 off days)</span>
              </div>
              {shown.map((c, i) => {
                const newMonth = i === 0 || shown[i - 1].start.slice(5, 7) !== c.start.slice(5, 7);
                return (
                  <div key={c.index} data-cycle={c.index} className={cx('flex flex-col items-center gap-0.5 pb-1 pt-0.5 text-center', c.summer && 'bg-amber-50')}>
                    <span className="h-3 text-[9px] font-semibold leading-3 text-slate-500">{newMonth ? MONTHS[Number(c.start.slice(5, 7)) - 1] : ''}</span>
                    <span className="text-[11px] font-semibold leading-none text-slate-800">{Number(c.start.slice(8))}</span>
                    {detail
                      ? <span aria-hidden className="flex h-4 w-[calc(100%-6px)] overflow-hidden rounded-sm"><Stripe labels /></span>
                      : <span aria-hidden className="flex h-2 w-[calc(100%-6px)] overflow-hidden rounded-sm"><Stripe /></span>}
                    <span className="text-[10px] leading-none text-slate-500">{Number(c.end.slice(8))}{detail && ` ${MONTHS[Number(c.end.slice(5, 7)) - 1]}`}</span>
                  </div>
                );
              })}
            </div>
            {sections.map((s) => (
              <div key={s.title}>
                <div className="grid bg-slate-50" style={grid}>
                  <div className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-700">{s.title}{s.sub && <span className="ml-1 font-normal text-slate-500">· {s.sub}</span>}</div>
                  {shown.map((c) => {
                    const off = s.ids.filter((id) => picks.get(id)?.has(c.index)).length;
                    const full = s.max != null && off === s.max, over = s.max != null && off > s.max;
                    return <div key={c.index} title={s.max != null && off > 0 ? `${off} of ${s.max} allowed off` : undefined} className={cx('flex items-center justify-center text-[10px] font-semibold tabular-nums', over ? 'bg-status-red text-white' : full ? 'bg-amber-100 text-amber-900' : off > 0 ? 'text-slate-700' : 'text-slate-300')}>{off > 0 ? (s.max != null ? `${off}/${s.max}` : off) : ''}</div>;
                  })}
                </div>
                {s.people.length === 0 && <div className="px-2 py-1.5 text-xs text-slate-500">Nobody on this shift.</div>}
                {s.people.map((p) => {
                  const mineCycles = picks.get(p.id)?.size ?? 0;
                  return (
                    <div key={p.id} className="grid items-center" style={grid}>
                      <button type="button" onClick={() => onPerson(p)} className="sticky left-0 z-10 min-w-0 bg-white px-2 py-0.5 text-left active:bg-slate-50" aria-label={`${p.name}: open the year`}>
                        <span className="block truncate text-xs font-medium text-slate-900">{p.name}</span>
                        <span className="block truncate text-[10px] text-slate-500">{s.acting?.has(p.id) ? `acting G13 · since ${p.gradeSince ? p.gradeSince.slice(0, 4) : '?'}` : p.grade ? `G${p.grade}` : `#${p.number}`} · <span className={cx(mineCycles > 0 && 'font-semibold text-brand-700')}>{mineCycles} {mineCycles === 1 ? 'cycle' : 'cycles'}</span></span>
                      </button>
                      {shown.map((c) => {
                        const on = picks.get(p.id)?.has(c.index) ?? false;
                        const away = (model.others.get(p.id) ?? []).find((o) => overlaps(o, c));
                        const flag = bad.has(`${p.id}|${c.index}`);
                        const why = on || away ? null : blockReason(ctx, p.id, c.index);
                        return (
                          <button key={c.index} type="button" disabled={busy || (!on && !!away)} aria-pressed={on} aria-label={`${p.name} ${rangeLabel(c)}${on ? ': booked' : why ? ': not allowed' : ''}`}
                            title={away ? `Other leave ${shortDate(away.start)} – ${shortDate(away.end)}` : why ?? rangeLabel(c)} onClick={() => onTap(p, c.index)}
                            className={cx('relative mx-px my-px flex items-center justify-center overflow-hidden rounded pr-[25%] text-white', detail ? 'h-11' : 'h-8 lg:h-9', on ? (flag ? 'bg-status-red' : 'bg-brand-700')
                              : away ? 'bg-slate-200 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(100,116,139,.35)_3px,rgba(100,116,139,.35)_4px)]'
                              : why ? 'bg-red-50 ring-1 ring-red-100 active:bg-red-100'
                              : c.summer ? 'bg-amber-50 ring-1 ring-amber-100 active:bg-amber-100' : 'ring-1 ring-slate-100 active:bg-slate-100')}>
                            {on ? <Check className="h-4 w-4" /> : why ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red-300" /> : null}
                            {detail && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 flex h-1.5"><Stripe onDark={on} /></span>}
                            <span aria-hidden className={cx('pointer-events-none absolute inset-y-0 right-0 w-1/4 border-l', on ? 'border-white/40 bg-white/30' : 'border-slate-200 bg-slate-200/60 bg-[repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(255,255,255,.7)_2px,rgba(255,255,255,.7)_3px)]')} />
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Card>
      <Key />
     </div>
     <div className="grid items-start gap-2 lg:grid-cols-2">
      <PanelCard crew={crew} g={g} />
      <IssueList issues={mine} />
     </div>
    </div>
  );
}

/** One person's whole year: the cycles by month as big targets, what is taken and why. */
function PersonSheet({ model, person, picks, ctx, busy, onTap, onClose }: { model: Model; person: PvPerson; picks: Map<string, Set<number>>; ctx: PvContext; busy: boolean; onTap: (p: PvPerson, i: number) => void; onClose: () => void }) {
  const crew = person.crew!;
  const cycles = model.cycles[crew];
  const mine = picks.get(person.id) ?? new Set<number>();
  const summer = [...mine].filter((i) => cycles[i]?.summer).length;
  const runs = runsOf(mine);
  const byMonth = MONTHS.map((m, i) => ({ m, i, list: cycles.filter((c) => Number(c.start.slice(5, 7)) === i + 1) })).filter((x) => x.list.length);
  return (
    <BottomSheet open onClose={onClose} title={person.name}>
      <div className="space-y-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-700"><CrewBadge crew={crew} size="sm" /><span>#{person.number}{person.grade ? ` · G${person.grade}` : ''}</span></p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-50 py-1.5"><div className="text-lg font-semibold tabular-nums text-brand-800">{mine.size}</div><div className="text-[11px] text-slate-500">cycles · {mine.size * 6} duty days</div></div>
          <div className="rounded-lg bg-slate-50 py-1.5"><div className="text-lg font-semibold tabular-nums text-brand-800">{runs.length}</div><div className="text-[11px] text-slate-500">{runs.length === 1 ? 'leave' : 'leaves'}</div></div>
          <div className={cx('rounded-lg py-1.5', summer > PV_RULES.summerMaxCycles ? 'bg-red-50' : 'bg-amber-50')}><div className="flex items-center justify-center gap-1 text-lg font-semibold tabular-nums text-amber-900"><Sun className="h-4 w-4" />{summer}/{PV_RULES.summerMaxCycles}</div><div className="text-[11px] text-slate-500">summer cycles</div></div>
        </div>
        {byMonth.map(({ m, i, list }) => (
          <div key={m}>
            <h3 className={cx('mb-1 text-xs font-semibold uppercase tracking-wide', i + 1 >= 6 && i + 1 <= 9 ? 'text-amber-800' : 'text-slate-500')}>{m}{i + 1 >= 6 && i + 1 <= 9 && ' · summer'}</h3>
            <div className="flex flex-wrap gap-1.5">
              {list.map((c) => {
                const on = mine.has(c.index);
                const away = (model.others.get(person.id) ?? []).find((o) => overlaps(o, c));
                const why = on || away ? null : blockReason(ctx, person.id, c.index);
                return (
                  <button key={c.index} type="button" disabled={busy || (!on && !!away)} aria-pressed={on} title={away ? 'Other leave' : why ?? undefined} onClick={() => onTap(person, c.index)}
                    className={cx('min-h-11 rounded-lg px-3 text-sm font-medium tabular-nums ring-1', on ? 'bg-brand-700 text-white ring-brand-700' : away ? 'bg-slate-100 text-slate-400 ring-slate-200 line-through' : why ? 'bg-red-50 text-red-800 ring-red-200' : c.summer ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-white text-slate-800 ring-slate-300')}>
                    {Number(c.start.slice(8))}–{Number(c.end.slice(8))}{Number(c.end.slice(5, 7)) !== Number(c.start.slice(5, 7)) ? ` ${MONTHS[Number(c.end.slice(5, 7)) - 1]}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-slate-500">Pink: booking it would break a rule; tap to see which. Grey, struck through: other leave already on those days.</p>
      </div>
    </BottomSheet>
  );
}

/** One cycle: the 6 duty days as a single block, then the 2 off days apart (no Morning / Afternoon / Night letters). */
function Stripe({ labels = false, onDark = false }: { labels?: boolean; onDark?: boolean }) {
  return (
    <>
      <span className={cx('flex h-full flex-[6] items-center justify-center text-[9px] font-semibold leading-none', onDark ? 'bg-white/50 text-slate-800' : 'bg-sky-300 text-sky-950')}>{labels ? '6 days' : ''}</span>
      <span className="w-px shrink-0 bg-white" />
      <span className="flex h-full flex-[2] items-center justify-center bg-slate-300 bg-[repeating-linear-gradient(45deg,transparent,transparent_1.5px,rgba(255,255,255,.7)_1.5px,rgba(255,255,255,.7)_2.5px)] text-[9px] font-semibold leading-none text-slate-600">{labels ? 'Off' : ''}</span>
    </>
  );
}

function Key() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-slate-500">
      <span className="flex items-center gap-1"><span className="flex h-2 w-12 overflow-hidden rounded-sm"><Stripe /></span>one cycle: 6 duty days in one block, then 2 off days</span>
      <span className="flex items-center gap-1"><span className="relative h-3 w-5 overflow-hidden rounded bg-brand-700"><span className="absolute inset-y-0 right-0 w-1/4 bg-white/40" /></span>booked (the light end = the 2 off days)</span>
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-red-50 ring-1 ring-red-200" />would break a rule</span>
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-status-red" />booked, breaks a rule</span>
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-50 ring-1 ring-amber-200" /><Sun className="h-3 w-3 text-amber-600" />summer</span>
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-slate-200" />other leave</span>
    </div>
  );
}

function IssueList({ issues }: { issues: PvIssue[] }) {
  const seen = new Set<string>(); const list = issues.filter((i) => (seen.has(i.text) ? false : seen.add(i.text)));
  if (list.length === 0) return <p className="flex items-center gap-1 px-1 text-sm text-status-green"><Check className="h-4 w-4" />No rule is broken.</p>;
  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-1 text-sm font-semibold text-status-red"><AlertTriangle className="h-4 w-4" />{list.length} {list.length === 1 ? 'rule is' : 'rules are'} broken</h2>
      <ul className="space-y-1 text-xs text-slate-700">{list.map((i) => <li key={i.text}>{i.text}</li>)}</ul>
    </Card>
  );
}

function PanelCard({ crew, g }: { crew: Crew; g: Model['groups'][Crew] }) {
  const used = new Set(g.acting.map((p) => p.id));
  const fill = Math.max(0, PV_RULES.panelSeats - g.panel.length);
  if (fill === 0 && g.short === 0) return null;
  return (
    <Card className="space-y-1">
      <h2 className="text-sm font-semibold text-slate-800">Panel seats · {crew} Shift</h2>
      <p className="text-xs text-slate-600">{g.panel.length} Panel Operator{g.panel.length === 1 ? '' : 's'} (Grade {g.panel.filter((p) => (p.grade ?? 0) >= 14).length} at 14+) · {fill} seat{fill === 1 ? '' : 's'} to fill from Grade 13 Field Operators, longest in grade first, then the least sick leave.</p>
      {g.short > 0 && <p className="text-xs font-semibold text-status-red">{g.short} seat{g.short === 1 ? '' : 's'} cannot be filled: not enough Grade 13 Field Operators on this shift.</p>}
      <ol className="divide-y divide-slate-100 text-xs">
        {g.ranked.map((p, i) => (
          <li key={p.id} className={cx('flex items-center gap-2 py-1', !used.has(p.id) && 'text-slate-400')}>
            <span className="w-4 tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{p.name} <span className="font-normal">#{p.number}</span></span>
            <span className="shrink-0 tabular-nums">in grade since {p.gradeSince ? p.gradeSince.slice(0, 7) : '—'}</span>
            <span className="w-14 shrink-0 text-right tabular-nums">sick {p.sick} d</span>
            {used.has(p.id) && <span className="rounded-full bg-brand-50 px-1.5 text-[10px] font-semibold text-brand-700">acting</span>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** All Controllers together on one year line, with the days two are off together in red. */
function ControllersTimeline({ model, picks, issues }: { model: Model; picks: Map<string, Set<number>>; issues: PvIssue[] }) {
  const year = model.year;
  const start = `${year}-01-01`, total = (Date.parse(`${year}-12-31`) - Date.parse(start)) / 864e5 + 1;
  const pos = (iso: string) => Math.max(0, Math.min(total, (Date.parse(iso) - Date.parse(start)) / 864e5));
  const ctl = [...model.people.values()].filter((p) => p.role === 'controller' || p.role === 'vr_controller' || p.role === 'morning_controller').sort((a, b) => (a.crew ?? 'Z').localeCompare(b.crew ?? 'Z') || a.name.localeCompare(b.name));
  // each Controller's leave: picked cycles (current picks) and any other leave on the plan
  const spans = new Map<string, { start: string; end: string; other: boolean }[]>();
  for (const p of ctl) {
    const list: { start: string; end: string; other: boolean }[] = [];
    if (p.crew) for (const [a, b] of runsOf(picks.get(p.id) ?? [])) list.push({ start: model.cycles[p.crew][a].start, end: model.cycles[p.crew][b].end, other: false });
    for (const o of model.others.get(p.id) ?? []) list.push({ start: o.start, end: o.end, other: true });
    spans.set(p.id, list);
  }
  const clash = new Map<string, { start: string; end: string }[]>();
  for (const a of ctl) for (const b of ctl) {
    if (a.id >= b.id) continue;
    for (const x of spans.get(a.id) ?? []) for (const y of spans.get(b.id) ?? []) if (overlaps(x, y)) {
      const seg = { start: x.start > y.start ? x.start : y.start, end: x.end < y.end ? x.end : y.end };
      clash.set(a.id, [...(clash.get(a.id) ?? []), seg]); clash.set(b.id, [...(clash.get(b.id) ?? []), seg]);
    }
  }
  const pct = (iso: string) => `${(pos(iso) / total) * 100}%`;
  const width = (a: string, b: string) => `${((pos(addDaysIso(b, 1)) - pos(a)) / total) * 100}%`;
  return (
    <div className="space-y-2">
      <Card className="p-2">
        <div className="relative ml-24 h-4">
          {MONTHS.map((m, i) => <span key={m} className="absolute text-[10px] font-semibold text-slate-500" style={{ left: pct(`${year}-${String(i + 1).padStart(2, '0')}-01`) }}>{m}</span>)}
        </div>
        {ctl.map((p) => (
          <div key={p.id} className="flex items-center gap-1 py-0.5">
            <div className="flex w-24 shrink-0 items-center gap-1">{p.crew ? <CrewBadge crew={p.crew} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-semibold text-slate-600">{p.role === 'vr_controller' ? 'VR' : 'DS'}</span>}<span className="truncate text-[11px] font-medium text-slate-800">{shortName(p.name)}</span></div>
            <div className="relative h-5 flex-1 rounded bg-slate-50 ring-1 ring-slate-100">
              {MONTHS.map((m, i) => i > 0 && <span key={m} className="absolute top-0 h-full w-px bg-slate-200" style={{ left: pct(`${year}-${String(i + 1).padStart(2, '0')}-01`) }} />)}
              {(spans.get(p.id) ?? []).map((s) => <span key={`${s.start}${s.end}`} className={cx('absolute top-0.5 h-4 rounded-sm', s.other ? 'bg-slate-400' : 'bg-brand-700')} style={{ left: pct(s.start), width: width(s.start, s.end) }} title={`${shortDate(s.start)} – ${shortDate(s.end)}`} />)}
              {(clash.get(p.id) ?? []).map((s, i) => <span key={i} className="absolute top-0 h-5 rounded-sm bg-status-red" style={{ left: pct(s.start), width: width(s.start, s.end) }} />)}
            </div>
          </div>
        ))}
      </Card>
      <p className="px-1 text-[11px] text-slate-500">Cycles are booked on each shift&apos;s tab. Grey is other leave on the plan (VR Controllers and Morning Controllers enter theirs in Leave plan). Red: two Controllers off on the same days.</p>
      <IssueList issues={issues.filter((i) => i.kind === 'controller_overlap' || i.kind === 'leaves')} />
    </div>
  );
}
