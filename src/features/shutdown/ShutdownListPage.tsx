import { ChevronRight, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SdKind, SdPlan } from '@/core/shutdown';
import { fetchCalendarInfo } from '@/data/calendar';
import { createSdPlan, fetchSdPlans } from '@/data/shutdown';
import { BottomSheet, Button, Card, ErrorBox, Field, PageHeader, Spinner, cx } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';

/** Shutdown teams: one plan per shutdown; open it to fill the Morning and Night teams. */
export default function ShutdownListPage() {
  const [plans, setPlans] = useState<SdPlan[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { fetchSdPlans().then(setPlans).catch(setError); }, []);
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
      {error ? <ErrorBox error={error} /> : !plans ? <Spinner /> : plans.length === 0 ? <Card><p className="text-sm text-slate-500">No shutdown plan yet.</p></Card> : (
        <Card className="divide-y divide-slate-100 p-0">
          {plans.map((p) => (
            <Link key={p.id} to={`/shutdown/${p.id}`} className="flex items-center gap-3 px-3 py-3">
              <span className="min-w-0 flex-1"><span className="block font-medium text-slate-900">{p.title}</span>
                <span className="block text-xs text-slate-500">{p.kind === 'total' ? 'Total turnaround · ' : ''}{shortDate(p.start)} – {shortDate(p.end)} {p.end.slice(0, 4)} · {p.daysOff ? `${p.daysOn} on / ${p.daysOff} off` : 'every day'} · {p.shiftHours} h</span></span>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </Link>
          ))}
        </Card>
      )}
      {adding && <NewPlanSheet onClose={() => setAdding(false)} />}
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
