// Who was on shift, at the top of the log (owner, 28 Nov 2026): the Controller the log names, when the log was
// e-mailed, and six tiles (owner chose option B): Panel and Field seats against the minimum, Overtime, Sick / absent,
// PV and As planned, each opening its names. A name opens the person's profile; a person not in the app can be added
// to a crew by the Section Head.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { evaluateRange } from '@/core/manpower';
import { compareStaff, emailDelay, emailState, staffTiles, type StaffCompare, type Tile, type TileKey, type TilePerson } from '@/core/logbook/staff';
import type { StoredLog } from '@/core/logbook/view';
import { fetchManpowerInputs } from '@/data/manpower';
import { addToRoster } from '@/data/unitLog';
import { BottomSheet, ErrorBox, Field, cx } from '@/ui/components';

const cache = new Map<string, Promise<StaffCompare | null>>();
function load(log: StoredLog, fresh = false): Promise<StaffCompare | null> {
  const k = `${log.date}|${log.shift}|${log.crew}|${(log.manpower ?? []).length}`;
  if (fresh) cache.clear();
  if (!cache.has(k)) cache.set(k, fetchManpowerInputs(log.date, log.date)
    .then((i) => compareStaff(log, evaluateRange(log.date, log.date, i.people, i.absencesAll, i.rules, i.assignments)[0] ?? null, i.people))
    .catch(() => compareStaff(log, null, [])));
  return cache.get(k)!;
}

const HOW: Record<StaffCompare['controllers'][number]['how'], string> = {
  planned: 'as planned', cover: 'recorded cover', acting: 'Acting Controller', relief: 'relief Controller · no cover recorded', other_crew: 'not planned in this crew', not_in_roster: 'not in the roster',
};
const TONE: Record<Tile['tone'], string> = { ok: 'text-emerald-700', short: 'text-red-700', info: 'text-sky-800', bad: 'text-red-700', grey: 'text-slate-700' };
const BG: Record<Tile['tone'], string> = { ok: 'bg-white', short: 'bg-red-50', info: 'bg-sky-50', bad: 'bg-red-50', grey: 'bg-slate-50' };
const TAG: Record<TilePerson['tag'], [string, string] | null> = {
  ok: null, ot: ['OT', 'bg-sky-100 text-sky-800'], not_in_roster: ['not in roster', 'bg-amber-100 text-amber-900'], sick: ['SICK', 'bg-red-100 text-red-800'],
  absent: ['?', 'bg-red-100 text-red-800'], leave: ['PV', 'bg-slate-200 text-slate-700'], in_on_leave: ['on leave', 'bg-amber-100 text-amber-900'],
};

export default function ShiftCrew({ log, isHead = false }: { log: StoredLog; isHead?: boolean }) {
  const [r, setR] = useState<StaffCompare | null | undefined>(undefined);
  const [open, setOpen] = useState<TileKey | null>(null);
  const [adding, setAdding] = useState<TilePerson | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { setR(undefined); let live = true; load(log, tick > 0).then((x) => { if (live) setR(x); }); return () => { live = false; }; }, [log, tick]);
  useEffect(() => setOpen(null), [log]);
  const sent = log.emailedAt?.slice(11, 16) ?? null;
  const st = emailState(emailDelay(log));
  const mail = sent ? <span className={cx('font-semibold', st === 'very_late' ? 'text-red-700' : st === 'late' ? 'text-amber-700' : 'text-emerald-700')}>
    {st === 'very_late' ? '●' : st === 'late' ? '▲' : '✓'} e-mailed {sent}</span> : null;
  if (!(log.manpower ?? []).length) return mail ? <p className="px-1 text-[12.5px] text-slate-500">{mail} · this log has no Manpower section</p> : null;
  if (r === undefined) return <div className="h-[200px] animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />;
  if (!r) return null;
  const roster = r.present.length + r.missing.length + r.leave.length + r.inWhileOnLeave.length > 0;
  const tiles = staffTiles(r);
  const shown = tiles.find((t) => t.key === open) ?? null;
  return (
    <div className="space-y-2 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
      <div className="flex flex-col gap-0.5">
        {r.controllers.length ? r.controllers.map((c) => (
          <div key={c.empNo} className="flex flex-wrap items-baseline gap-x-1.5 text-[15px]">
            <span className="text-slate-500">Controller</span>
            {c.id ? <Link to={`/employees/${c.id}`} className="font-bold text-brand-800 underline decoration-slate-300 underline-offset-2">{c.name}</Link> : <b className="text-brand-800">{c.name}</b>}
            <span className={cx('text-[12.5px] font-semibold', c.how === 'planned' || c.how === 'cover' ? 'text-slate-500' : 'text-amber-800')}>
              {HOW[c.how]}{c.how === 'other_crew' && c.homeCrew ? ` · ${c.homeCrew} crew` : ''}</span>
          </div>
        )) : <div className="text-[15px] text-amber-800">No Controller named in the log</div>}
        <div className="text-[12.5px] text-slate-500">{r.crew ?? '?'} crew · {(log.manpower ?? []).length} in the log{mail ? <> · {mail}</> : null}</div>
      </div>
      {!r.onRota && roster && <p className="text-[12.5px] font-semibold text-amber-800">The roster does not have {r.crew} crew on this shift.</p>}
      {!roster && <p className="text-[12.5px] text-slate-500">The planned roster could not be compared.</p>}
      <div className="grid grid-cols-3 gap-1.5">
        {tiles.map((t) => (
          <button key={t.key} type="button" aria-pressed={open === t.key} onClick={() => setOpen(open === t.key ? null : t.key)}
            className={cx('min-h-[60px] rounded-xl border-2 px-2 py-1.5 text-left', BG[t.tone], open === t.key ? 'border-brand-800' : 'border-slate-200')}>
            <div className="text-[12.5px] font-bold text-slate-600">{t.label}</div>
            <div className={cx('text-[20px] font-extrabold leading-tight', TONE[t.tone])}>{t.value}</div>
          </button>
        ))}
      </div>
      {shown && (
        <div className="rounded-xl bg-slate-50 px-2.5 py-1">
          <div className="pt-1 text-[12px] font-extrabold uppercase tracking-wide text-brand-800">{shown.label} · {shown.people.length}
            {shown.key === 'sick' && <span className="font-semibold normal-case tracking-normal text-slate-500"> · ? = planned, not in the log, no leave recorded</span>}</div>
          {shown.people.length ? shown.people.map((p) => <PersonRow key={p.empNo + p.tag} p={p} isHead={isHead} onAdd={() => setAdding(p)} />)
            : <p className="py-2 text-[13.5px] text-slate-500">Nobody.</p>}
        </div>
      )}
      {adding && <AddSheet p={adding} log={log} onClose={() => setAdding(null)} onDone={() => { setAdding(null); setTick((n) => n + 1); }} />}
    </div>
  );
}

function PersonRow({ p, isHead, onAdd }: { p: TilePerson; isHead: boolean; onAdd: () => void }) {
  const tag = TAG[p.tag];
  const sub = [p.role !== '—' ? p.role : null, p.area, p.note].filter(Boolean).join(' · ');
  const body = (
    <>
      <span className="min-w-0 flex-1"><span className="block text-[15px] text-slate-900">{p.name}</span>{sub && <span className="block text-[12px] text-slate-500">{sub}</span>}</span>
      {tag && <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[11.5px] font-extrabold', tag[1])}>{tag[0]}</span>}
    </>
  );
  const cls = 'flex min-h-11 w-full items-center gap-2 border-t border-slate-200/70 py-1 text-left first:border-t-0';
  if (p.id) return <Link to={`/employees/${p.id}`} className={cls}>{body}<span className="font-bold text-brand-800">›</span></Link>;
  if (p.tag === 'not_in_roster' && isHead) return <button type="button" onClick={onAdd} className={cls}>{body}<span className="text-[12.5px] font-bold text-brand-800">Add ›</span></button>;
  return <div className={cls}>{body}</div>;
}

/** Section Head: add a person the log names but the app does not know to a crew (owner, 28 Nov 2026). */
function AddSheet({ p, log, onClose, onDone }: { p: TilePerson; log: StoredLog; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ name: p.name, crew: log.crew ?? 'A', position: (p.role === 'Panel' ? 'panel_operator' : 'field_operator') as 'panel_operator' | 'field_operator', from: log.date });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await addToRoster({ number: p.empNo, name: v.name, crew: v.crew, position: v.position, from: v.from, logPosition: p.position, logNo: log.logNo }); onDone(); } catch (e) { setErr(e); setBusy(false); }
  };
  const pick = 'min-h-11 flex-1 rounded-xl border-[1.5px] text-[14px] font-bold';
  return (
    <BottomSheet open onClose={onClose} title="Add to the roster">
      <div className="space-y-3 pb-2">
        <p className="text-[13.5px] text-slate-600">Employee <b>{p.empNo}</b>{p.position ? <> · in the log as <b>{p.position}</b></> : null}. Not in the app yet.</p>
        <Field label="Name"><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-[15px]" /></Field>
        <Field label="Home crew">
          <div className="flex gap-1.5">{['A', 'B', 'C', 'D'].map((c) => <button key={c} type="button" aria-pressed={v.crew === c} onClick={() => setV({ ...v, crew: c })} className={cx(pick, v.crew === c ? 'border-brand-800 text-brand-800' : 'border-slate-200 text-slate-500')}>{c}</button>)}</div>
        </Field>
        <Field label="Role">
          <div className="flex gap-1.5">{([['panel_operator', 'Panel Operator'], ['field_operator', 'Field Operator']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={v.position === k} onClick={() => setV({ ...v, position: k })} className={cx(pick, v.position === k ? 'border-brand-800 text-brand-800' : 'border-slate-200 text-slate-500')}>{l}</button>)}</div>
        </Field>
        <Field label="In the crew from"><input type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-[15px]" /></Field>
        <p className="text-[12.5px] text-slate-500">Counts in {v.crew} crew's manpower from that date. Grade and qualifications are not set yet: set them on the profile; until then they show as not yet confirmed.</p>
        {err ? <ErrorBox error={err} /> : null}
        <button type="button" disabled={busy || v.name.trim().length < 3 || !v.from} onClick={save} className="min-h-11 w-full rounded-xl bg-brand-800 text-[15px] font-bold text-white disabled:opacity-50">{busy ? 'Adding…' : `Add to ${v.crew} crew`}</button>
      </div>
    </BottomSheet>
  );
}
