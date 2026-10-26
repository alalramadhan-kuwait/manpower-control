// Leave detail sheet (Calendar, owner 26 Oct 2026; compact decision-first layout approved the same day): tap a leave or
// a request in the Calendar. Above the fold only what the decision needs: who (number, position, actual crew, state),
// the leave (type, dates, days), three figures (duties, short: confirmed + potential, leave this year), one staffing
// conclusion, the warnings that need the Section Head (never folded) and the actions. Everything else is folded:
// duties, cover, crew also off, the shutdown rule, leave before / after, duties around, versions.
// Actions are the existing workflow only:
// - a planned PV: Approve · Reject (reason) · To fix (note) · Undo — the Section Head only (leave_approve,
//   leave_decline, leave_send_fix check it again); Reschedule opens the PV form (new dates and its check);
// - leave that is cancelled by a request (fixed types): Cancel with a reason, through the same server check as Requests;
// - a request waiting: Review in Approvals (its own check).
// Nothing changes by itself; the Calendar keeps its place (the sheet stays open and shows the new state).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CONTROLLER_LEAVE_RULES } from '@/core/controllers/leaveRules';
import { isOpenEnd } from '@/core/leave';
import { personOn } from '@/core/manpower';
import { isPlanPv } from '@/core/oracle';
import type { ApprovalState, PendingLeaveRequest, PlanState, RowState, ShutdownPeriod, TimeState } from '@/core/leave/status';
import { CREWS, type Crew } from '@/core/roster';
import { cancelLeaveEntry } from '@/data/entry';
import { GateBlocked } from '@/data/gate';
import { approveLeave, declineLeave, fetchLeaveVersions, sendLeaveToFix } from '@/data/leave';
import type { EmployeeDirectoryRow, LeaveRecord } from '@/data/types';
import { VersionList } from '@/features/leave/LeaveVersions';
import { BottomSheet, ErrorBox, Spinner, cx } from '@/ui/components';
import { CREW_IDENTITY } from '@/ui/crew';
import { shortDate } from '@/ui/leave';
import { leaveTone } from '@/ui/leaveTypes';
import { backHere } from './filters';
import { DutyRow, ROLE_SHORT, nth, useLeaveImpact } from './ImpactPreview';
import { REQUEST_BAR, ROW_STYLE } from './rowStyle';

/** One leave as the Calendar lists it: joined records, a cancelled / replaced version, or a request waiting. */
export interface LeaveItem {
  key: string; p: EmployeeDirectoryRow; start: string; end: string; codes: string[]; typeCode: string | null; place: string; home: string | null; actual: string | null;
  records: LeaveRecord[]; movedFrom: string | null; movedTo: string | null; approval: ApprovalState | null; plan: PlanState; time: TimeState | null;
  state: RowState; label: string; /** cancelled through a request (fixed leave types; a PV is moved, not cancelled) */ cancellable: boolean;
  request: PendingLeaveRequest | null; cancelAsked: boolean;
  /** Not approved and overlapping a planned shutdown: may still be cancelled for it (display only). */
  sd: ShutdownPeriod | null;
}
const range = (s: string, e: string) => (isOpenEnd(e) ? `${shortDate(s)} – return open` : s === e ? shortDate(s) : `${shortDate(s)} – ${shortDate(e)}`);
const days = (s: string, e: string) => Math.round((Date.parse(e) - Date.parse(s)) / 864e5) + 1;
const POS: Record<string, string> = { controller: 'Controller', vr_controller: 'VR Controller', morning_controller: 'Morning Controller', panel_operator: 'Panel', field_operator: 'Field' };
const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w.endsWith('y') ? `${w.slice(0, -1)}ies` : `${w}s`}`;
type Ask = null | 'reject' | 'fix' | 'cancel';

export function LeaveDetail({ item, around, isHead, onClose, onChanged }: {
  item: LeaveItem; /** the person's other leaves (joined), oldest first */ around: { start: string; end: string; codes: string[] }[];
  today: string; isHead: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { p, records, request } = item;
  const [versions, setVersions] = useState<LeaveRecord[][]>([]);
  const [ask, setAsk] = useState<Ask>(null); const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState<{ msg: string; undo?: () => Promise<unknown> } | null>(null);
  const [more, setMore] = useState(false); const [allDuties, setAllDuties] = useState(false); const [openVersions, setOpenVersions] = useState(false);
  useEffect(() => {
    let live = true;
    const roots = [...new Set(records.map((r) => r.root_id))];
    Promise.all(roots.map((r) => fetchLeaveVersions(r).catch(() => []))).then((v) => live && setVersions(v.filter((x) => x.length > 1)));
    return () => { live = false; };
  }, [records]);
  const prev = [...around].reverse().find((l) => l.end < item.start) ?? null;
  const next = around.find((l) => l.start > item.end) ?? null;
  const st = ROW_STYLE[item.state];
  const ids = records.map((r) => r.id);
  const pv = isPlanPv(item.typeCode) && item.plan === 'current';
  const decided = records.some((r) => r.approved_at) ? 'approved' : records.some((r) => r.declined_at) ? 'declined' : records.some((r) => r.fix_sent_at) ? 'fix' : null;
  const counted = !request && item.plan === 'current' && item.approval !== 'lapsed' && item.approval !== 'declined';
  // the same plans as the Calendar: a planned PV counts as approved once approved; other leave types always
  const thisApproved = !request && item.plan === 'current' && (isPlanPv(item.typeCode) ? item.approval === 'approved' : item.approval !== 'declined');
  const leave = useMemo(() => ({ employeeId: p.id, start: item.start, end: item.end, typeCode: item.typeCode, recordIds: item.plan === 'current' ? ids : [] }),
    [p.id, item.start, item.end, item.typeCode, item.plan, ids.join()]);
  const { inputs, p: im, split, error: impactError, last } = useLeaveImpact(leave, thisApproved);
  const back = `&back=${backHere()}`;

  async function act(fn: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) {
    setBusy(true); setErr(null); setMore(false);
    try { await fn(); setDone({ msg, undo }); setAsk(null); setText(''); onChanged(); }
    catch (e) { setErr(e instanceof GateBlocked ? new Error(e.message) : e); } finally { setBusy(false); }
  }
  const approve = () => act(() => approveLeave(ids, true), 'Approved.', () => approveLeave(ids, false));
  const reject = () => act(() => declineLeave(ids, true, text), 'Not approved. The reason is kept.', () => declineLeave(ids, false));
  const toFix = () => act(() => sendLeaveToFix(ids, text, true), 'Sent to the Coordinator to fix.', () => sendLeaveToFix(ids, '', false));
  const undoDecision = () => act(() => (decided === 'approved' ? approveLeave(ids, false) : decided === 'declined' ? declineLeave(ids, false) : sendLeaveToFix(ids, '', false)), 'Back to planned (not approved).');
  const cancel = () => { const r = records[0];
    return act(() => cancelLeaveEntry({ employeeId: p.id, recordId: r.id, code: r.absence_type_code ?? '', label: item.codes.join('+'), start: r.start_date, end: r.end_date, reason: text, summaryDates: range(r.start_date, r.end_date) }),
      isHead ? 'Cancelled. The leave is kept in the history.' : 'Cancellation sent to the Section Head.'); };
  const reschedule = `/requests?view=entry&card=pv&emp=${p.id}&leave=${records[0]?.start_date ?? item.start}${back}`;
  const btn = 'min-h-11 rounded-xl px-3 text-sm font-semibold ring-1 disabled:opacity-50';
  const pick = (a: Ask) => { setMore(false); setAsk(ask === a ? null : a); };

  // what the More menu offers (existing actions only, by state and role)
  const current = item.plan === 'current';
  const canDecide = current && !request && pv && isHead && !decided;
  const menu: { label: string; hint?: string; to?: string; run?: () => void; tone?: string }[] = [
    ...(canDecide ? [{ label: 'To fix…', hint: 'to Coordinator', run: () => pick('fix') }] : []),
    ...(current && !request && pv && item.time !== 'taken' ? [{ label: 'Reschedule ›', to: reschedule }] : []),
    ...(current && !request && item.cancellable && !item.cancelAsked && item.time !== 'taken' ? [{ label: 'Cancel leave…', run: () => pick('cancel'), tone: 'text-red-700' }] : []),
    ...(versions.length ? [{ label: `Versions (${versions.reduce((n, v) => n + v.length, 0)})`, run: () => { setMore(false); setOpenVersions(true); } }] : []),
    { label: 'Profile ›', to: `/employees/${p.id}` }
  ];

  // staffing figures
  const crew = im?.duties[0]?.crew ?? null;
  const confirmed = new Set(split?.confirmed ?? []); const potential = new Set(split?.potential ?? []);
  const kindOf = (d: string) => (confirmed.has(d) ? 'confirmed' as const : potential.has(d) ? 'potential' as const : null);
  const others = new Map<string, string | null>(); for (const d of im?.duties ?? []) for (const o of d.othersOff) others.set(o.id, o.role);
  const byRole = [...others.values()].reduce<Record<string, number>>((m, r) => ({ ...m, [r ?? 'other']: (m[r ?? 'other'] ?? 0) + 1 }), {});
  const ctl = im?.controller ?? null;
  const people = new Map((inputs?.people ?? []).map((x) => [x.id, x]));
  const shownDuties = im ? (allDuties || im.duties.length <= 16 ? im.duties : im.duties.filter((d) => d.issue || d.before !== d.after || kindOf(d.date))) : [];
  const status = records.find((r) => r.approved_at); const declined = records.find((r) => r.declined_at); const fix = records.find((r) => r.fix_sent_at);
  const actualCrew = (CREWS as readonly string[]).includes(item.actual ?? '') ? (item.actual as Crew) : null;

  return (
    <BottomSheet open onClose={onClose} title={p.display_name}>
      <div className="space-y-2 text-sm">
        {/* who */}
        <div className="-mt-1 flex items-center gap-1.5 text-xs text-slate-600">
          <span className="min-w-0 flex-1">#{p.employee_number} · {POS[p.position_code ?? ''] ?? p.position_label ?? '—'}{p.grade ? ` G${p.grade}` : ''} · {actualCrew && <span className={cx('mr-1 inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold text-white align-[-2px]', CREW_IDENTITY[actualCrew].bg)}>{actualCrew}</span>}{item.place === actualCrew ? `${actualCrew} Shift` : item.place}
            {item.sd && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">SD</span>}</span>
          <span className={cx('shrink-0 rounded-md px-1.5 py-px text-[11px] font-bold', st.row.split(' ')[0], st.text)}>{item.label}</span>
        </div>

        {/* the leave */}
        <div className={cx('rounded-xl border-l-[3px] px-3 py-1.5', st.row, request && REQUEST_BAR)}>
          <div className="flex flex-wrap items-center gap-1.5">
            {item.codes.map((c) => <span key={c} className={cx('rounded px-1.5 py-px text-[11px] font-bold', leaveTone(item.typeCode).chip)}>{c}{item.movedFrom !== null ? ' ↻' : ''}</span>)}
            <b className={cx('tabular-nums', item.state === 'cancelled' && 'line-through decoration-red-300')}>{range(item.start, item.end)}</b>{!isOpenEnd(item.end) && <span className="text-slate-500">· {days(item.start, item.end)} d</span>}
          </div>
          {(request || status || declined || fix || item.movedFrom !== null || item.movedTo || item.cancelAsked) && (
            <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-slate-600">
              {request && <span>Requested {shortDate(request.requestedAt.slice(0, 10))} · not in the plan yet</span>}
              {status && <span>Approved{records[0].approved_by_name ? ` · ${records[0].approved_by_name}` : ''} {shortDate(status.approved_at!.slice(0, 10))}</span>}
              {declined && <span className="text-red-700">Not approved: {declined.declined_reason ?? 'no reason'}</span>}
              {fix && <span className="text-amber-800">To fix{fix.fix_note ? `: ${fix.fix_note}` : ''}</span>}
              {item.movedFrom !== null && <span>↻ {item.movedFrom ? `from ${item.movedFrom}` : 'rescheduled'}</span>}
              {item.movedTo && <span>Now {item.movedTo}</span>}
              {item.cancelAsked && <span className="font-semibold text-red-700">Cancellation waiting</span>}
            </p>
          )}
        </div>

        {/* three figures */}
        {impactError ? <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-800">Staffing check did not run · do not decide on it until it does</p>
          : !im || !split ? <Spinner label="Checking the crews…" /> : <>
          <div className="grid grid-cols-3 gap-1.5">
            <Kpi label={counted ? 'Duties' : 'Duties if counted'} value={im.duties.length} sub={crew ? `${crew} Shift` : 'none'} />
            <Kpi label="Short" tone={confirmed.size ? 'red' : potential.size ? 'amber' : 'green'}
              value={<>{confirmed.size ? <span className="text-status-red">{confirmed.size}</span> : potential.size ? null : <span className="text-status-green">0</span>}{potential.size ? <span className="text-amber-700">{confirmed.size ? <span className="text-sm"> +{potential.size}</span> : `+${potential.size}`}</span> : null}</>}
              sub={`${confirmed.size} conf · ${potential.size} pot`} />
            <Kpi label="This year" value={ctl?.nth ? nth(ctl.nth) : im.year.count} sub={`${im.year.days} d${ctl ? ` · max ${CONTROLLER_LEAVE_RULES.maxLeavesPerYear}` : ''}`} />
          </div>

          {/* one conclusion: confirmed and potential kept apart */}
          {confirmed.size > 0 && <Line tone="red">● {plural(confirmed.size, 'duty')} short even with approved leave only</Line>}
          {potential.size > 0 && <Line tone="potential">◌ +{potential.size} if planned leave is approved{thisApproved ? '' : ' (this one included)'}</Line>}
          {im.coverNeeded > 0 && <Line tone="grey">Controller cover needed · {plural(im.coverNeeded, 'duty')}</Line>}
          {im.dataMissing > 0 && <Line tone="grey">Data missing · {plural(im.dataMissing, 'duty')}</Line>}
          {!confirmed.size && !potential.size && !im.coverNeeded && !im.dataMissing && <Line tone="green">{im.duties.length ? '✓ No crew below minimum' : 'No duty in these dates'}</Line>}

          {/* warnings that need the Section Head: never folded */}
          {ctl && ctl.offTogether.length > 0 && <Line tone="redSoft">⚠ Controllers off together: {ctl.offTogether.map((o) => `${o.vr ? (o.crew ? `VR in ${o.crew}` : 'VR') : `${o.crew ?? '—'} Shift`} ${shortDate(o.start)}${o.end !== o.start ? `–${shortDate(o.end)}` : ''}`).join(' · ')} · needs your approval</Line>}
          {ctl?.extra && <Line tone="amberSoft">⚠ {nth(ctl.nth)} annual leave this year · over {CONTROLLER_LEAVE_RULES.maxLeavesPerYear}, needs your approval</Line>}
        </>}
        {item.sd && <Line tone="amberSoft">◷ Shutdown {item.sd.title} {shortDate(item.sd.start)}–{shortDate(item.sd.end)} · may be cancelled for it</Line>}
        {item.approval === 'lapsed' && !item.sd && <Line tone="amberSoft">Started, not approved · counted as planned available</Line>}

        {/* actions */}
        {current && (
          <div className="space-y-1.5">
            {done && <p role="status" className="flex items-center gap-2 text-xs font-medium text-status-green">{done.msg}
              {done.undo && <button type="button" disabled={busy} onClick={() => act(done.undo!, 'Undone.')} className="font-semibold text-brand-700 underline">Undo</button>}</p>}
            <div className="relative flex gap-1.5">
              {request ? <Link to={`/requests?view=approvals${back}`} className={cx(btn, 'flex flex-1 items-center justify-center bg-brand-700 text-white ring-brand-700')}>Review in Approvals ›</Link>
                : canDecide ? <>
                  <button type="button" disabled={busy} onClick={approve} className={cx(btn, 'flex-[1.4] bg-brand-700 text-white ring-brand-700')}>✓ Approve</button>
                  <button type="button" disabled={busy} onClick={() => pick('reject')} className={cx(btn, 'flex-1 bg-white text-red-700 ring-slate-200')}>Reject…</button>
                </> : pv && isHead && decided && !done ? <button type="button" disabled={busy} onClick={undoDecision} className={cx(btn, 'flex-1 bg-white text-slate-700 ring-slate-200')}>↶ Undo {decided === 'approved' ? 'approval' : decided === 'declined' ? 'rejection' : 'to fix'}</button>
                : <span className="flex-1" />}
              <button type="button" aria-label="More actions" aria-expanded={more} onClick={() => setMore(!more)} className={cx(btn, 'w-11 shrink-0 bg-white px-0 text-slate-700 ring-slate-200', more && 'bg-brand-50')}>⋯</button>
              {more && (
                <ul role="menu" className="absolute right-0 top-full z-10 mt-1 w-56 divide-y divide-slate-100 overflow-hidden rounded-xl bg-white text-sm shadow-lg ring-1 ring-slate-200">
                  {menu.map((m) => <li key={m.label} role="none">{m.to
                    ? <Link role="menuitem" to={m.to} className={cx('flex min-h-10 items-center px-3', m.tone ?? 'text-slate-800')}>{m.label}</Link>
                    : <button role="menuitem" type="button" onClick={m.run} className={cx('flex min-h-10 w-full items-center px-3 text-left', m.tone ?? 'text-slate-800')}>{m.label}{m.hint && <span className="ml-auto text-[11px] text-slate-500">{m.hint}</span>}</button>}</li>)}
                </ul>
              )}
            </div>
            {ask && (
              <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
                <label className="block text-xs font-medium text-slate-700" htmlFor="leave-act-text">{ask === 'reject' ? 'Reason (kept with the leave)' : ask === 'fix' ? 'What to fix (sent to the Coordinator)' : 'Reason for cancelling (required)'}</label>
                <textarea id="leave-act-text" rows={2} className="input py-1.5 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => { setAsk(null); setText(''); }} className={cx(btn, 'min-h-10 flex-1 bg-white text-slate-700 ring-slate-200')}>Keep</button>
                  <button type="button" disabled={busy || !text.trim()} onClick={ask === 'reject' ? reject : ask === 'fix' ? toFix : cancel}
                    className={cx(btn, 'min-h-10 flex-1 text-white', ask === 'fix' ? 'bg-brand-700 ring-brand-700' : 'bg-status-red ring-status-red')}>{ask === 'reject' ? 'Reject' : ask === 'fix' ? 'Send to fix' : isHead ? 'Cancel leave' : 'Send cancellation'}</button>
                </div>
              </div>
            )}
            {err != null && <ErrorBox error={err} />}
          </div>
        )}
        {!current && <Link to={`/employees/${p.id}`} className="inline-block rounded-lg px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200">Profile ›</Link>}

        {/* details, folded */}
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
          {im && (
            <Fold title="Duties" value={<>{im.duties.length}{confirmed.size || potential.size ? <> · {confirmed.size ? <span className="text-status-red">{confirmed.size}</span> : 0}{potential.size ? ` + ${potential.size}` : ''} short</> : ' · 0 short'}</>}>
              {shownDuties.length > 0 ? <ul className="divide-y divide-slate-100">{shownDuties.map((d) => <DutyRow key={d.date} d={d} kind={kindOf(d.date)} />)}</ul>
                : <p className="px-2 py-1 text-slate-500">{im.duties.length ? 'No duty changes colour' : 'No duty in these dates'}</p>}
              {im.duties.length > shownDuties.length && <button type="button" onClick={() => setAllDuties(true)} className="px-2 py-1 font-medium text-brand-700">All {im.duties.length} duties</button>}
            </Fold>
          )}
          {ctl && crew && (im!.coverNeeded > 0 || ctl.candidates.length > 0) && (
            <Fold title="Cover" value={`${ctl.candidates.length} free${ctl.candidates.filter((c) => people.get(c.id)?.role === 'vr_controller').length ? ` · ${ctl.candidates.filter((c) => people.get(c.id)?.role === 'vr_controller').length} VR` : ''}`}>
              <ul className="divide-y divide-slate-100">
                {ctl.candidates.map((c) => { const q = people.get(c.id); const at = q ? personOn(q, item.start) : null;
                  return <li key={c.id} className="flex items-center gap-1.5 px-2 py-1"><span className="min-w-0 flex-1">{c.name}</span>
                    <span className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-700">{at?.role === 'vr_controller' ? (at.crew ? `VR · ${at.crew}` : 'VR') : at?.crew ?? 'Day'}</span>
                    {c.warnings.length ? <span className="text-amber-700" title={c.warnings.join(' · ')}>⚠ {c.warnings[0]}</span> : <span className="text-status-green">✓</span>}</li>; })}
                {!ctl.candidates.length && <li className="px-2 py-1 text-slate-500">None free</li>}
              </ul>
              <Link to={`/requests?view=entry&card=controller&kind=cover&crew=${crew}&from=${item.start}&to=${last}&back=${backHere()}`} className="block px-2 py-1 font-medium text-brand-700">Assign cover ›</Link>
            </Fold>
          )}
          {item.sd && (
            <Fold title="Shutdown rule" value={item.approval === 'lapsed' ? 'counted as available' : 'on leave until day 1'}>
              <p className="px-2 py-1 text-slate-700">{item.approval === 'lapsed' ? 'Not approved by its first day: counted as planned available until you decide. Not confirmed attendance.'
                : 'Counted as on leave until its first day; if still not approved then, counted as planned available for the shutdown.'} {item.sd.title} {shortDate(item.sd.start)}–{shortDate(item.sd.end)}.</p>
            </Fold>
          )}
          {im && others.size > 0 && (
            <Fold title="Crew also off" value={`${others.size} · ${Object.entries(byRole).map(([r, n]) => `${r === 'controller' || r === 'vr_controller' || r === 'morning_controller' ? 'Ctl' : (ROLE_SHORT[r] ?? r).slice(0, 1)}${n}`).join(' ')}`}>
              <p className="px-2 py-1 text-slate-700">{Object.entries(byRole).map(([r, n]) => `${ROLE_SHORT[r] ?? r} ${n}`).join(' · ')}</p>
            </Fold>
          )}
          <Fold title="Before / after" value={`${prev ? `${prev.codes.join('+')} ${range(prev.start, prev.end)}` : '—'} · ${next ? `${next.codes.join('+')} ${range(next.start, next.end)}` : '—'}`}>
            <div className="grid grid-cols-2 gap-1.5 px-2 py-1">
              <div><span className="text-slate-500">Before</span><b className="block tabular-nums">{prev ? `${prev.codes.join('+')} ${range(prev.start, prev.end)}` : '—'}</b></div>
              <div><span className="text-slate-500">After</span><b className="block tabular-nums">{next ? `${next.codes.join('+')} ${range(next.start, next.end)}` : '—'}</b></div>
            </div>
          </Fold>
          {im && (
            <Fold title="Duty around" value={`${im.lastDuty ? `${im.lastDuty.shift} ${shortDate(im.lastDuty.date)}` : '—'} · ${im.nextDuty ? `${im.nextDuty.shift} ${shortDate(im.nextDuty.date)}` : '—'}`}>
              <p className="px-2 py-1 text-slate-700">Last duty {im.lastDuty ? `${im.lastDuty.shift} ${shortDate(im.lastDuty.date)}` : '—'} · next duty {im.nextDuty ? `${im.nextDuty.shift} ${shortDate(im.nextDuty.date)}` : '—'}{records.length > 1 ? ` · ${records.length} records, one leave` : ''}</p>
            </Fold>
          )}
          {versions.length > 0 && (
            <Fold title="Versions" value={String(versions.reduce((n, v) => n + v.length, 0))} open={openVersions} onToggle={setOpenVersions}>
              <div className="space-y-2 px-2 pb-2">{versions.map((v) => <VersionList key={v[0].root_id} versions={v} />)}</div>
            </Fold>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub: string; tone?: 'red' | 'amber' | 'green' }) {
  return (
    <div className={cx('rounded-xl px-2 py-1 ring-1', tone === 'red' ? 'ring-red-200' : tone === 'amber' ? 'ring-amber-300' : 'ring-slate-200')}>
      <p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-bold leading-tight tabular-nums text-slate-900">{value}</p>
      <p className="text-[11px] leading-tight text-slate-600">{sub}</p>
    </div>
  );
}

const LINE = {
  red: 'bg-red-50 text-red-800', potential: 'border border-dashed border-amber-500 text-amber-800', green: 'bg-green-50 text-green-800',
  grey: 'bg-slate-100 text-slate-800', redSoft: 'bg-red-50 text-red-800 text-xs', amberSoft: 'bg-amber-50 text-amber-800 text-xs'
} as const;
function Line({ tone, children }: { tone: keyof typeof LINE; children: ReactNode }) {
  return <p className={cx('rounded-lg px-2.5 py-1.5 text-[13px] font-semibold', LINE[tone])}>{children}</p>;
}

function Fold({ title, value, children, open, onToggle }: { title: string; value: ReactNode; children: ReactNode; open?: boolean; onToggle?: (o: boolean) => void }) {
  return (
    <details open={open} onToggle={onToggle ? (e) => onToggle((e.currentTarget as HTMLDetailsElement).open) : undefined} className="group text-xs">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 px-2.5 [&::-webkit-details-marker]:hidden">
        <span className="w-2.5 text-slate-500 group-open:rotate-90">▸</span>
        <span className="text-[13px] font-semibold text-slate-700">{title}</span>
        <span className="ml-auto min-w-0 truncate pl-2 text-right tabular-nums text-slate-600">{value}</span>
      </summary>
      <div className="bg-slate-50/60 pb-1">{children}</div>
    </details>
  );
}
