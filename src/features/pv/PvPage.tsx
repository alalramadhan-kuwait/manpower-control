// PV planner: the annual leave plan entered by cycle. One calendar per shift (columns are that crew's 8-day cycles, M1 to Off2),
// a tap books or frees a whole cycle, back-to-back cycles make one longer leave. The Section Head's rules are checked as you tap.
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Sun } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CREWS, addDaysIso, dutyFor, stateOf, type Crew } from '@/core/roster';
import { PV_RULES, checkPv, cyclesOf, panelFill, runsOf, type PvCycle, type PvIssue, type PvPerson, type PvRole, type PvShift } from '@/core/pv';
import { applyPvBlocks, fetchPv, type PvData } from '@/data/pv';
import { Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { shortDate } from '@/ui/leave';
import { SHIFT_STYLE } from '@/features/calendar/parts';

const ROLES = new Set<string>(['controller', 'vr_controller', 'morning_controller', 'panel_operator', 'field_operator']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COL = 30;
type Tab = Crew | 'ctl';

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

export default function PvPage() {
  const [params, setParams] = useSearchParams();
  const year = Number(params.get('year')) || new Date().getFullYear() + 1;
  const tab: Tab = (['A', 'B', 'C', 'D', 'ctl'] as const).find((t) => t === params.get('shift')) ?? 'A';
  const [data, setData] = useState<PvData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [local, setLocal] = useState<Map<string, Set<number>>>(new Map());
  const [busy, setBusy] = useState(0);
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(params); if (v === null) n.delete(k); else n.set(k, v); setParams(n, { replace: true }); };
  const load = useCallback(() => fetchPv(year).then((d) => { setData(d); setLocal(new Map()); }).catch(setError), [year]);
  useEffect(() => { setData(null); load(); }, [load]);
  const model = useMemo(() => (data ? buildModel(data) : null), [data]);
  const picks = useMemo(() => { const m = new Map(model?.picks); for (const [id, s] of local) m.set(id, s); return m; }, [model, local]);
  const names = useMemo(() => new Map([...(model?.people ?? [])].map(([id, p]) => [id, p.name])), [model]);
  const issues = useMemo(() => {
    if (!model) return [] as PvIssue[];
    const shifts: PvShift[] = CREWS.map((c) => ({ crew: c, cycles: model.cycles[c], controllers: model.groups[c].controllers.map((p) => p.id), panel: [...model.groups[c].panel, ...model.groups[c].acting].map((p) => p.id), field: model.groups[c].field.map((p) => p.id) }));
    const controllerLeave = model.ctlLeave.map((l) => ({ employeeId: l.employeeId, start: l.start, end: l.end }));   // leave not on whole cycles, VR and Morning Controllers included
    return checkPv({ shifts, picks, controllerLeave, shutdowns: model.shutdowns, names });
  }, [model, picks, names]);

  async function toggle(p: PvPerson, index: number) {
    if (!model || !p.crew) return;
    const cycles = model.cycles[p.crew];
    const next = new Set(picks.get(p.id) ?? []); if (next.has(index)) next.delete(index); else next.add(index);
    setLocal((m) => new Map(m).set(p.id, next)); setSaveError(null); setBusy((n) => n + 1);
    try {
      await applyPvBlocks({ employeeId: p.id, year, existing: model.existing.get(p.id) ?? [], blocks: runsOf(next).map(([a, b]) => ({ start: cycles[a].start, end: cycles[b].end })) });
    } catch (e) { setSaveError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy((n) => n - 1); }
  }
  useEffect(() => { if (busy === 0 && local.size > 0) load(); }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader title="PV plan" subtitle="Annual leave by whole cycle" info={<div className="space-y-2 text-sm text-slate-700">
        <p>A cycle is 8 days: 2 Morning, 2 Afternoon, 2 Night, 2 Off (6 duty days). A leave starts on the crew&apos;s first Morning day and covers whole cycles; cycles side by side make one longer leave. Tap a cycle to book it, tap again to free it.</p>
        <p><b>Rules:</b> two Controllers are never off together (all shifts) · Panel: one off at a time per shift · Field: two at most per shift · summer (June to September) is peak time: one leave of two cycles at the longest · a shutdown team member takes no leave in the shutdown.</p>
        <p><b>Panel seats:</b> each shift keeps {PV_RULES.panelSeats}. When there are fewer Panel Operators than that, Grade 13 Field Operators fill the seats for the plan: longest in grade first, then the least sick leave.</p>
        <p>Breaks are shown in red and listed under the calendar; nothing is blocked.</p>
      </div>} />
      <div className="mb-2 flex items-center justify-between rounded-xl bg-white px-2 py-1 ring-1 ring-slate-200">
        <button type="button" aria-label="Previous year" onClick={() => set('year', String(year - 1))} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 active:bg-slate-100"><ChevronLeft className="h-5 w-5" /></button>
        <span className="text-base font-semibold text-brand-800">{year}</span>
        <button type="button" aria-label="Next year" onClick={() => set('year', String(year + 1))} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 active:bg-slate-100"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <div role="tablist" className="mb-2 grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {([...CREWS, 'ctl'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => set('shift', t === 'A' ? null : t)} className={cx('flex min-h-9 items-center justify-center gap-1 rounded-lg font-medium', tab === t ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>
            {t === 'ctl' ? 'Controllers' : <><CrewBadge crew={t} size="sm" />{t}</>}
          </button>
        ))}
      </div>
      {error ? <ErrorBox error={error} /> : !model ? <Spinner /> : tab === 'ctl' ? <ControllersTimeline model={model} picks={picks} issues={issues} /> : (
        <ShiftGrid model={model} crew={tab} picks={picks} issues={issues} busy={busy > 0} onToggle={toggle} />
      )}
      {saveError && <p role="alert" className="mt-2 flex items-start gap-1 text-sm text-status-red"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{saveError}</p>}
    </div>
  );
}

function ShiftGrid({ model, crew, picks, issues, busy, onToggle }: { model: Model; crew: Crew; picks: Map<string, Set<number>>; issues: PvIssue[]; busy: boolean; onToggle: (p: PvPerson, i: number) => void }) {
  const cycles = model.cycles[crew], g = model.groups[crew];
  const mine = issues.filter((i) => i.crew === crew || i.crew === null);
  const bad = new Set<string>();
  for (const i of mine) for (const id of i.employeeIds) {
    if (i.kind === 'summer' || i.kind === 'leaves') { for (const c of picks.get(id) ?? []) if (i.kind === 'leaves' || cycles[c]?.summer) bad.add(`${id}|${c}`); }
    else if (i.cycle != null) bad.add(`${id}|${i.cycle}`);
  }
  const grid = { gridTemplateColumns: `140px repeat(${cycles.length}, ${COL}px)` };
  const panelIds = [...g.panel, ...g.acting].map((p) => p.id);
  const sections: { title: string; sub?: string; people: PvPerson[]; ids: string[]; max?: number; acting?: Set<string> }[] = [
    { title: 'Controller', people: g.controllers, ids: g.controllers.map((p) => p.id) },
    { title: `Panel · ${PV_RULES.panelSeats} seats`, sub: 'one off at a time', people: [...g.panel, ...g.acting], ids: panelIds, max: PV_RULES.panelMaxOff, acting: new Set(g.acting.map((p) => p.id)) },
    { title: 'Field', sub: 'two off at most', people: g.field, ids: g.field.map((p) => p.id), max: PV_RULES.fieldMaxOff }
  ];
  return (
    <div className="space-y-2">
      <PanelCard crew={crew} g={g} />
      <Card className="p-0">
        <div className="overflow-x-auto">
          <div className="min-w-max pb-1">
            <div className="grid sticky top-0 z-10 bg-white" style={grid}>
              <div className="sticky left-0 z-20 flex items-end bg-white px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{crew} Shift · {cycles.length} cycles</div>
              {cycles.map((c, i) => {
                const newMonth = i === 0 || cycles[i - 1].start.slice(5, 7) !== c.start.slice(5, 7);
                return (
                  <div key={c.index} className={cx('flex flex-col items-center gap-0.5 pb-1 pt-0.5 text-center', c.summer && 'bg-amber-50')}>
                    <span className="h-3 text-[9px] font-semibold leading-3 text-slate-500">{newMonth ? MONTHS[Number(c.start.slice(5, 7)) - 1] : ''}</span>
                    <span className="text-[11px] font-semibold leading-none text-slate-800">{Number(c.start.slice(8))}</span>
                    <span aria-hidden className="flex h-1.5 w-[26px] overflow-hidden rounded-sm"><Stripe crew={crew} start={c.start} /></span>
                  </div>
                );
              })}
            </div>
            {sections.map((s) => (
              <div key={s.title}>
                <div className="grid bg-slate-50" style={grid}>
                  <div className="sticky left-0 z-10 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">{s.title}{s.sub && <span className="ml-1 font-normal text-slate-500">· {s.sub}</span>}</div>
                  {cycles.map((c) => {
                    const off = s.ids.filter((id) => picks.get(id)?.has(c.index)).length;
                    return <div key={c.index} className={cx('flex items-center justify-center text-[10px] font-semibold tabular-nums', s.max != null && off > s.max ? 'bg-status-red text-white' : off > 0 ? 'text-slate-700' : 'text-slate-300')}>{off > 0 ? off : ''}</div>;
                  })}
                </div>
                {s.people.length === 0 && <div className="px-2 py-1.5 text-xs text-slate-500">Nobody on this shift.</div>}
                {s.people.map((p) => (
                  <div key={p.id} className="grid items-center" style={grid}>
                    <div className="sticky left-0 z-10 min-w-0 bg-white px-2 py-0.5">
                      <div className="truncate text-xs font-medium text-slate-900">{p.name}</div>
                      <div className="truncate text-[10px] text-slate-500">#{p.number}{s.acting?.has(p.id) ? ` · acting G13 · since ${p.gradeSince ? p.gradeSince.slice(0, 4) : '?'}` : p.grade ? ` · G${p.grade}` : ''}</div>
                    </div>
                    {cycles.map((c) => {
                      const on = picks.get(p.id)?.has(c.index) ?? false;
                      const away = (model.others.get(p.id) ?? []).find((o) => overlaps(o, c));
                      const flag = bad.has(`${p.id}|${c.index}`);
                      return (
                        <button key={c.index} type="button" disabled={busy || (!on && !!away)} aria-pressed={on} aria-label={`${p.name} ${shortDate(c.start)}${on ? ': booked' : ''}`} title={away ? `Other leave ${shortDate(away.start)} – ${shortDate(away.end)}` : `${shortDate(c.start)} – ${shortDate(c.end)}`} onClick={() => onToggle(p, c.index)}
                          className={cx('mx-px my-px flex h-7 items-center justify-center rounded text-white', on ? (flag ? 'bg-status-red' : 'bg-brand-700') : away ? 'bg-slate-200 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(100,116,139,.35)_3px,rgba(100,116,139,.35)_4px)]' : cx('ring-1', flag ? 'ring-status-red' : c.summer ? 'bg-amber-50 ring-amber-100' : 'ring-slate-100 active:bg-slate-100'))}>
                          {on && <Check className="h-3.5 w-3.5" />}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Card>
      <Key />
      <IssueList issues={mine} />
    </div>
  );
}

/** The crew's 8 days as a colour strip: Morning, Afternoon, Night, Off. */
function Stripe({ crew, start }: { crew: Crew; start: string }) {
  const order: ('M' | 'A' | 'N' | 'Off')[] = [];
  for (let i = 0; i < 8; i++) { const d = addDaysIso(start, i); order.push(shiftOf(crew, d)); }
  return <>{order.map((s, i) => <span key={i} className={cx('h-full flex-1', s === 'Off' ? 'bg-slate-200' : SHIFT_STYLE[s].cell)} />)}</>;
}
const shiftOf = (crew: Crew, d: string) => stateOf(dutyFor(d, crew));

function Key() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px] text-slate-500">
      <span className="flex items-center gap-1"><span className="flex h-2 w-12 overflow-hidden rounded-sm"><span className={cx('flex-1', SHIFT_STYLE.M.cell)} /><span className={cx('flex-1', SHIFT_STYLE.M.cell)} /><span className={cx('flex-1', SHIFT_STYLE.A.cell)} /><span className={cx('flex-1', SHIFT_STYLE.A.cell)} /><span className={cx('flex-1', SHIFT_STYLE.N.cell)} /><span className={cx('flex-1', SHIFT_STYLE.N.cell)} /><span className="flex-1 bg-slate-200" /><span className="flex-1 bg-slate-200" /></span>cycle: 2 M · 2 A · 2 N · 2 Off</span>
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-brand-700" />booked</span>
      <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-status-red" />breaks a rule</span>
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
