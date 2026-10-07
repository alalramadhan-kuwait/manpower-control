// Requests › Approvals: everything that waits for the Section Head, in one list, read from the request history
// (request_headers). Leave request forms and reschedule requests keep their own pages (each has one linked header,
// kept in step by the database); the Coordinator's other changes (unplanned / sick leave added by hand, shift moves,
// VR placements, task releases, Controller covers) are approved or not approved here, with the crews' check first.
import { AlertTriangle, Check, ChevronRight, Search } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DAY_DUTY, evaluateRange, type MpAbsence, type MpAssignment, type MpCrewMove, type MpPerson } from '@/core/manpower';
import { REQUEST_TYPE_LABEL } from '@/core/requests';
import { CREWS, addDaysIso, type Crew } from '@/core/roster';
import { APPROVAL_KIND_LABEL, decideApproval, fetchRequestLog, withdrawApproval, type ApprovalKind, type ApprovalRequest, type ApprovalStatus } from '@/data/approvals';
import { fetchChangeRequests, fetchRequesterNames, type ChangeRequest } from '@/data/changeRequests';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { fetchDirectory } from '@/data/queries';
import { fetchRequests, type LeaveRequest } from '@/data/requests';
import type { EmployeeDirectoryRow } from '@/data/types';
import { BottomSheet, Button, Card, Chip, EmptyState, ErrorBox, Field, Spinner, cx, type Tone } from '@/ui/components';
import { CrewBadge, isCrew } from '@/ui/crew';
import { shortDate } from '@/ui/leave';
import { nameFilter } from '@/ui/nameSearch';
import { CHANGE_LABEL, ChangeRequestSheet } from './ChangeRequests';
import { STATUS_LABEL } from './shared';

type Kind = 'form' | 'change' | ApprovalKind;
const KIND_LABEL: Record<Kind, string> = { form: 'Leave form', change: 'Reschedule', ...APPROVAL_KIND_LABEL };
const KINDS: Kind[] = ['form', 'change', 'leave', 'movement', 'vr_placement', 'task_release', 'controller_cover'];
const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting for the Section Head', tone: 'blue' }, approved: { label: 'Approved', tone: 'green' },
  not_approved: { label: 'Not approved', tone: 'red' }, withdrawn: { label: 'Withdrawn', tone: 'neutral' }
};
const range = (a: string, b: string | null) => (b === null ? `from ${shortDate(a)}` : a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
const when = (iso: string) => { const d = new Date(iso); const p2 = (n: number) => String(n).padStart(2, '0'); return `${shortDate(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`)} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };

interface Item { key: string; kind: Kind; open: boolean; status: string; tone: Tone; employeeId: string; text: string; dates: string; start: string; at: string; by: string | null; note: string | null; form?: LeaveRequest; change?: ChangeRequest; approval?: ApprovalRequest }

export function Approvals({ isHead }: { isHead: boolean }) {
  const [data, setData] = useState<{ items: Item[]; people: Map<string, EmployeeDirectoryRow>; unlinked: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<'open' | 'decided'>('open');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [openItem, setOpenItem] = useState<Item | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = () => Promise.all([fetchRequestLog(), fetchRequests(), fetchChangeRequests(), fetchDirectory()]).then(async ([{ approvals, legacy }, formRows, changeRows, dir]) => {
    const names = await fetchRequesterNames([...new Set([...approvals.flatMap((a) => [a.requested_by, a.decided_by]), ...changeRows.map((c) => c.requested_by)].filter((x): x is string => !!x))]);
    // the list comes from the request headers; a form or reschedule request opens its own page or sheet
    const forms = new Map(formRows.map((r) => [r.id, r])), changes = new Map(changeRows.map((c) => [c.id, c]));
    const linked = new Set(legacy.map((l) => l.legacyId));
    const items: Item[] = [
      ...approvals.map((a): Item => ({ key: `a-${a.id}`, kind: a.kind, open: a.status === 'pending', status: APPROVAL_STATUS[a.status].label, tone: APPROVAL_STATUS[a.status].tone, employeeId: a.employee_id,
        text: a.summary, dates: range(a.start_date, a.end_date), start: a.start_date, at: a.decided_at ?? a.requested_at,
        by: a.status === 'approved' && a.requested_by === a.decided_by ? `${names.get(a.decided_by ?? '') ?? 'Section Head'} (own change)` : names.get(a.requested_by ?? '') ?? null, note: a.decision_note, approval: a })),
      ...legacy.flatMap((l): Item[] => {
        const open = l.status === 'pending', tone: Tone = l.status === 'approved' ? 'green' : l.status === 'not_approved' ? 'red' : open ? 'blue' : 'neutral';
        const r = l.table === 'leave_requests' ? forms.get(l.legacyId) : undefined;
        if (r) return [{ key: `f-${r.id}`, kind: 'form', open, status: STATUS_LABEL[r.status], tone,
          employeeId: r.employee_id, text: `${REQUEST_TYPE_LABEL[r.request_type]} leave${r.overtime_required ? ' · overtime required' : ''}`, dates: range(r.start_date, r.end_date), start: r.start_date,
          at: l.decidedAt ?? l.requestedAt, by: null, note: r.decision_remarks, form: r }];
        const c = l.table === 'leave_change_requests' ? changes.get(l.legacyId) : undefined;
        if (c) return [{ key: `c-${c.id}`, kind: 'change', open, status: CHANGE_LABEL[c.status], tone,
          employeeId: c.employee_id, text: `Leave now ${range(c.old_start, c.old_end)} → asked ${range(c.new_start, c.new_end)}`, dates: range(c.new_start, c.new_end), start: c.new_start,
          at: l.decidedAt ?? l.requestedAt, by: names.get(c.requested_by ?? '') ?? null, note: c.decision_remarks, change: c }];
        return [];
      })
    ];
    // a form or reschedule request without its header would be missing here: say so (never expected)
    const unlinked = formRows.filter((r) => !linked.has(r.id)).length + changeRows.filter((c) => !linked.has(c.id)).length;
    setData({ items, people: new Map(dir.map((p) => [p.id, p])), unlinked });
  }).catch(setError);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of data?.items ?? []) if (i.open === (tab === 'open')) { c.set(i.kind, (c.get(i.kind) ?? 0) + 1); c.set('all', (c.get('all') ?? 0) + 1); }
    return c;
  }, [data, tab]);
  const waiting = data?.items.filter((i) => i.open).length ?? 0;
  const shown = useMemo(() => {
    if (!data) return [];
    const match = nameFilter(query);
    return data.items.filter((i) => i.open === (tab === 'open') && (kind === 'all' || i.kind === kind) && match([data.people.get(i.employeeId)?.display_name, data.people.get(i.employeeId)?.employee_number, data.people.get(i.employeeId)?.arabic_name, i.text]))
      .sort((a, b) => (tab === 'open' ? a.start.localeCompare(b.start) : b.at.localeCompare(a.at)));
  }, [data, tab, kind, query]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const chip = (on: boolean) => cx('flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium ring-1', on ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300');
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {(['open', 'decided'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className={cx('min-h-9 rounded-lg font-medium', tab === t ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>
            {t === 'open' ? <>Waiting{waiting > 0 && <span className="ml-1.5 rounded-full bg-brand-700 px-1.5 text-[11px] font-bold text-white">{waiting}</span>}</> : 'Decided'}
          </button>
        ))}
      </div>
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search name, number or request" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 lg:flex-wrap">
        {(['all', ...KINDS] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cx(chip(kind === k), k !== 'all' && !counts.get(k) && kind !== k && 'opacity-50')}>
            {k === 'all' ? 'All types' : KIND_LABEL[k]}<span className={cx('text-xs tabular-nums', kind === k ? 'text-white/80' : 'text-slate-500')}>{counts.get(k) ?? 0}</span>
          </button>
        ))}
      </div>
      {data.unlinked > 0 && <p role="alert" className="flex items-center gap-1 text-sm text-status-red"><AlertTriangle className="h-4 w-4" />{data.unlinked} leave form or reschedule request{data.unlinked === 1 ? ' is' : 's are'} not in the request history. Report this.</p>}
      {notice && <p role="status" className="flex items-center gap-1 text-sm text-status-green"><Check className="h-4 w-4" />{notice}</p>}
      {shown.length === 0 ? <EmptyState title={tab === 'open' ? 'Nothing is waiting' : 'Nothing decided yet'} body={tab === 'open' ? 'Requests from the Manpower Coordinator, leave forms and reschedule requests appear here until they are decided.' : undefined} /> : (
        <Card className="divide-y divide-slate-100 p-0">
          {shown.map((i) => {
            const p = data.people.get(i.employeeId);
            const body = (
              <>
                {p && isCrew(p.crew_code) ? <CrewBadge crew={p.crew_code} size="sm" /> : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">{p?.position_code === 'vr_controller' ? 'VR' : 'DS'}</span>}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-1.5"><span className="truncate text-sm font-medium text-slate-900">{p?.display_name ?? 'Employee'}</span><span className="text-xs tabular-nums text-slate-500">#{p?.employee_number}</span></span>
                  <span className="block text-sm text-slate-700">{i.text}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">{KIND_LABEL[i.kind]}</span>
                    <span className="text-slate-500">{i.dates}</span>
                    {i.by && <span className="text-slate-500">· by {i.by}</span>}
                    {tab === 'decided' && <Chip tone={i.tone}>{i.status}</Chip>}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </>
            );
            return i.form
              ? <Link key={i.key} to={`/requests/${i.form.id}`} className="flex items-center gap-3 px-3 py-3 active:bg-slate-50">{body}</Link>
              : <button key={i.key} type="button" onClick={() => setOpenItem(i)} className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-slate-50">{body}</button>;
          })}
        </Card>
      )}
      {openItem?.change && <ChangeRequestSheet req={openItem.change} name={data.people.get(openItem.employeeId)?.display_name ?? 'Employee'} isHead={isHead} onClose={() => setOpenItem(null)} onDone={(m) => { setOpenItem(null); setNotice(m); load(); }} />}
      {openItem?.approval && <ApprovalSheet item={openItem} person={data.people.get(openItem.employeeId)} isHead={isHead} onClose={() => setOpenItem(null)} onDone={(m) => { setOpenItem(null); setNotice(m); load(); }} />}
    </div>
  );
}

/** Days each crew is short over the request's dates, without and with the change. */
function crewCheck(inputs: ManpowerInputs, a: ApprovalRequest, from: string, to: string) {
  const p = a.payload as Record<string, string | null>;
  let people: MpPerson[] = inputs.people, absences: MpAbsence[] = inputs.absencesAll, assignments: MpAssignment[] = inputs.assignments;
  const move = (m: MpCrewMove) => { people = people.map((x) => (x.id === a.employee_id ? { ...x, moves: [m, ...(x.moves ?? [])] } : x)); };
  if (a.kind === 'leave' || a.kind === 'task_release') absences = [...absences, { employeeId: a.employee_id, start: a.start_date, end: a.end_date ?? a.start_date, status: 'approved', typeCode: p.type ?? 'task_release', inCurrentPlan: true }];
  else if (a.kind === 'movement') move({ start: a.start_date, end: a.end_date, crew: p.to === 'DAY' ? DAY_DUTY : (p.to as Crew), kind: p.kind === 'permanent' ? undefined : 'temporary' });
  else if (a.kind === 'vr_placement') move({ start: a.start_date, end: a.end_date, crew: p.crew as Crew, kind: 'placement' });
  else if (a.kind === 'controller_cover') assignments = [...assignments, { id: 'new', kind: (p.kind as 'shift_cover' | 'morning_rotation') ?? 'shift_cover', employeeId: a.employee_id, crew: (p.crew_code as Crew) ?? null, start: a.start_date, end: a.end_date ?? a.start_date, coversEmployeeId: p.covers_employee_id }];
  const count = (ppl: MpPerson[], abs: MpAbsence[], asg: MpAssignment[]) => {
    const r = evaluateRange(from, to, ppl, abs, inputs.rules, asg);
    return Object.fromEntries(CREWS.map((c) => [c, r.filter((d) => d.crews.find((x) => x.crew === c)?.confirmedShortage).length])) as Record<Crew, number>;
  };
  const before = count(inputs.people, inputs.absencesAll, inputs.assignments), after = count(people, absences, assignments);
  return { before, after, worse: CREWS.filter((c) => after[c] > before[c]), better: CREWS.filter((c) => after[c] < before[c]) };
}

function ApprovalSheet({ item, person, isHead, onClose, onDone }: { item: Item; person: EmployeeDirectoryRow | undefined; isHead: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const a = item.approval!;
  const p = a.payload as Record<string, string | null>;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const from = a.start_date, to = a.end_date ?? addDaysIso(a.start_date, 27);
  const [check, setCheck] = useState<ReturnType<typeof crewCheck> | null>(null);
  useEffect(() => { if (a.status !== 'pending') return; fetchManpowerInputs(from, to).then((inp) => setCheck(crewCheck(inp, a, from, to))).catch(() => setCheck(null)); }, [a, from, to]);
  const details: [string, string][] = [
    ['Dates', range(a.start_date, a.end_date)],
    ...(p.reason ? [['Reason', p.reason] as [string, string]] : []), ...(p.task ? [['Task', `${p.task}${p.from_time ? ` · ${p.from_time}–${p.to_time}` : ''}`] as [string, string]] : []),
    ...(p.note ? [['Note', p.note] as [string, string]] : []),
    ['Asked', `${when(a.requested_at)}${item.by ? ` · ${item.by}` : ''}`],
    ...(a.decided_at && a.status !== 'pending' ? [[item.status, `${when(a.decided_at)}${a.decision_note ? ` · ${a.decision_note}` : ''}`] as [string, string]] : [])
  ];
  async function run(fn: () => Promise<void>, msg: string) { setBusy(true); setErr(null); try { await fn(); onDone(msg); } catch (e) { setErr(e); setBusy(false); } }
  return (
    <BottomSheet open onClose={onClose} title={KIND_LABEL[item.kind]}>
      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">{person && isCrew(person.crew_code) && <CrewBadge crew={person.crew_code} size="sm" />}{person?.display_name ?? 'Employee'} <span className="font-normal text-slate-500">#{person?.employee_number}</span></div>
          <p className="mt-1 text-sm text-slate-800">{a.summary}</p>
        </div>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-sm">
          {details.map(([k, v]) => <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></Fragment>)}
        </dl>
        {a.status === 'pending' && (!check ? <Spinner label="Checking the crews…" /> : check.worse.length
          ? <p className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-status-red ring-1 ring-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{check.worse.map((c) => `${c} Shift short ${check.after[c] - check.before[c]} more ${check.after[c] - check.before[c] === 1 ? 'day' : 'days'}`).join(' · ')} ({shortDate(from)} – {shortDate(to)}).</p>
          : <p className="flex items-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200"><Check className="h-4 w-4 shrink-0" />No crew falls short because of it{check.better.length ? `; ${check.better.join(', ')} Shift better covered` : ''}.</p>)}
        {a.status === 'pending' && (
          <>
            <Field label={isHead ? 'Remarks (optional)' : 'Reason to withdraw (optional)'}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            {err != null && <ErrorBox error={err} />}
            {isHead ? (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => run(() => decideApproval(a.id, false, note), `Not approved: ${a.summary}`)}>Not approve</Button>
                <Button disabled={busy} onClick={() => run(() => decideApproval(a.id, true, note), `Approved: ${a.summary}`)}>Approve</Button>
              </div>
            ) : <p className="text-xs text-slate-500">Waiting for the Section Head. Nothing changes in the plan until it is approved.</p>}
            <button type="button" disabled={busy} onClick={() => run(() => withdrawApproval(a.id, note), `Withdrawn: ${a.summary}`)} className="text-sm font-medium text-slate-600 underline">Withdraw the request</button>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
