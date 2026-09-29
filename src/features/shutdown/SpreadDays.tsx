import { Minus, Plus, Shuffle } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Crew } from '@/core/roster';
import { defaultMaxRun, spreadPlan } from '@/core/shutdown/spread';
import { slotLabel, type SdMember, type SdPhase, type SdPlan, type SdTeam } from '@/core/shutdown';
import { setSdDaysMany } from '@/data/shutdown';
import { BottomSheet, Button, ErrorBox, cx } from '@/ui/components';

const arrow = (a: number, b: number, unit = '') => (a === b ? <span className="text-slate-700">{b}{unit}</span> : <span className={b < a ? 'font-semibold text-status-green' : 'font-semibold text-status-red'}>{a}{unit} → {b}{unit}</span>);

/** Spread the days off: stagger them inside each place of each team so it keeps its people every day with the least overtime. */
export function SpreadDaysSheet({ plan, teams, members, phases, crewOf, away, onClose, onDone }: {
  plan: SdPlan; teams: SdTeam[]; members: SdMember[]; phases: SdPhase[];
  crewOf: (employeeId: string) => Crew | null; away: (employeeId: string, date: string) => boolean;
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [maxRun, setMaxRun] = useState(defaultMaxRun(plan));
  const results = useMemo(() => spreadPlan(plan, teams, members, phases, { crewOf, away, maxRun }), [plan, teams, members, phases, crewOf, away, maxRun]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const id = (r: (typeof results)[number]) => `${r.group.teamId}:${r.group.key}`;
  const worse = (r: (typeof results)[number]) => r.after.short > r.before.short;
  const chosen = results.filter((r) => r.group.memberIds.length > 0 && !off.has(id(r)) && !worse(r));
  const people = new Set(chosen.flatMap((r) => r.group.memberIds)).size;
  const sum = (f: (r: (typeof results)[number]) => number) => chosen.reduce((n, r) => n + f(r), 0);
  const teamName = (tid: string) => teams.find((t) => t.id === tid)?.name ?? '';
  async function apply() {
    setBusy(true); setErr(null);
    try {
      const rows = chosen.flatMap((r) => [...r.days].flatMap(([memberId, days]) => Object.entries(days).map(([date, works]) => ({ memberId, date, works }))));
      await setSdDaysMany(rows);
      onDone(`Days off spread for ${people} ${people === 1 ? 'person' : 'people'}: overtime ${sum((r) => r.before.overtime)} h → ${sum((r) => r.after.overtime)} h.`);
    } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="Spread the days off">
      <div className="space-y-3">
        <p className="text-xs text-slate-600">Staggers the days off inside each place of each team so it has the people it needs every day, with as many days off and as little overtime as the people allow. A day off is given on a rest day of the person's own crew where it can.</p>
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
          <span className="text-sm font-medium text-slate-700">Most days in a row</span>
          <span className="flex items-center gap-2">
            <button type="button" aria-label="Fewer days in a row" disabled={maxRun <= 1} onClick={() => setMaxRun((x) => x - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white ring-1 ring-slate-300 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
            <span className="w-6 text-center text-base font-semibold tabular-nums">{maxRun}</span>
            <button type="button" aria-label="More days in a row" disabled={maxRun >= 14} onClick={() => setMaxRun((x) => x + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white ring-1 ring-slate-300 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
          </span>
        </div>
        {results.length === 0 && <p className="text-sm text-slate-500">Nobody is placed yet.</p>}
        <ul className="divide-y divide-slate-100">
          {results.map((r) => {
            const n = r.group.memberIds.length; const skip = off.has(id(r)) || worse(r) || n === 0;
            if (n === 0) return <li key={id(r)} className="py-1.5 text-xs text-slate-500">{teamName(r.group.teamId)} · {slotLabel(r.group.key)}: nobody placed yet — <span className="font-medium text-status-red">add {r.minPeople ?? 1}+</span></li>;
            return (
              <li key={id(r)} className={cx('py-2', skip && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{teamName(r.group.teamId)} · {slotLabel(r.group.key)} <span className="text-xs font-normal text-slate-500">· {n} {n === 1 ? 'person' : 'people'}</span></p>
                    <p className="text-xs text-slate-600">Overtime {arrow(r.before.overtime, r.after.overtime, ' h')} · worst month {arrow(r.before.worst, r.after.worst, ' h')}</p>
                    <p className="text-xs text-slate-600">People missing (person-days) {arrow(r.before.short, r.after.short)}{r.after.gapDays ? <span className="font-semibold text-status-red"> · {r.after.gapDays} {r.after.gapDays === 1 ? 'day' : 'days'} with nobody</span> : null}</p>
                    {r.minPeople != null && (n >= r.minPeople
                      ? <p className="text-xs font-medium text-status-red">Some days are still uncovered (leave, or people released early): add at least 1 more.</p>
                      : <p className="text-xs font-medium text-status-red">Add people: at least {r.minPeople} are needed to cover every day with a day off after {maxRun} in a row.</p>)}
                    {worse(r) && <p className="text-xs text-amber-800">Kept as it is: more days would be short than now.</p>}
                  </div>
                  {n > 0 && !worse(r) && <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={!off.has(id(r))} onChange={() => setOff((x) => { const y = new Set(x); if (y.has(id(r))) y.delete(id(r)); else y.add(id(r)); return y; })} />Apply</label>}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-slate-500">Applying replaces the days set by hand for these people. Days a person is on leave are set to off. You can still tap any person to change a day.</p>
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy || chosen.length === 0} onClick={apply}><Shuffle className="h-4 w-4" />Apply to {people} {people === 1 ? 'person' : 'people'}</Button>
      </div>
    </BottomSheet>
  );
}
