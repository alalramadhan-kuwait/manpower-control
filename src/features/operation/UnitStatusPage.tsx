// Unit status (owner, 28 Oct 2026): what each unit section is doing now, putting the plan right when the unit did
// otherwise (the Calendar shutdown moves to the actual dates), and each section's run record. The crew minimums,
// manual override and modes are rules: they are on the Rules page.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { unitsOn, type UnitSection } from '@/core/modes';
import { addDaysIso, isValidIsoDate } from '@/core/roster';
import { runRecord } from '@/core/shutdown/stages';
import { saveEvent } from '@/data/calendar';
import { fetchOperationPlan } from '@/data/modes';
import { fetchDownEvents, type DownRow } from '@/data/sdPage';
import type { UserProfile } from '@/data/types';
import { BottomSheet, Button, Card, ErrorBox, Field, PageHeader, Spinner, Toast, cx } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';

const dayNo = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 864e5);
const span = (a: string, b: string, today: string) => `${a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`}${b.slice(0, 4) !== today.slice(0, 4) ? ` ${b.slice(0, 4)}` : ''}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function UnitStatusPage({ profile }: { profile: UserProfile }) {
  const head = ['section_head', 'manpower_coordinator'].includes(profile.role_code);
  const today = localToday();
  const [units, setUnits] = useState<UnitSection[] | null>(null);
  const [events, setEvents] = useState<DownRow[]>([]);
  const [err, setErr] = useState<unknown>(null); const [toast, setToast] = useState<string | null>(null);
  const [sheet, setSheet] = useState<UnitSection | null>(null);
  const load = useCallback(() => { Promise.all([fetchOperationPlan(), fetchDownEvents()]).then(([p, e]) => { setUnits(p.plan.units ?? []); setEvents(e); setErr(null); }).catch(setErr); }, []);
  useEffect(load, [load]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 3000); return () => window.clearTimeout(t); }, [toast]);

  const outages = useMemo(() => events.map((e) => ({ id: e.id, units: e.unitCodes, start: e.start, end: e.end, title: e.title })), [events]);
  const status = useMemo(() => (units ? unitsOn(today, { modes: [], periods: [], units, outages }) : []), [units, outages, today]);
  const record = useMemo(() => new Map((units ?? []).map((u) => [u.code, runRecord(events, u.code, today)])), [units, events, today]);
  const yearOn = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const coming = events.filter((e) => e.end >= today && e.start <= yearOn);
  const later = events.filter((e) => e.start > yearOn).length;
  const label = (code: string) => units?.find((u) => u.code === code)?.label ?? code;
  const downList = (e: DownRow) => (units && e.unitCodes.length >= units.length ? 'Unit down (all sections)' : `${e.unitCodes.map(label).join(' + ')} down`);

  return (
    <div>
      <PageHeader title="Unit status" info={<><p>What each unit section is doing today, from the Calendar: a shutdown or outage that names a section takes it down on its dates.</p><p>When the unit does otherwise (down or back early or late), Update puts the plan right: the Calendar shutdown moves to the actual dates and the change is kept with who made it. The run record shows each section's down and running periods.</p><p>The crew minimums, manual override and modes are on the Rules page.</p></>} />
      {err != null ? <ErrorBox error={err} /> : !units ? <Spinner /> : (
        <div className="space-y-3">
          <Card className="py-2">
            <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Today · {shortDate(today)}</h2>
            <ul className="mt-1 divide-y divide-slate-100">
              {status.map(({ unit, down }) => {
                const r = record.get(unit.code)?.[0];
                const sub = down ? `Down ${plural(dayNo(today) - dayNo(down.start) + 1, 'day')} · since ${shortDate(down.start)} · ${down.title} · plan up ${shortDate(addDaysIso(down.end, 1))}`
                  : r?.kind === 'run' ? `Running ${plural(r.days, 'day')} · since ${shortDate(r.start)}` : 'Running · no shutdown recorded';
                return (
                  <li key={unit.code} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0"><span className="block text-sm font-medium text-slate-900">{unit.label}</span><span className="block text-[11px] text-slate-500">{sub}</span></span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', down ? 'bg-status-red text-white' : 'bg-green-100 text-green-800')}>{down ? 'Down' : 'Running'}</span>
                      {head && <button type="button" className="text-xs font-medium text-brand-700" onClick={() => setSheet(unit)}>Update</button>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="py-2">
            <div className="flex items-baseline justify-between gap-2 pt-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Down · next 12 months ({coming.length})</h2>
              <Link to={`/calendar?board=leave&month=${today.slice(0, 7)}`} className="text-xs font-medium text-brand-700">Unit calendar ›</Link>
            </div>
            {coming.length ? (
              <ul className="divide-y divide-slate-100">
                {coming.map((e) => (
                  <li key={e.id}><Link to={`/sd/${e.id}`} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">{downList(e)}{e.start <= today && <span className="rounded bg-brand-700 px-1.5 text-[10px] font-semibold leading-4 text-white">Now</span>}</span>
                      <span className="block text-xs text-slate-600">{span(e.start, e.end, today)} · {e.title}{e.tentative ? ' · tentative' : ''}</span>
                    </span><span className="text-slate-400">›</span></Link></li>
                ))}
              </ul>
            ) : <p className="py-2 text-sm text-slate-500">None. A shutdown or outage on the Calendar that names a section takes it down.</p>}
            {later > 0 && <Link to="/shutdowns?section=plans&view=timeline" className="block pb-1 text-[11px] font-medium text-brand-700">{later} later · five-year plan ›</Link>}
          </Card>

          <Card className="py-2">
            <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Run record</h2>
            {units.map((u) => <RecordRows key={u.code} label={u.label} rows={record.get(u.code) ?? []} today={today} />)}
          </Card>
        </div>
      )}
      {sheet && <UpdateSheet unit={sheet} down={status.find((s) => s.unit.code === sheet.code)?.down ?? null} events={events} label={label} today={today} onClose={() => setSheet(null)} onDone={(m) => { setSheet(null); setToast(m); load(); }} />}
      {toast && <Toast msg={toast} />}
    </div>
  );
}

function RecordRows({ label, rows, today }: { label: string; rows: ReturnType<typeof runRecord>; today: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 3);
  return (
    <div className="border-t border-slate-100 py-1.5 first-of-type:border-0">
      <p className="text-[13px] font-semibold text-slate-800">{label}</p>
      {!rows.length ? <p className="text-[12px] text-slate-500">No shutdown recorded.</p> : (
        <ul>{shown.map((r, i) => {
          const body = <><span className={cx('min-w-0 flex-1', r.kind === 'down' ? 'text-slate-800' : 'text-slate-500')}>{r.kind === 'down' ? `Down ${r.end ? span(r.start, r.end, today) : `since ${shortDate(r.start)}`} · ${r.title}` : r.end ? `Ran ${span(r.start, r.end, today)}` : `Running since ${shortDate(r.start)}`}</span>
            <span className={cx('shrink-0 tabular-nums', r.kind === 'down' ? 'font-semibold text-status-red' : 'text-status-green')}>{r.days} d</span></>;
          return <li key={i}>{r.eventId ? <Link to={`/sd/${r.eventId}`} className="flex gap-2 py-0.5 text-[12px]">{body}<span className="text-slate-400">›</span></Link> : <div className="flex gap-2 py-0.5 pr-3 text-[12px]">{body}</div>}</li>;
        })}</ul>)}
      {rows.length > 3 && <button type="button" onClick={() => setAll(!all)} className="text-[11px] font-medium text-brand-700">{all ? 'Less' : `All ${rows.length}`}</button>}
    </div>
  );
}

/**
 * Put the plan right for one section. Down now: the shutdown's actual first day and its last day down (actual or
 * expected); "Up today" ends it yesterday. Running: it went down, an outage from the day given. The reason is kept on
 * the event and every change in the audit history. A shutdown of several sections moves for all of them (said).
 */
function UpdateSheet({ unit, down, events, label, today, onClose, onDone }: { unit: UnitSection; down: { id: string } | null; events: DownRow[]; label: (c: string) => string; today: string; onClose: () => void; onDone: (m: string) => void }) {
  const ev = down ? events.find((e) => e.id === down.id) ?? null : null;
  const [first, setFirst] = useState(ev?.start ?? today); const [last, setLast] = useState(ev?.end ?? today);
  const [title, setTitle] = useState('Unplanned outage'); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const others = ev ? ev.unitCodes.filter((c) => c !== unit.code).map(label) : [];
  // running now: its last shutdown may have ended on paper only (start-up still going): put that one right instead
  const recent = ev ? null : [...events].reverse().find((e) => e.unitCodes.includes(unit.code) && !e.tentative && e.end < today && e.end >= addDaysIso(today, -30)) ?? null;
  const bad = !isValidIsoDate(first) || !isValidIsoDate(last) || last < first;
  const note = (old: string | null) => [old?.trim(), `${shortDate(today)}: ${reason.trim()}`].filter(Boolean).join(' · ');
  async function save(f: string, l: string, msg: string) {
    setBusy(true); setErr(null);
    try {
      if (ev) await saveEvent({ id: ev.id, category: ev.category as 'shutdown' | 'outage', title: ev.title, unit: ev.unit, unitCodes: ev.unitCodes, start: f, end: l, note: note(ev.note) });
      else await saveEvent({ category: 'outage', title: title.trim() || 'Unplanned outage', unit: unit.label, unitCodes: [unit.code], start: f, end: l, note: reason.trim() });
      onDone(msg);
    } catch (e) { setErr(e); setBusy(false); }
  }
  const yesterday = addDaysIso(today, -1);
  return (
    <BottomSheet open onClose={onClose} title={`${unit.label} · ${ev ? 'down now' : 'running now'}`}>
      <div className="space-y-3">
        {ev ? <p className="text-xs text-slate-500">{ev.title} · plan {shortDate(ev.start)} – {shortDate(ev.end)}{others.length ? ` · also takes down ${others.join(', ')}: the dates move for them too` : ''}</p>
          : <p className="text-xs text-slate-500">It went down: an outage on the Calendar from the day given.</p>}
        {recent && <Link to={`/sd/${recent.id}`} className="block rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-200">Still down after <b>{recent.title}</b> (plan ended {shortDate(recent.end)})? Change its dates there ›</Link>}
        {!ev && <Field label="What"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>}
        <div className="grid grid-cols-2 gap-2">
          <Field label={ev ? 'First day down (actual)' : 'First day down'}><input type="date" className="input" value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
          <Field label="Last day down"><input type="date" className="input" value={last} min={first} onChange={(e) => setLast(e.target.value)} /></Field>
        </div>
        <p className="text-[11px] text-slate-500">Running again from {isValidIsoDate(last) ? shortDate(addDaysIso(last, 1)) : '—'}. A date still to come is the expected one.</p>
        <Field label="Reason (kept with the change)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={ev ? 'e.g. started up early' : 'e.g. compressor trip'} /></Field>
        {last < first && <p className="text-xs text-status-red">The last day is before the first.</p>}
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          {ev && ev.start <= yesterday && <Button variant="secondary" className="flex-1" disabled={busy || !reason.trim()} onClick={() => save(first, yesterday, `${unit.label} running again today.`)}>Up today</Button>}
          <Button className="flex-1" disabled={busy || bad || !reason.trim()} onClick={() => save(first, last, ev ? `${ev.title}: ${shortDate(first)} – ${shortDate(last)} saved.` : `${unit.label} down from ${shortDate(first)}.`)}>Save</Button>
        </div>
      </div>
    </BottomSheet>
  );
}
