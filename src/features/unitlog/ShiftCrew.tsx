// Who was on shift, at the top of the log (owner, 28 Nov 2026): the Controller the log names, when the log was
// created, and the log's Manpower section against the planned roster (not in the log, on leave, from another crew).
import { useEffect, useState } from 'react';
import { evaluateRange } from '@/core/manpower';
import { compareStaff, emailDelay, emailState, type StaffCompare, type StaffPerson } from '@/core/logbook/staff';
import type { StoredLog } from '@/core/logbook/view';
import { fetchManpowerInputs } from '@/data/manpower';
import { cx } from '@/ui/components';

const cache = new Map<string, Promise<StaffCompare | null>>();
function load(log: StoredLog): Promise<StaffCompare | null> {
  const k = `${log.date}|${log.shift}|${log.crew}|${(log.manpower ?? []).length}`;
  if (!cache.has(k)) cache.set(k, fetchManpowerInputs(log.date, log.date)
    .then((i) => compareStaff(log, evaluateRange(log.date, log.date, i.people, i.absencesAll, i.rules, i.assignments)[0] ?? null, i.people))
    .catch(() => compareStaff(log, null, [])));
  return cache.get(k)!;
}

const HOW: Record<StaffCompare['controllers'][number]['how'], string> = {
  planned: 'as planned', cover: 'recorded cover', acting: 'Acting Controller', relief: 'relief Controller · no cover recorded', other_crew: 'not planned in this crew', not_in_roster: 'not in the roster',
};

export default function ShiftCrew({ log }: { log: StoredLog }) {
  const [r, setR] = useState<StaffCompare | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => { setR(undefined); setOpen(false); let live = true; load(log).then((x) => { if (live) setR(x); }); return () => { live = false; }; }, [log]);
  const sent = log.emailedAt?.slice(11, 16) ?? null;
  const st = emailState(emailDelay(log));
  const mail = sent ? <span className={cx('font-semibold', st === 'very_late' ? 'text-red-700' : st === 'late' ? 'text-amber-700' : 'text-emerald-700')}>
    {st === 'very_late' ? '●' : st === 'late' ? '▲' : '✓'} e-mailed {sent}</span> : null;
  if (!(log.manpower ?? []).length) return mail ? <p className="px-1 text-[12.5px] text-slate-500">{mail} · this log has no Manpower section</p> : null;
  if (r === undefined) return <div className="h-[74px] animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />;
  if (!r) return null;
  const roster = r.present.length + r.missing.length + r.leave.length + r.inWhileOnLeave.length > 0;
  const chip = 'min-h-9 grid place-items-center rounded-lg px-1.5 text-[12.5px] font-bold whitespace-nowrap';
  return (
    <div className="rounded-2xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
      <div className="flex flex-col gap-0.5">
        {r.controllers.length ? r.controllers.map((c) => (
          <div key={c.empNo} className="flex flex-wrap items-baseline gap-x-1.5 text-[15px]">
            <span className="text-slate-500">Controller</span><b className="text-brand-800">{c.name}</b>
            <span className={cx('text-[12.5px] font-semibold', c.how === 'planned' || c.how === 'cover' ? 'text-slate-500' : 'text-amber-800')}>
              {HOW[c.how]}{c.how === 'other_crew' && c.homeCrew ? ` · ${c.homeCrew} crew` : ''}</span>
          </div>
        )) : <div className="text-[15px] text-amber-800">No Controller named in the log</div>}
        <div className="text-[12.5px] text-slate-500">{r.crew ?? '?'} crew · {(log.manpower ?? []).length} in the log{mail ? <> · {mail}</> : null}</div>
      </div>
      {!r.onRota && roster && <p className="mt-1 text-[12.5px] font-semibold text-amber-800">The roster does not have {r.crew} crew on this shift.</p>}
      {!roster && <p className="mt-1 text-[12.5px] text-slate-500">The planned roster could not be compared.</p>}
      {roster && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1.5 flex w-full flex-wrap items-center gap-1 text-left" aria-expanded={open}>
          <span className={cx(chip, 'bg-emerald-50 text-emerald-800')}>✓ {r.present.length} as planned</span>
          {r.missing.length > 0 && <span className={cx(chip, 'bg-amber-50 text-amber-800')}>? {r.missing.length} not in log</span>}
          {(r.leave.length + r.inWhileOnLeave.length) > 0 && <span className={cx(chip, 'bg-slate-100 text-slate-700')}>{r.leave.length + r.inWhileOnLeave.length} leave</span>}
          {r.extra.length > 0 && <span className={cx(chip, 'bg-sky-50 text-sky-800')}>+{r.extra.length} extra</span>}
          <span className="ml-auto text-[14px] font-bold text-brand-800">{open ? '▴' : '▾'}</span>
        </button>
      )}
      {open && (
        <div className="mt-1 space-y-2 border-t border-slate-100 pt-2 text-[14px]">
          <Group title="Planned, not in the log" hint="sick, absent or left out of the log — check" people={r.missing} tone="text-amber-800" />
          <Group title="On leave (planned)" people={r.leave} tone="text-slate-700" note={(p) => p.type} />
          <Group title="In the log while on leave" people={r.inWhileOnLeave} tone="text-amber-800" note={(p) => p.type} />
          <Group title="Extra (not planned in this crew)" hint="overtime or cover" people={r.extra} tone="text-sky-800"
            note={(p) => (p.inRoster ? (p.homeCrew ? `${p.homeCrew} crew` : 'day staff') : 'not in the roster')} />
          <Group title="As planned" people={r.present} tone="text-slate-700" />
        </div>
      )}
    </div>
  );
}

function Group<T extends StaffPerson>({ title, hint, people, tone, note }: { title: string; hint?: string; people: T[]; tone: string; note?: (p: T) => string }) {
  if (!people.length) return null;
  return (
    <div>
      <div className={cx('text-[12px] font-extrabold uppercase tracking-wide', tone)}>{title} · {people.length}{hint ? <span className="font-semibold normal-case tracking-normal text-slate-500"> · {hint}</span> : null}</div>
      {people.map((p) => (
        <div key={p.empNo} className="flex gap-2 py-0.5">
          <span className="flex-1">{p.name}</span>
          <span className="shrink-0 text-[12.5px] text-slate-500">{[p.role, p.area, note?.(p)].filter((x) => x && x !== '—').join(' · ')}</span>
        </div>
      ))}
    </div>
  );
}
