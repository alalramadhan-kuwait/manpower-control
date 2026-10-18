// Shutdown rules v2 on the plan page: readiness (continuous coverage, eligibility, duty and rest, overtime), the figures
// typed in from Oracle / HR (overtime taken, sick leave in 12 months), the Section Head's exceptions, and the approval,
// which the server records only after checking the plan again. Plans made before v2 never show any of this.
import { AlertTriangle, BadgeCheck, Check, CircleDashed, Info, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { SdMember, SdPlan } from '@/core/shutdown';
import { SICK_LABEL, fmtDay, fmtMonth, limitsOf, sickState, type CoverFix, type TransferFix, type CoverGap, type Eligibility, type ExceptionKind, type IssueLevel, type OtEntry, type PersonOt, type PlanCheck, type SdException, type SickEntry } from '@/core/shutdown/v2';
import { createAssignment } from '@/data/controllers';
import { addSdRestDay, setSdDays } from '@/data/shutdown';
import { grantException, requestApproval, revokeException, saveOtEntry, saveSickCheck, type ApprovalState } from '@/data/sdCheck';
import type { EmployeeDirectoryRow } from '@/data/types';
import { BottomSheet, Button, Card, ErrorBox, Field, cx } from '@/ui/components';
import { localToday } from '@/ui/leave';

const LEVEL: Record<IssueLevel, { label: string; tone: string; icon: React.ReactNode }> = {
  block: { label: 'Blocking', tone: 'bg-red-50 text-red-900 ring-red-300', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  verify: { label: 'To enter or verify', tone: 'bg-sky-50 text-sky-900 ring-sky-300', icon: <CircleDashed className="h-3.5 w-3.5" /> },
  warn: { label: 'Warnings', tone: 'bg-amber-50 text-amber-900 ring-amber-300', icon: <ShieldAlert className="h-3.5 w-3.5" /> },
  info: { label: 'For information', tone: 'bg-slate-50 text-slate-700 ring-slate-200', icon: <Info className="h-3.5 w-3.5" /> },
};
export const STATUS_TEXT: Record<PlanCheck['status'], string> = { ready: 'Ready', not_ready: 'Not operationally ready', verify: 'Verification required' };
const statusTone = (s: PlanCheck['status']) => (s === 'ready' ? 'bg-green-600 text-white' : s === 'verify' ? 'bg-sky-600 text-white' : 'bg-status-red text-white');
const OT_TONE = { ok: 'text-green-800', warn: 'text-amber-800 font-semibold', over: 'text-status-red font-bold', unknown: 'text-sky-800' } as const;

/** One line per person for the same kind of finding (e.g. every pair of rest days he works), the rest as they are. */
type ExcFix = { employeeId: string; kind: ExceptionKind };
/** The Section Head's exception that clears a blocking eligibility finding (two shutdowns in a row, sick leave over 35 days). */
const exceptionFor = (i: PlanCheck['issues'][number]): ExcFix | undefined =>
  i.code !== 'eligibility' || i.level !== 'block' || !i.employeeId ? undefined
    : /two shutdowns in a row/.test(i.message) ? { employeeId: i.employeeId, kind: 'consecutive_shutdown' }
    : /over 35/.test(i.message) ? { employeeId: i.employeeId, kind: 'sick_leave' } : undefined;
function grouped(list: PlanCheck['issues']): { text: string; fix?: CoverFix | TransferFix; exc?: ExcFix }[] {
  const out: { text: string; fix?: CoverFix | TransferFix; exc?: ExcFix }[] = []; const seen = new Map<string, number>();
  for (const i of list) {
    if (i.code !== 'rest_day_pair' || !i.employeeId) { out.push({ text: i.message, fix: i.fix, exc: exceptionFor(i) }); continue; }
    const k = `${i.code}|${i.employeeId}`; const at = seen.get(k);
    const days = /rest days (.+?);/.exec(i.message)?.[1] ?? '';
    if (at === undefined) { seen.set(k, out.length); out.push({ text: i.message }); }
    else out[at] = { text: out[at].text.replace(/rest days (.+?);/, (_m, d) => `rest days ${d}, ${days};`) };
  }
  return out;
}

/** The Section Head grants the exception the finding asks for (recorded with the reason; revocable from the person). */
function ExceptionButton({ planId, exc, finding, onDone }: { planId: string; exc: ExcFix; finding: string; onDone: (m: string) => void }) {
  const [open, setOpen] = useState(false); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const label = exc.kind === 'consecutive_shutdown' ? 'Grant the exception: two shutdowns in a row' : 'Grant the exception: sick leave';
  async function grant() {
    setBusy(true); setErr(null);
    try { await grantException({ planId, employeeId: exc.employeeId, kind: exc.kind, reason: reason.trim() || `Approved by the Section Head. ${finding}` }); onDone('Exception recorded.'); }
    catch (e) { setErr(e); setBusy(false); }
  }
  if (!open) return <span className="mt-1 block"><Button variant="secondary" className="min-h-8 px-2.5 text-xs" onClick={() => setOpen(true)}>{label}</Button></span>;
  return (
    <span className="mt-1 block space-y-1">
      <textarea className="input min-h-14 w-full text-xs" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <span className="flex gap-1.5"><Button className="min-h-8 px-2.5 text-xs" disabled={busy} onClick={grant}>Grant</Button><Button variant="secondary" className="min-h-8 px-2.5 text-xs" onClick={() => setOpen(false)}>Cancel</Button></span>
      {err ? <ErrorBox error={err} /> : null}
    </span>
  );
}

/** One tap applies the one-day change the transfer between the rota and the shutdown cycle suggests. */
function TransferButton({ plan, fix, onDone }: { plan: SdPlan; fix: TransferFix; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const label = fix.kind === 'rest' ? `Give ${fmtDay(fix.date)} off before rejoining` : fix.works ? `Work ${fmtDay(fix.date)}` : `Give ${fmtDay(fix.date)} off`;
  async function apply() {
    setBusy(true); setErr(null);
    try {
      if (fix.kind === 'rest') await addSdRestDay(fix.memberId, fix.date);
      else await setSdDays(fix.memberId, [{ date: fix.date, works: fix.works, hours: fix.works ? plan.shiftHours : null }]);
      onDone(`${label}: done.`);
    } catch (e) { setErr(e); setBusy(false); }
  }
  return <span className="mt-1 block"><Button variant="secondary" className="min-h-8 px-2.5 text-xs" disabled={busy} onClick={apply}>{label}</Button>{err ? <ErrorBox error={err} /> : null}</span>;
}

/** One tap records the cover the check proposes (Controller Management), then the plan is checked again. */
function CoverButton({ fix, onDone }: { fix: CoverFix; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const span = `${fmtDay(fix.start)}${fix.end > fix.start ? ` – ${fmtDay(fix.end)}` : ''}`;
  async function record() {
    setBusy(true); setErr(null);
    try {
      await createAssignment({ kind: 'shift_cover', employee_id: fix.employeeId, crew_code: fix.crew, covers_employee_id: fix.coversEmployeeId, start_date: fix.start, end_date: fix.end,
        note: `Proposed by the shutdown plan check: covers ${fix.crew} Shift while its Controller rests before / after the shutdown team.` });
      onDone(`Cover recorded: ${fix.name} on ${fix.crew} Shift ${span}.`);
    } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <span className="mt-1 block">
      <Button variant="secondary" className="min-h-8 px-2.5 text-xs" disabled={busy} onClick={record}>Record cover: {fix.name} · {fix.crew} Shift {span}</Button>
      {err ? <span className="mt-1 block"><ErrorBox error={err} /></span> : null}
    </span>
  );
}

/** The readiness of the plan and its approval. */
export function ReadinessPanel({ plan, names, check, approval, isHead, error, onApproved }: { plan: SdPlan; names: Map<string, string>; check: PlanCheck | null; approval: ApprovalState | null; isHead: boolean; error: unknown; onApproved: (m: string) => void }) {
  const [open, setOpen] = useState<IssueLevel | null>('block');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  if (error) return <div className="mb-3"><ErrorBox error={error} /></div>;
  if (!check) return <Card className="mb-3 py-2 text-sm text-slate-500">Checking the plan…</Card>;
  const approved = approval?.status === 'approved';
  const stale = approved && approval?.fingerprint !== check.fingerprint;
  const counts = (l: IssueLevel) => check.issues.filter((i) => i.level === l).length;
  async function approve() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await requestApproval(plan.id, check!.fingerprint);
      if (r.approved) onApproved('Plan approved: the server checked it again and recorded the approval.');
      else setMsg(r.reason ?? 'Not approved.');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Card className="mb-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-bold', statusTone(check.status))}>{STATUS_TEXT[check.status]}</span>
        {approved && !stale && <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-900"><BadgeCheck className="h-3.5 w-3.5" />Approved {approval?.approvedAt ? new Date(approval.approvedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}</span>}
        {stale && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Approved, but the data changed since: approve again</span>}
        <span className="ml-auto text-[11px] text-slate-500">Rules v2 · checked {fmtDay(check.checkedOn)}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-center">
        {(['block', 'verify', 'warn', 'info'] as IssueLevel[]).map((l) => (
          <button key={l} type="button" aria-pressed={open === l} onClick={() => setOpen(open === l ? null : l)} className={cx('rounded-lg px-1 py-1 ring-1', LEVEL[l].tone, open === l && 'ring-2')}>
            <div className="text-base font-semibold leading-tight tabular-nums">{counts(l)}</div>
            <div className="text-[10px] leading-tight">{LEVEL[l].label}</div>
          </button>
        ))}
      </div>
      {open && counts(open) > 0 && (
        <ul className={cx('mt-2 space-y-1 rounded-lg px-2.5 py-2 text-xs ring-1', LEVEL[open].tone)}>
          {grouped(check.issues.filter((i) => i.level === open)).map((m, k) => <li key={k} className="flex items-start gap-1.5">{LEVEL[open].icon}<span>{m.text}{m.fix && isHead ? (m.fix.kind === 'cover' ? <CoverButton fix={m.fix} onDone={onApproved} /> : <TransferButton plan={plan} fix={m.fix} onDone={onApproved} />) : null}{m.exc && isHead ? <ExceptionButton planId={plan.id} exc={m.exc} finding={m.text} onDone={onApproved} /> : null}</span></li>)}
        </ul>
      )}
      {check.gaps.length > 0 && <CoverageList gaps={check.gaps} />}
      <OvertimeTable plan={plan} names={names} rows={check.overtime} spread={check.spread} />
      {isHead && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          {msg && <p className="mb-1.5 text-xs font-medium text-status-red">{msg}</p>}
          {err != null && <ErrorBox error={err} />}
          <Button className="w-full" disabled={busy || check.status !== 'ready' || (approved && !stale)} onClick={approve}>
            <ShieldCheck className="h-4 w-4" />{busy ? 'Checking again…' : approved && !stale ? 'Approved' : check.status === 'ready' ? 'Approve the plan' : `Cannot approve: ${STATUS_TEXT[check.status].toLowerCase()}`}
          </Button>
          <p className="mt-1 text-[11px] text-slate-500">The server checks the plan again from the database before recording the approval. Any later change sends it back to draft.</p>
        </div>
      )}
      {!isHead && <p className="mt-2 text-[11px] text-slate-500">The Section Head approves the plan once it is Ready.</p>}
    </Card>
  );
}

/** Uncovered stretches: role, team, date and time. */
function CoverageList({ gaps }: { gaps: CoverGap[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? gaps : gaps.slice(0, 8);
  return (
    <div className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs text-red-900 ring-1 ring-red-300">
      <p className="font-semibold">Below the minimum on duty · {gaps.length} {gaps.length === 1 ? 'stretch' : 'stretches'} (checked hour by hour)</p>
      <table className="mt-1 w-full text-left">
        <thead className="text-[10px] uppercase text-red-700"><tr><th className="font-semibold">Team</th><th className="font-semibold">Date</th><th className="font-semibold">Role</th><th className="font-semibold">On duty</th><th className="font-semibold">When</th></tr></thead>
        <tbody>{shown.map((g, i) => <tr key={i}><td>{g.team}</td><td>{fmtDay(g.date)}</td><td>{g.label}</td><td className="tabular-nums">{g.have} of {g.need}</td><td className="tabular-nums">{g.from}–{g.to} ({g.hours} h)</td></tr>)}</tbody>
      </table>
      {gaps.length > 8 && <button type="button" className="mt-1 font-semibold underline" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${gaps.length}`}</button>}
      <p className="mt-1 text-[11px]">Fix with the fewest changes: a &quot;follow X shift&quot; instruction (Shift instructions), the days &amp; hours, or a qualified person from another crew.</p>
    </div>
  );
}

/** Overtime per person: this plan, already taken (Oracle), other shutdowns, the total against the limits, per month and year. */
function OvertimeTable({ plan, names, rows, spread }: { plan: SdPlan; names: Map<string, string>; rows: PersonOt[]; spread: PlanCheck['spread'] }) {
  const [open, setOpen] = useState(false);
  const L = limitsOf(plan);
  const months = [...new Set(rows.flatMap((r) => r.months.map((m) => m.key)))].sort();
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-xs font-semibold text-slate-700">
        <span>Overtime · team spread {spread.diff} h (highest {spread.max}, lowest {spread.min})</span><span className="text-brand-700">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-[10px] uppercase text-slate-500"><tr><th className="text-left font-semibold">Person</th><th className="font-semibold">Plan</th>{months.map((m) => <th key={m} className="font-semibold">{fmtMonth(m)}</th>)}<th className="font-semibold">Year</th><th className="text-left font-semibold">Oracle figures</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="truncate py-0.5 pr-1 text-left">{names.get(r.employeeId) ?? '—'}</td>
                  <td className="text-center">{r.plan}</td>
                  {months.map((m) => { const x = r.months.find((y) => y.key === m); return <td key={m} className={cx('text-center', x && OT_TONE[x.state])} title={x ? `this plan ${x.plan} + taken ${x.prev ?? '?'} + other shutdowns ${x.other}` : ''}>{x ? `${x.total}${x.prev === null ? '+?' : ''}` : '—'}</td>; })}
                  <td className="text-center">{r.years.map((y) => <span key={y.key} className={cx('block', OT_TONE[y.state])}>{y.total}{y.prev === null ? '+?' : ''}</span>)}</td>
                  <td className={cx('text-left', r.entryState === 'ok' ? 'text-green-800' : 'text-sky-800')}>{r.entryState === 'ok' ? `✓ as of ${fmtDay(r.entry!.asOf)}` : r.entryState === 'missing' ? 'Missing' : r.entryState === 'unverified' ? 'Not verified' : 'Dated after start'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-500">Month: warning above {L.monthWarn} h, limit {L.monthHard} h · Year: warning above {L.yearWarn} h, limit {L.yearHard} h · &quot;+?&quot; = overtime already taken not entered yet. A night across month-end is split by the hours in each month.</p>
        </div>
      )}
    </div>
  );
}

/** The figures typed in from Oracle / HR for each member: overtime taken (year and month to date) and sick leave in 12 months. */
export function FiguresSheet({ plan, members, dir, ot, sick, onClose, onDone }: { plan: SdPlan; members: SdMember[]; dir: Map<string, EmployeeDirectoryRow>; ot: Map<string, OtEntry>; sick: Map<string, SickEntry>; onClose: () => void; onDone: (m: string) => void }) {
  const today = localToday();
  const ids = [...new Set(members.map((m) => m.employeeId))].sort((a, b) => (dir.get(a)?.display_name ?? '').localeCompare(dir.get(b)?.display_name ?? ''));
  const [who, setWho] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(today < plan.start ? today : plan.start);
  const [ytd, setYtd] = useState(''); const [mtd, setMtd] = useState(''); const [verified, setVerified] = useState(true);
  const [sdays, setSdays] = useState(''); const [sickAsOf, setSickAsOf] = useState(today);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const pick = (id: string) => { setWho(id); const o = ot.get(id), s = sick.get(id); setYtd(o ? String(o.ytd) : ''); setMtd(o ? String(o.mtd) : ''); setVerified(true); setSdays(s ? String(s.days) : ''); setErr(null); };
  async function save() {
    if (!who) return;
    setBusy(true); setErr(null);
    try {
      if (ytd !== '' || mtd !== '') await saveOtEntry({ employeeId: who, asOf, ytd: Number(ytd || 0), mtd: Number(mtd || 0), verified });
      if (sdays !== '') await saveSickCheck({ employeeId: who, asOf: sickAsOf, days: Number(sdays) });
      onDone(`${dir.get(who)?.display_name ?? 'Member'}: figures saved.`);
    } catch (e) { setErr(e); setBusy(false); }
  }
  const sickOf = (id: string) => sickState(sick.get(id) ?? null, today, false);
  return (
    <BottomSheet open onClose={onClose} title="Oracle & HR figures">
      <div className="space-y-3">
        <p className="text-xs text-slate-600">Type each person&apos;s overtime from the Oracle overtime report and the sick-leave days of the last 12 months from HR. A missing figure is <b>unknown</b>, never zero: picking is allowed, approval waits until everything is entered and verified. Only counts are kept, never a diagnosis.</p>
        <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
          {ids.map((id) => { const o = ot.get(id); const s = sickOf(id); return (
            <li key={id}><button type="button" onClick={() => pick(id)} className={cx('flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs', who === id && 'bg-brand-50')}>
              <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{dir.get(id)?.display_name ?? '—'}</span>
              <span className={cx('shrink-0', o ? (o.verified ? 'text-green-800' : 'text-sky-800') : 'text-sky-800')}>{o ? `OT ${o.ytd} h yr · ${o.mtd} h mo${o.verified ? ' ✓' : ' (not verified)'}` : 'OT missing'}</span>
              <span className={cx('shrink-0 rounded-full px-1.5 font-semibold', s.state === 'ok' ? 'bg-green-100 text-green-900' : s.state === 'warn' ? 'bg-amber-100 text-amber-900' : s.state === 'excluded' ? 'bg-red-100 text-red-900' : 'bg-sky-100 text-sky-900')}>{s.days != null ? `${s.days} d` : '?'} · {SICK_LABEL[s.state]}</span>
            </button></li>
          ); })}
        </ul>
        {who && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
            <p className="text-sm font-semibold text-slate-900">{dir.get(who)?.display_name}</p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="OT as of"><input type="date" className="input" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} /></Field>
              <Field label="Year to date (h)"><input inputMode="decimal" className="input" value={ytd} onChange={(e) => setYtd(e.target.value)} /></Field>
              <Field label="Month to date (h)"><input inputMode="decimal" className="input" value={mtd} onChange={(e) => setMtd(e.target.value)} /></Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />Checked against the Oracle overtime report</label>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Sick-leave days, last 12 months"><input inputMode="numeric" className="input" value={sdays} onChange={(e) => setSdays(e.target.value)} /></Field>
              <Field label="Sick figure as of"><input type="date" className="input" value={sickAsOf} max={today} onChange={(e) => setSickAsOf(e.target.value)} /></Field>
            </div>
            {err != null && <ErrorBox error={err} />}
            <Button className="w-full" disabled={busy} onClick={save}><Check className="h-4 w-4" />{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

export const EXC_LABEL: Record<ExceptionKind, string> = { consecutive_shutdown: 'Two shutdowns in a row', sick_leave: 'Sick leave over 35 days', rest_day_pair: 'Both rest days of a pair' };
/** The Section Head's exceptions for one member: grant with a reason, or withdraw. */
export function ExceptionsBox({ planId, employeeId, isHead, list, isController, onDone }: { planId: string; employeeId: string; isHead: boolean; list: (SdException & { id: string })[]; isController: boolean; onDone: (m: string) => void }) {
  const [kind, setKind] = useState<ExceptionKind | null>(null); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const mine = list.filter((x) => x.employeeId === employeeId);
  const kinds: ExceptionKind[] = [...(isController ? ['consecutive_shutdown' as const] : []), 'sick_leave', 'rest_day_pair'];
  async function grant() { if (!kind) return; setBusy(true); setErr(null); try { await grantException({ planId, employeeId, kind, reason }); onDone(`Exception approved: ${EXC_LABEL[kind]}.`); } catch (e) { setErr(e); setBusy(false); } }
  async function revoke(id: string) { setBusy(true); setErr(null); try { await revokeException(id, 'Withdrawn'); onDone('Exception withdrawn.'); } catch (e) { setErr(e); setBusy(false); } }
  if (!isHead && !mine.length) return null;
  return (
    <div className="rounded-xl bg-slate-50 p-2.5 text-xs ring-1 ring-slate-200">
      <p className="font-semibold text-slate-800">Section Head exceptions</p>
      {mine.map((x) => <p key={x.id} className="mt-1 flex items-center justify-between gap-2"><span><b>{EXC_LABEL[x.kind]}</b> · {x.reason}</span>{isHead && <button type="button" disabled={busy} onClick={() => revoke(x.id)} className="shrink-0 font-semibold text-status-red">Withdraw</button>}</p>)}
      {isHead && <>
        <div className="mt-1.5 flex flex-wrap gap-1">{kinds.filter((k) => !mine.some((x) => x.kind === k)).map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={cx('rounded-full px-2 py-0.5 ring-1', kind === k ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white ring-slate-300')}>{EXC_LABEL[k]}</button>)}</div>
        {kind && <div className="mt-1.5 flex gap-1.5"><input className="input h-9 flex-1 text-xs" placeholder="Reason (kept in the history)" value={reason} onChange={(e) => setReason(e.target.value)} /><Button className="min-h-9 px-3 text-xs" disabled={busy || !reason.trim()} onClick={grant}>Approve</Button></div>}
      </>}
      {err != null && <div className="mt-1"><ErrorBox error={err} /></div>}
    </div>
  );
}

/** A small badge with a candidate's eligibility. */
export function EligibilityBadge({ e }: { e: Eligibility }) {
  if (e.level === 'ok') return null;
  const tone = e.level === 'blocked' ? 'bg-status-red text-white' : e.level === 'needs_exception' ? 'bg-red-100 text-red-900' : e.level === 'verify' ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-amber-900';
  const label = e.level === 'blocked' ? 'Not eligible' : e.level === 'needs_exception' ? 'Needs exception' : e.level === 'verify' ? 'Verify' : 'Warning';
  return <span title={e.reasons.join(' ')} className={cx('shrink-0 rounded-full px-1.5 text-[10px] font-semibold', tone)}>{label}</span>;
}
