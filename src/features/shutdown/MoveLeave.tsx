// Leave inside a shutdown: a team member takes none. Proposes new dates for each such leave (the same number of days, the
// first window after the shutdown where the crew is not short, no clash with other leave) and sends them as reschedule
// requests for the Section Head to approve in Requests › Forms.
import { AlertTriangle, ArrowRight, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LeaveApproval } from '@/core/controllers/leaveRules';
import { personOn } from '@/core/manpower';
import { isRestDay } from '@/core/oracle/expected';
import { addDaysIso } from '@/core/roster';
import type { SdMember, SdPlan } from '@/core/shutdown';
import { createChangeRequest } from '@/data/changeRequests';
import { fetchLeaveApprovals } from '@/data/controllers';
import type { ManpowerInputs } from '@/data/manpower';
import { leaveImpact, mergedLeaves, type MergedLeave } from '@/features/requests/leaveTools';
import { BottomSheet, Button, ErrorBox, Spinner, cx } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';

const SEARCH_DAYS = 60;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);

export interface Proposal { employeeId: string; name: string; leave: MergedLeave; newStart?: string; newEnd?: string; problem?: string; sent?: boolean; error?: string }

/** New dates for every leave of a team member that falls inside their shutdown days. */
export function proposeMoves(plan: SdPlan, members: SdMember[], names: Map<string, string>, inputs: ManpowerInputs, approvals: LeaveApproval[], today: string): Proposal[] {
  const out: Proposal[] = [];
  const done = new Set<string>();
  for (const m of members) {
    const person = inputs.people.find((p) => p.id === m.employeeId);
    if (!person) continue;
    const crewOn = (d: string) => { const q = personOn(person, d); return q.dayDuty ? null : q.crew; };
    const all = mergedLeaves(inputs.absences, m.employeeId);
    for (const l of all) {
      if (l.end < m.start || l.start > m.end) continue;
      const key = `${m.employeeId}:${l.start}`; if (done.has(key)) continue; done.add(key);
      // only leave that takes a duty day of the person inside the shutdown matters
      let duty = false; for (let d = l.start < m.start ? m.start : l.start; d <= (l.end > m.end ? m.end : l.end); d = addDaysIso(d, 1)) if (!isRestDay(d, crewOn(d))) { duty = true; break; }
      if (!duty) continue;
      const base: Proposal = { employeeId: m.employeeId, name: names.get(m.employeeId) ?? 'Employee', leave: l };
      if (l.records.length > 1) { out.push({ ...base, problem: 'Made of several parts: move it by hand' }); continue; }
      const length = days(l.start, l.end);
      const others = all.filter((x) => x !== l);
      let found: { s: string; e: string } | null = null;
      for (let i = 1; i <= SEARCH_DAYS && !found; i++) {
        const s = addDaysIso(plan.end, i);
        let e = addDaysIso(s, length - 1);
        // the plan keeps the rest days after the last duty day (workbook convention)
        for (let k = 0; k < 10 && isRestDay(addDaysIso(e, 1), crewOn(addDaysIso(e, 1))); k++) e = addDaysIso(e, 1);
        if (others.some((x) => x.start <= e && x.end >= s)) continue;
        if (members.some((x) => x.employeeId === m.employeeId && x.start <= e && x.end >= s)) continue;
        const impact = leaveImpact(person, l.records, inputs, approvals, s, e, today);
        if (impact.short === 0 && impact.clash.length === 0) found = { s, e };
      }
      out.push(found ? { ...base, newStart: found.s, newEnd: found.e } : { ...base, problem: `No free window in the ${SEARCH_DAYS} days after the shutdown` });
    }
  }
  return out;
}

export function MoveLeaveSheet({ plan, members, names, inputs, onClose, onDone }: { plan: SdPlan; members: SdMember[]; names: Map<string, string>; inputs: ManpowerInputs; onClose: () => void; onDone: (m: string) => void }) {
  const today = localToday();
  const [list, setList] = useState<Proposal[] | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    fetchLeaveApprovals().then((ap) => new Promise<Proposal[]>((res) => window.setTimeout(() => res(proposeMoves(plan, members, names, inputs, ap, today)), 30)))
      .then((p) => { if (live) setList(p); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [plan, members, names, inputs, today]);
  const ready = (list ?? []).filter((p) => p.newStart && !p.sent);
  async function send() {
    if (!list) return;
    setBusy(true); setErr(null);
    const next = [...list];
    for (let i = 0; i < next.length; i++) {
      const p = next[i]; if (!p.newStart || !p.newEnd || p.sent) continue;
      try {
        const impact = leaveImpact(inputs.people.find((x) => x.id === p.employeeId)!, p.leave.records, inputs, [], p.newStart, p.newEnd, today);
        await createChangeRequest({ records: p.leave.records.map((r) => r.id!), start: p.newStart, end: p.newEnd, remark: `${plan.title}: a shutdown team member takes no leave during the shutdown. New dates proposed right after it.`, impact });
        next[i] = { ...p, sent: true };
      } catch (e) { next[i] = { ...p, error: (e as Error).message }; }
      setList([...next]);
    }
    setBusy(false);
    const n = next.filter((p) => p.sent).length;
    if (next.every((p) => p.sent || !p.newStart)) onDone(`${n} reschedule ${n === 1 ? 'request' : 'requests'} sent. Approve them in Requests › Forms.`);
  }
  return (
    <BottomSheet open onClose={onClose} title="Move the leave">
      <div className="space-y-3">
        <p className="text-xs text-slate-600">For each leave that falls inside the shutdown: the same number of days, starting on the first day after the shutdown where the crew is not short and nothing else clashes. These are sent as reschedule requests; nothing moves until the Section Head approves them in Requests › Forms.</p>
        {!list && !err && <Spinner />}
        {list && list.length === 0 && <p className="text-sm text-slate-500">No leave falls inside the shutdown.</p>}
        <ul className="divide-y divide-slate-100">
          {(list ?? []).map((p) => (
            <li key={`${p.employeeId}:${p.leave.start}`} className="py-2">
              <p className="text-sm font-medium text-slate-900">{p.name}</p>
              <p className="flex flex-wrap items-center gap-1 text-xs text-slate-600">{range(p.leave.start, p.leave.end)} <span className="text-slate-400">({days(p.leave.start, p.leave.end)} d)</span>
                {p.newStart && p.newEnd ? <><ArrowRight className="h-3 w-3" /><b className="text-slate-900">{range(p.newStart, p.newEnd)}</b></> : null}</p>
              {p.problem && <p className="flex items-center gap-1 text-xs font-semibold text-status-red"><AlertTriangle className="h-3 w-3" />{p.problem}</p>}
              {p.sent && <p className="flex items-center gap-1 text-xs font-medium text-status-green"><Check className="h-3 w-3" />Request sent</p>}
              {p.error && <p className={cx('text-xs font-semibold text-status-red')}>{p.error}</p>}
            </li>
          ))}
        </ul>
        {err != null && <ErrorBox error={err} />}
        {list && list.some((p) => p.sent) && <Link to="/requests" className="block text-center text-sm font-semibold text-brand-700 underline">Open the requests</Link>}
        <Button className="w-full" disabled={busy || ready.length === 0} onClick={send}>{busy ? 'Sending…' : `Send ${ready.length} ${ready.length === 1 ? 'request' : 'requests'}`}</Button>
      </div>
    </BottomSheet>
  );
}
