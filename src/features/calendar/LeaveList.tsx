// Calendar › List: the month's leave, one row per leave (name, employee no., position, crew, type, dates, days), by
// start date, with the shared filters (owner, 26 Oct 2026). A tap opens the leave sheet. Reads the same data as the
// Leave plan.
// Back-to-back records are one leave; the crew is where the person actually is (a VR Controller in the crew he is
// placed in, a cover, day duty); leave requests waiting for the Section Head are listed with a dashed bar.
// Rows (owner, 26 Oct 2026): one state per leave — cancelled / not approved, rescheduled, awaiting approval, on leave,
// approved upcoming, taken — as a subdued fill, a thin left bar and its word. "Approved" is the Section Head's approval
// in the app. Cancelled and replaced versions show only under Status › Changed.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MONTH_NAMES, monthEnd, monthStart, shiftMonth } from '@/core/calendar';
import { isOpenEnd } from '@/core/leave';
import { approvalState, crewPlace, joinTouching, planState, rowLabel, rowState, shutdownCancellable, timeState, type ApprovalState } from '@/core/leave/status';
import { fetchLeaveContext, fetchLeavePlan, type LeaveContext, type LeavePlanData } from '@/data/leave';
import type { EmployeeDirectoryRow, LeaveRecord } from '@/data/types';
import { ErrorBox, Spinner, cx } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';
import { leaveTone } from '@/ui/leaveTypes';
import { LeaveDetail, type LeaveItem } from './LeaveDetail';
import { FilterBar, matchLeave, useCalFilters, useScrollMemory } from './filters';
import { ViewToggle } from './parts';
import { REQUEST_BAR, ROW_STYLE } from './rowStyle';

const POS_SHORT: Record<string, string> = { controller: 'Ctl', vr_controller: 'VR', morning_controller: 'Morning', panel_operator: 'Panel', field_operator: 'Field' };
const counts = (l: LeaveRecord) => l.in_current_plan && (l.status === 'approved' || l.status === 'planned');
const days = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1;
const range = (s: string, e: string) => (s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`);
const RESCHEDULED = 'annual_leave_rescheduled';

type Row = LeaveItem;
// one approval for a joined leave: the same on every record, else the one that needs attention
const one = <T extends string>(xs: T[], attention: T[]): T => (xs.every((x) => x === xs[0]) ? xs[0] : attention.find((a) => xs.includes(a)) ?? xs[0]);

export function LeaveListView({ year, month, isHead, onMonth, onView }: { year: number; month: number; isHead: boolean; onMonth: (y: number, m: number) => void; onView: (v: 'month' | 'week') => void }) {
  const today = localToday();
  const from = monthStart(year, month), to = monthEnd(year, month);
  const [data, setData] = useState<(LeavePlanData & { year: number }) | null>(null);
  const [ctx, setCtx] = useState<(LeaveContext & { from: string }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [f, setF] = useCalFilters();
  const [params, setParams] = useSearchParams();
  const [reload, setReload] = useState(0);
  useEffect(() => { let live = true; setError(null); fetchLeavePlan(year).then((d) => live && setData({ ...d, year })).catch((e) => live && setError(e)); return () => { live = false; }; }, [year, reload]);
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
    const item = (recs: LeaveRecord[], start: string, end: string, p: EmployeeDirectoryRow): Row => {
      const plan = planState(recs[0]);
      const codes = [...new Set(recs.map((r) => typeOf(r.absence_type_code)?.short_code ?? 'Leave'))];
      const moved = recs.map((r) => (r.rescheduled_from ? byId.get(r.rescheduled_from) : undefined)).find(Boolean);
      const movedTo = plan === 'rescheduled' && recs[0].superseded_by ? byId.get(recs[0].superseded_by) : undefined;
      const place = placeOf(p, start < from ? from : start);
      const approval = one<ApprovalState>(recs.map((r) => approvalState(r, today)), ['declined', 'lapsed', 'awaiting']);
      const time = timeState({ start_date: start, end_date: end, return_confirmed_at: recs.at(-1)?.return_confirmed_at ?? null }, today);
      const state = rowState({ plan, approval, requested: false, time });
      return { key: recs[0].id, p, start, end, codes, typeCode: recs[0].absence_type_code, place: place.text, home: place.home, actual: place.actual, records: recs,
        movedFrom: moved ? range(moved.start_date, moved.end_date) : plan === 'current' && recs.some((r) => r.absence_type_code === RESCHEDULED || r.rescheduled_from) ? '' : null,
        movedTo: movedTo ? range(movedTo.start_date, movedTo.end_date) : null,
        approval, plan, time, state, label: rowLabel(state, { approval, requested: false, time, start, end }, today, shortDate),
        cancellable: plan === 'current' && typeOf(recs[0].absence_type_code)?.entry_mode === 'fixed',
        request: null, cancelAsked: recs.some((r) => cancelAsked.has(r.id)),
        sd: plan === 'current' ? recs.map((r) => shutdownCancellable(r, approvalState(r, today), ctx.shutdowns)).find(Boolean) ?? null : null };
    };
    const out: Row[] = joinTouching(data.leaves.filter(counts)).filter((j) => j.start <= to && j.end >= from && people.has(j.employeeId))
      .map((j) => item(j.records, j.start, j.end, people.get(j.employeeId)!));
    // cancelled and replaced versions, one row each (shown only under Status › Changed)
    for (const l of data.leaves) if (!l.in_current_plan && (l.status === 'cancelled' || l.status === 'rescheduled') && l.start_date <= to && l.end_date >= from && people.has(l.employee_id))
      out.push(item([l], l.start_date, l.end_date, people.get(l.employee_id)!));
    // requests still waiting for the Section Head: a new leave or an extension, not yet in the plan
    for (const r of ctx.pending) {
      const p = people.get(r.employeeId); const end = r.end ?? r.start;
      if (!p || r.action === 'cancel' || r.action === 'return' || r.start > to || (!isOpenEnd(end) && end < from)) continue;
      const place = placeOf(p, r.start < from ? from : r.start);
      out.push({ key: `rq-${r.id}`, p, start: r.start, end, codes: [typeOf(r.typeCode)?.short_code ?? 'Leave'], typeCode: r.typeCode, place: place.text, home: place.home, actual: place.actual,
        records: [], movedFrom: null, movedTo: null, approval: null, plan: 'current', time: null, state: 'pending', label: r.action === 'extend' ? 'Extension requested' : 'Requested',
        cancellable: false, request: r, cancelAsked: false, sd: null });
    }
    return out.sort((a, b) => a.start.localeCompare(b.start) || a.p.display_name.localeCompare(b.p.display_name));
  }, [data, ctx, year, from, to, today]);
  const shown = useMemo(() => rows?.filter((r) => matchLeave(f, { pos: r.p.position_code, typeCode: r.typeCode, approval: r.request ? 'requested' : r.approval!, home: r.home, actual: r.actual,
    names: [r.p.display_name, r.p.official_name, r.p.employee_number, r.p.arabic_name], changed: r.plan !== 'current' })) ?? null, [rows, f]);
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
        <p className="mb-1.5 px-1 text-xs text-slate-500">{shown.length - requested} {f.status === 'changed' ? 'changed version' : 'leave'}{shown.length - requested === 1 ? '' : 's'}{requested ? <> · <b className="text-amber-800">{requested} requested</b></> : null} in {MONTH_NAMES[month - 1]} · by start date</p>
        {shown.length ? <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          {shown.map((r) => <li key={r.key}><LeaveRow r={r} before={r.start < from} onOpen={() => open(r)} /></li>)}
        </ul> : <p className="py-6 text-center text-sm text-slate-500">No leave in {MONTH_NAMES[month - 1]} for this selection.</p>}
      </>}
      {sel && data && <LeaveDetail item={sel} today={today} isHead={isHead} onClose={() => open(null)} onChanged={() => setReload((n) => n + 1)}
        around={joinTouching(data.leaves.filter((l) => counts(l) && l.employee_id === sel.p.id)).map((j) => ({ start: j.start, end: j.end, codes: [...new Set(j.records.map((r) => data.types.find((t) => t.code === r.absence_type_code)?.short_code ?? 'Leave'))] }))} />}
    </div>
  );
}

function LeaveRow({ r, before, onOpen }: { r: Row; before: boolean; onOpen: () => void }) {
  const st = ROW_STYLE[r.state];
  // always two lines: the states that need someone are chips on line 1; where it moved from, joined records and the
  // fix note are in the sheet
  const chips: [string, string, string][] = [
    ...(r.sd ? [['SD', 'bg-amber-100 text-amber-800', 'Shutdown: cancellation possible']] as [string, string, string][] : []),
    ...(r.cancelAsked ? [['Cancel?', 'bg-red-100 text-red-800', 'Cancellation requested']] as [string, string, string][] : []),
    ...(r.records.some((x) => x.fix_sent_at) ? [['Fix', 'bg-amber-100 text-amber-800', 'Sent back to fix']] as [string, string, string][] : [])];
  return (
    <button type="button" onClick={onOpen} className={cx('block w-full border-l-[3px] px-2.5 py-1.5 text-left active:brightness-95', st.row, r.request && REQUEST_BAR)}>
      <span className="flex items-center gap-2">
        <b className={cx('min-w-0 truncate text-[13px] text-slate-900', r.state === 'cancelled' && 'line-through decoration-red-300', r.state === 'rescheduled' && 'text-slate-600')}>{r.p.display_name}</b>
        {chips.map(([t, c, title]) => <span key={t} title={title} aria-label={title} className={cx('shrink-0 rounded px-1 text-[10px] font-bold', c)}>{t}</span>)}
        <span className="flex-1" />
        <span className={cx('shrink-0 whitespace-nowrap text-[11px] font-bold', st.text)}>{r.label}</span>
      </span>
      <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <span className="min-w-0 flex-1 truncate">#{r.p.employee_number ?? '—'} · {POS_SHORT[r.p.position_code ?? ''] ?? r.p.position_label ?? '—'} · {r.place.replace(' · day duty', '·Day')}</span>
        {r.codes.map((c) => <span key={c} className={cx('shrink-0 rounded px-1 py-px text-[10px] font-bold', leaveTone(r.typeCode).chip)}>{c}{r.movedFrom !== null ? ' ↻' : ''}</span>)}
        <span className={cx('shrink-0 tabular-nums', before ? 'text-slate-500' : 'font-semibold text-slate-700')}>{isOpenEnd(r.end) ? `${shortDate(r.start)} – open` : `${range(r.start, r.end)} · ${days(r.start, r.end)} d`}</span>
      </span>
    </button>
  );
}
