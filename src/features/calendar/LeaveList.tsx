// Calendar › List: the month's leave, one row per leave (name, employee no., position, crew, type, dates, days), by
// start date; filters by position and crew and a name / number search (owner, 26 Oct 2026). A tap opens the leave as
// in the Leave plan. Reads the same data as the Leave plan.
// Stage 1 (owner, 26 Oct 2026): back-to-back records are one leave; a rescheduled leave says where it moved from; the
// crew is where the person actually is (a VR Controller in the crew he is placed in, a cover, day duty); each leave
// shows its time, the Section Head's approval and the Oracle application (recorded only) as separate facts; leave
// requests waiting for the Section Head are listed dashed, and a pending cancellation is marked on its leave.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MONTH_NAMES, monthEnd, monthStart, shiftMonth } from '@/core/calendar';
import { isOpenEnd } from '@/core/leave';
import { APPROVAL_LABEL, ORACLE_SHORT, TIME_LABEL, approvalState, crewPlace, joinTouching, oracleState, shutdownCancellable, timeState, type ApprovalState, type OracleState } from '@/core/leave/status';
import { fetchLeaveContext, fetchLeavePlan, type LeaveContext, type LeavePlanData } from '@/data/leave';
import type { EmployeeDirectoryRow, LeaveRecord } from '@/data/types';
import { ErrorBox, Spinner, cx } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';
import { leaveTone } from '@/ui/leaveTypes';
import { LeaveDetail, type LeaveItem } from './LeaveDetail';
import { FilterBar, matchLeave, useCalFilters, useScrollMemory } from './filters';
import { ViewToggle } from './parts';

const POS_SHORT: Record<string, string> = { controller: 'Controller', vr_controller: 'VR', morning_controller: 'Morning', panel_operator: 'Panel', field_operator: 'Field' };
const counts = (l: LeaveRecord) => l.in_current_plan && (l.status === 'approved' || l.status === 'planned');
const days = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1;
const range = (s: string, e: string) => (s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`);
const RESCHEDULED = 'annual_leave_rescheduled';

type Row = LeaveItem;
// one label for a joined leave: the same state on every record, else the one that needs attention
const one = <T extends string>(xs: T[], attention: T[]): T => (xs.every((x) => x === xs[0]) ? xs[0] : attention.find((a) => xs.includes(a)) ?? xs[0]);

export function LeaveListView({ year, month, onMonth, onView }: { year: number; month: number; onMonth: (y: number, m: number) => void; onView: (v: 'month' | 'week') => void }) {
  const today = localToday();
  const from = monthStart(year, month), to = monthEnd(year, month);
  const [data, setData] = useState<(LeavePlanData & { year: number }) | null>(null);
  const [ctx, setCtx] = useState<(LeaveContext & { from: string }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [f, setF] = useCalFilters();
  const [params, setParams] = useSearchParams();
  const [reload, setReload] = useState(0);
  useEffect(() => { let live = true; setError(null); fetchLeavePlan(year).then((d) => live && setData({ ...d, year })).catch((e) => live && setError(e)); return () => { live = false; }; }, [year]);
  useEffect(() => { let live = true; fetchLeaveContext(from, to).then((c) => live && setCtx({ ...c, from })).catch((e) => live && setError(e)); return () => { live = false; }; }, [from, to, reload]);
  const rows = useMemo(() => {
    if (!data || data.year !== year || !ctx || ctx.from !== from) return null;
    const people = new Map(data.people.map((p) => [p.id, p]));
    const byId = new Map(data.leaves.map((l) => [l.id, l]));
    const typeOf = (code: string | null) => data.types.find((t) => t.code === code);
    const movesOf = (id: string) => ctx.moves.filter((m) => m.employeeId === id);
    const coverOn = (id: string, d: string) => data.covers.find((c) => c.employee_id === id && c.start_date <= d && d <= c.end_date)?.crew_code ?? null;
    const cancelAsked = new Set(ctx.pending.filter((r) => r.action === 'cancel' && r.targetRecordId).map((r) => r.targetRecordId!));
    const placeOf = (p: EmployeeDirectoryRow, d: string) => crewPlace({ role: p.position_code, crew: p.crew_code }, d, movesOf(p.id), coverOn(p.id, d));
    const out: Row[] = joinTouching(data.leaves.filter(counts)).filter((j) => j.start <= to && j.end >= from && people.has(j.employeeId)).map((j) => {
      const p = people.get(j.employeeId)!;
      const codes = [...new Set(j.records.map((r) => typeOf(r.absence_type_code)?.short_code ?? 'Leave'))];
      const moved = j.records.map((r) => (r.rescheduled_from ? byId.get(r.rescheduled_from) : undefined)).find(Boolean);
      const rescheduled = j.records.some((r) => r.absence_type_code === RESCHEDULED || r.rescheduled_from);
      const place = placeOf(p, j.start < from ? from : j.start);
      const oracles = j.records.map((r) => oracleState(r, ctx.oracleLog));
      return { key: j.records[0].id, p, start: j.start, end: j.end, codes, typeCode: j.records[0].absence_type_code, place: place.text, home: place.home, actual: place.actual, records: j.records,
        movedFrom: moved ? range(moved.start_date, moved.end_date) : rescheduled ? '' : null,
        approval: one<ApprovalState>(j.records.map((r) => approvalState(r, today)), ['declined', 'lapsed', 'awaiting']),
        oracle: oracles.every((x) => x === oracles[0]) ? oracles[0] : 'mixed',
        request: null, cancelAsked: j.records.some((r) => cancelAsked.has(r.id)),
        sd: j.records.map((r) => shutdownCancellable(r, approvalState(r, today), ctx.shutdowns)).find(Boolean) ?? null };
    });
    // requests still waiting for the Section Head: a new leave or an extension, not yet in the plan
    for (const r of ctx.pending) {
      const p = people.get(r.employeeId); const end = r.end ?? r.start;
      if (!p || r.action === 'cancel' || r.action === 'return' || r.start > to || (!isOpenEnd(end) && end < from)) continue;
      const place = placeOf(p, r.start < from ? from : r.start);
      out.push({ key: `rq-${r.id}`, p, start: r.start, end, codes: [typeOf(r.typeCode)?.short_code ?? 'Leave'], typeCode: r.typeCode, place: place.text, home: place.home, actual: place.actual,
        records: [], movedFrom: null, approval: null, oracle: null, request: r, cancelAsked: false, sd: null });
    }
    return out.sort((a, b) => a.start.localeCompare(b.start) || a.p.display_name.localeCompare(b.p.display_name));
  }, [data, ctx, year, from, to, today]);
  const shown = useMemo(() => rows?.filter((r) => matchLeave(f, { pos: r.p.position_code, typeCode: r.typeCode, approval: r.request ? 'requested' : r.approval!, home: r.home, actual: r.actual,
    names: [r.p.display_name, r.p.official_name, r.p.employee_number, r.p.arabic_name] })) ?? null, [rows, f]);
  // the open leave is in the address (…&leave=<record id>), so Back from a page it opens shows it again
  const want = params.get('leave');
  const sel = want && rows ? rows.find((r) => r.key === want || r.records.some((x) => x.id === want)) ?? null : null;
  const open = (r: Row | null) => setParams((prev) => { const n = new URLSearchParams(prev); if (r) n.set('leave', r.key); else n.delete('leave'); return n; }, { replace: true });
  useScrollMemory(!!shown);
  const [py, pm] = shiftMonth(year, month, -1); const [ny, nm] = shiftMonth(year, month, 1);
  const isThisMonth = today.slice(0, 7) === from.slice(0, 7);
  const requested = shown?.filter((r) => r.request).length ?? 0;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button aria-label="Previous month" onClick={() => onMonth(py, pm)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="text-lg font-semibold leading-tight text-brand-800">{MONTH_NAMES[month - 1]} {year}</h1>
          {!isThisMonth && <button onClick={() => onMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)))} className="text-[11px] font-medium text-brand-700">Back to this month</button>}
        </div>
        <button aria-label="Next month" onClick={() => onMonth(ny, nm)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-300 active:bg-slate-50"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <ViewToggle view="list" onChange={(v) => v !== 'list' && onView(v)} />
      <FilterBar f={f} set={setF} />
      {error ? <ErrorBox error={error} /> : !shown ? <Spinner /> : <>
        <p className="mb-1.5 px-1 text-xs text-slate-500">{shown.length - requested} leave{shown.length - requested === 1 ? '' : 's'}{requested ? <> · <b className="text-brand-700">{requested} requested</b></> : null} in {MONTH_NAMES[month - 1]} · by start date</p>
        {shown.length ? <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          {shown.map((r) => <li key={r.key}><LeaveRow r={r} today={today} before={r.start < from} onOpen={() => open(r)} /></li>)}
        </ul> : <p className="py-6 text-center text-sm text-slate-500">No leave in {MONTH_NAMES[month - 1]} for this selection.</p>}
      </>}
      {sel && data && <LeaveDetail item={sel} today={today} onClose={() => open(null)} onChanged={() => setReload((n) => n + 1)}
        around={joinTouching(data.leaves.filter((l) => counts(l) && l.employee_id === sel.p.id)).map((j) => ({ start: j.start, end: j.end, codes: [...new Set(j.records.map((r) => data.types.find((t) => t.code === r.absence_type_code)?.short_code ?? 'Leave'))] }))} />}
    </div>
  );
}

const APPROVAL_TONE: Partial<Record<ApprovalState, string>> = { awaiting: 'text-amber-700', declined: 'text-status-red', lapsed: 'text-status-red' };
const ORACLE_TONE: Partial<Record<OracleState | 'mixed', string>> = { submitted: 'text-brand-700', rejected: 'text-status-red' };

function LeaveRow({ r, today, before, onOpen }: { r: Row; today: string; before: boolean; onOpen: () => void }) {
  const open = isOpenEnd(r.end);
  // line 3: the separate facts, short; colour only where something needs attention
  const facts: [string, string?][] = r.request
    ? [[`${r.request.action === 'extend' ? 'Extension' : 'Request'} waiting for the Section Head`, 'text-brand-700']]
    : [[TIME_LABEL[timeState({ start_date: r.start, end_date: r.end, return_confirmed_at: r.records.at(-1)?.return_confirmed_at ?? null }, today)]],
      [APPROVAL_LABEL[r.approval!], APPROVAL_TONE[r.approval!]],
      [r.oracle === 'mixed' ? 'Oracle differs by part' : ORACLE_SHORT[r.oracle!], ORACLE_TONE[r.oracle!]],
      ...(r.movedFrom !== null ? [[r.movedFrom ? `↻ moved from ${r.movedFrom}` : '↻ rescheduled'] as [string]] : []),
      ...(r.records.length > 1 ? [[`${r.records.length} records`] as [string]] : []),
      ...(r.cancelAsked ? [['Cancellation requested', 'text-status-red'] as [string, string]] : []),
      ...(r.sd ? [['Shutdown — Cancellation possible', 'font-semibold text-amber-800'] as [string, string]] : [])];
  return (
    <button type="button" onClick={onOpen} className={cx('block w-full px-3 py-1.5 text-left active:bg-slate-50', r.request && 'bg-brand-50/50')}>
      <span className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate text-[13px] text-slate-900">{r.p.display_name}</b>
        {r.codes.map((c) => <span key={c} className={cx('shrink-0 rounded px-1.5 py-px text-[10px] font-bold', r.request ? 'border border-dashed border-brand-600 bg-white text-brand-700' : leaveTone(r.typeCode).chip)}>{c}{r.movedFrom !== null ? ' ↻' : ''}</span>)}
        {r.request && <span className="shrink-0 text-[10px] font-bold text-brand-700">Requested</span>}</span>
      <span className="flex items-center gap-2 text-[11px] text-slate-500"><span className="min-w-0 flex-1 truncate">#{r.p.employee_number ?? '—'} · {POS_SHORT[r.p.position_code ?? ''] ?? r.p.position_label ?? '—'} · {r.place}</span>
        <span className={cx('shrink-0 tabular-nums', before ? 'text-slate-500' : 'font-semibold text-slate-700')}>{open ? `${shortDate(r.start)} – return open` : `${range(r.start, r.end)} · ${days(r.start, r.end)} d`}</span></span>
      <span className="flex flex-wrap gap-x-1 text-[11px] leading-tight text-slate-500">{facts.map(([t, c], i) => <span key={t} className={c}>{i ? '· ' : ''}{t}</span>)}</span>
    </button>
  );
}
