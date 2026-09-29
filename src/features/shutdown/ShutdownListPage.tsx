import { ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SdKind, SdPlan } from '@/core/shutdown';
import { fetchCalendarInfo } from '@/data/calendar';
import { createSdPlan, fetchAllSdMembers, fetchSdPlans, updateSdPlan } from '@/data/shutdown';
import { BottomSheet, Button, Card, ErrorBox, Field, PageHeader, Spinner, cx } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';

/** Shutdown teams: one plan per shutdown; open it to fill the Morning and Night teams. */
export default function ShutdownListPage() {
  const [plans, setPlans] = useState<SdPlan[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SdPlan | null>(null);
  const [people, setPeople] = useState<Map<string, number>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const today = localToday();
  const load = () => {
    Promise.all([fetchSdPlans(), fetchAllSdMembers()]).then(([ps, ms]) => {
      setPlans(ps);
      const n = new Map<string, number>();
      for (const m of ms) n.set(m.planId, (n.get(m.planId) ?? 0) + 1);
      setPeople(n);
    }).catch(setError);
  };
  useEffect(load, []);
  // still to come or running first (soonest first); the finished ones after, the latest first, greyed
  const ahead = (plans ?? []).filter((p) => p.end >= today).sort((a, b) => a.start.localeCompare(b.start));
  const done = (plans ?? []).filter((p) => p.end < today).sort((a, b) => b.end.localeCompare(a.end));
  const row = (p: SdPlan, finished: boolean) => (
    <div key={p.id} className={cx('flex items-center', finished && 'bg-slate-50/60')}>
      <Link to={`/shutdown/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3">
        <span className={cx('min-w-0 flex-1', finished && 'opacity-60')}>
          <span className="flex items-center gap-2"><span className={cx('block truncate font-medium', finished ? 'text-slate-600' : 'text-slate-900')}>{p.title}</span>
            {finished ? <span className="shrink-0 rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600">Done</span>
              : p.start <= today ? <span className="shrink-0 rounded-full bg-green-100 px-1.5 text-[10px] font-semibold text-green-800">Running</span> : null}</span>
          <span className="block text-xs text-slate-500">{p.kind === 'total' ? 'Total turnaround · ' : ''}{shortDate(p.start)} – {shortDate(p.end)} {p.end.slice(0, 4)} · {p.daysOff ? `${p.daysOn} on / ${p.daysOff} off` : 'every day'} · {p.shiftHours} h · {people.get(p.id) ?? 0} people</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      </Link>
      <button type="button" aria-label={`Edit or delete ${p.title}`} onClick={() => setEditing(p)} className="flex h-12 w-12 shrink-0 items-center justify-center text-brand-700"><Pencil className="h-4 w-4" /></button>
    </div>
  );
  return (
    <div>
      <PageHeader title="Shutdown teams" info={<div className="space-y-2 text-sm text-slate-700">
        <p>One plan per shutdown, with a Morning and a Night team. Train shutdown: each team needs its own Controller, Senior, Good and New Field Operators; the crews keep running. Total turnaround: the whole unit is down, each shift has its Controllers and operators per area (e.g. TR-II, L.P &amp; TR-I), the numbers can step down by phase, and the crew minimums don't apply.</p>
        <p>Panel Operators of Grade 13 and below, and contractor Panel Operators, can also be picked for a team.</p>
        <p>Team members leave their crew for the team's dates; the crews must still meet the shutdown's operating-mode minimums. The team's Controller can still cover a normal shift on a day (Controllers › Assign cover).</p>
        <p>Overtime = shutdown hours − the normal duty hours the person would have worked, per month, against the cap.</p>
        <p>Picking members: the right level first; nobody works two shutdowns in a row (flagged); then those free of leave whose crew keeps its minimum; then fewer sick days this year.</p>
      </div>} action={<Button className="min-h-10 shrink-0 px-3" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> New</Button>} />
      <p className="mb-2 text-xs text-slate-500">Field Operator levels: <Link to="/review/fo-levels" className="font-medium text-brand-700">Senior / Good / New ›</Link></p>
      {notice && <p role="status" className="mb-2 text-sm text-status-green">{notice}</p>}
      {error ? <ErrorBox error={error} /> : !plans ? <Spinner /> : plans.length === 0 ? <Card><p className="text-sm text-slate-500">No shutdown plan yet.</p></Card> : (
        <div className="space-y-4">
          {ahead.length > 0 && <Card className="divide-y divide-slate-100 p-0">{ahead.map((p) => row(p, false))}</Card>}
          {done.length > 0 && (
            <section>
              <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Done · for the record ({done.length})</h2>
              <Card className="divide-y divide-slate-100 overflow-hidden p-0">{done.map((p) => row(p, true))}</Card>
            </section>
          )}
        </div>
      )}
      {adding && <NewPlanSheet onClose={() => setAdding(false)} />}
      {editing && <EditPlanSheet plan={editing} people={people.get(editing.id) ?? 0} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); setNotice(m); load(); }} />}
    </div>
  );
}

function NewPlanSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const today = localToday();
  const [events, setEvents] = useState<{ id: string; label: string; start: string; end: string }[]>([]);
  const [eventId, setEventId] = useState('');
  const [kind, setKind] = useState<SdKind>('train');
  const [title, setTitle] = useState(''); const [start, setStart] = useState(today); const [end, setEnd] = useState(today);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    fetchCalendarInfo(today, `${Number(today.slice(0, 4)) + 2}-12-31`).then((i) => setEvents(i.events.filter((e) => e.category === 'shutdown')
      .map((e) => ({ id: e.id, label: `${e.unit ? `${e.unit} ` : ''}${e.title}`, start: e.start, end: e.end })))).catch(setErr);
  }, [today]);
  function pickEvent(id: string) { setEventId(id); const e = events.find((x) => x.id === id); if (e) { setTitle(e.label); setStart(e.start); setEnd(e.end); } }
  async function save() {
    setBusy(true); setErr(null);
    try { const id = await createSdPlan({ title: title.trim(), start, end, eventId: eventId || null, kind }); navigate(`/shutdown/${id}`); } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="New shutdown plan">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1.5">
          {([['train', 'Train shutdown'], ['total', 'Total turnaround']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={cx('rounded-lg px-2 py-2 text-sm font-medium ring-1', kind === k ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{l}</button>
          ))}
        </div>
        <Field label="Shutdown (from the Calendar)">
          <select className="input" value={eventId} onChange={(e) => pickEvent(e.target.value)}>
            <option value="">Not linked</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.label} · {shortDate(e.start)} – {shortDate(e.end)}</option>)}
          </select>
        </Field>
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Train-1 SD" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Last day"><input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-slate-500">{kind === 'total'
          ? 'Starts with a Morning and a Night shift, each 2 Controllers and 5 operators in TR-II and 5 in L.P & TR-I, everyone every day, 12 h, overtime ≤ 80 h. Areas, phases and numbers are all editable.'
          : 'Starts with a Morning and a Night team (Controller 1 · Senior 2 · Good 2 · New 1), 3 on / 1 off, 12 h, first and last 2 days 8 h, overtime ≤ 80 h. All editable.'}</p>
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy || !title.trim() || end < start} onClick={save}>Create</Button>
      </div>
    </BottomSheet>
  );
}

/** Rename or move a shutdown, or delete it (kept in the audit history; its people are back with their crews). */
function EditPlanSheet({ plan, people, onClose, onDone }: { plan: SdPlan; people: number; onClose: () => void; onDone: (m: string) => void }) {
  const [title, setTitle] = useState(plan.title); const [start, setStart] = useState(plan.start); const [end, setEnd] = useState(plan.end);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function run(f: () => Promise<void>, msg: string) { setBusy(true); setErr(null); try { await f(); onDone(msg); } catch (e) { setErr(e); setBusy(false); } }
  const save = () => run(() => updateSdPlan(plan.id, { title: title.trim(), start_date: start, end_date: end }), `${title.trim()} saved.`);
  const remove = () => run(() => updateSdPlan(plan.id, { status: 'cancelled' }), `${plan.title} deleted.`);
  return (
    <BottomSheet open onClose={onClose} title={plan.title}>
      <div className="space-y-3">
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First day"><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Last day"><input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <p className="text-[11px] text-slate-500">The pattern, hours, teams and people are edited inside the shutdown. {people} {people === 1 ? 'person is' : 'people are'} on this one.</p>
        {err != null && <ErrorBox error={err} />}
        {confirm && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
            Delete <b>{plan.title}</b> ({shortDate(plan.start)} – {shortDate(plan.end)})? {people > 0 ? `Its ${people} ${people === 1 ? 'person goes' : 'people go'} back to their crews on those dates. ` : ''}It is kept in the audit history. The Calendar event and any operating mode set for these dates stay as they are.
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>Keep it</Button>
              <Button variant="danger" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4" />Yes, delete</Button>
            </div>
          </div>
        )}
        {!confirm && (
          <div className="flex gap-2">
            <Button variant="danger" className="flex-1" disabled={busy} onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete</Button>
            <Button className="flex-1" disabled={busy || !title.trim() || end < start} onClick={save}>Save</Button>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
