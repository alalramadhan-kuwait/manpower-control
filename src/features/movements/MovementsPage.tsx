import { ArrowRight, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchDirectory } from '@/data/queries';
import { fetchMovements, type CrewMovement } from '@/data/movements';
import type { EmployeeDirectoryRow } from '@/data/types';
import { Button, Card, ErrorBox, PageHeader, Spinner } from '@/ui/components';
import { CrewBadge, MoveTargetBadge, isCrew } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';
import { MovementSheet, type MovePerson, type MoveTarget } from './MovementSheet';

const range = (m: CrewMovement) => `${shortDate(m.start_date)}${m.kind === 'permanent' ? ' onward' : ` – ${m.end_date ? shortDate(m.end_date) : 'until further notice'}`}`;

/** Shift movements (Stage G): temporary covers with another crew and permanent crew moves, by date. */
export default function MovementsPage() {
  const today = localToday();
  const [data, setData] = useState<{ moves: CrewMovement[]; dir: EmployeeDirectoryRow[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sheet, setSheet] = useState<MoveTarget | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const load = useCallback(() => { Promise.all([fetchMovements(), fetchDirectory()]).then(([moves, dir]) => setData({ moves, dir })).catch(setError); }, []);
  useEffect(load, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const people: MovePerson[] = data.dir.filter((p) => p.is_active && p.in_unit12_scope).map((p) => ({ id: p.id, name: p.display_name, crew: isCrew(p.crew_code) ? p.crew_code : null })).sort((a, b) => a.name.localeCompare(b.name));
    const name = (id: string) => data.dir.find((p) => p.id === id)?.display_name ?? 'Employee';
    const active = data.moves.filter((m) => m.status === 'active');
    const live = active.filter((m) => m.kind === 'temporary' && (!m.end_date || m.end_date >= today));
    const current = live.filter((m) => m.to_crew !== 'DAY' && m.start_date <= today);
    const upcoming = live.filter((m) => m.to_crew !== 'DAY' && m.start_date > today).sort((a, b) => a.start_date.localeCompare(b.start_date));
    const dayDuty = live.filter((m) => m.to_crew === 'DAY').sort((a, b) => a.start_date.localeCompare(b.start_date));
    const permanent = active.filter((m) => m.kind === 'permanent');
    const past = data.moves.filter((m) => m.status === 'cancelled' || (m.kind === 'temporary' && m.end_date && m.end_date < today));
    return { people, name, current, upcoming, dayDuty, permanent, past };
  }, [data, today]);

  const done = (m: string) => { setSheet(null); setFlash(m); load(); };
  const Row = ({ m, actions }: { m: CrewMovement; actions?: boolean }) => (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex shrink-0 items-center gap-1">{m.from_crew && <CrewBadge crew={m.from_crew} size="sm" />}<ArrowRight className="h-3.5 w-3.5 text-slate-400" /><MoveTargetBadge to={m.to_crew} size="sm" /></span>
      <span className="min-w-0 flex-1">
        <Link to={`/employees/${m.employee_id}`} className="block truncate text-sm font-medium text-slate-800">{view!.name(m.employee_id)}</Link>
        <span className="block truncate text-xs text-slate-500">{m.kind === 'permanent' ? 'Permanent move' : m.to_crew === 'DAY' ? `Day duty${m.start_date > today ? ' (upcoming)' : ''}` : 'Temporary cover'} · {range(m)}{m.status === 'cancelled' ? ' · cancelled' : ''}</span>
        {m.reason && <span className="block truncate text-xs text-slate-400">{m.reason}</span>}
      </span>
      {actions && m.kind === 'temporary' && m.status === 'active' && (
        <span className="flex shrink-0 flex-col items-end gap-1 text-xs font-medium">
          <button type="button" className="text-brand-700" onClick={() => setSheet({ kind: 'end', movement: m })}>End</button>
          <button type="button" className="text-status-red" onClick={() => setSheet({ kind: 'cancel', movement: m })}>Cancel</button>
        </span>
      )}
    </li>
  );

  return (
    <div>
      <PageHeader title="Shift movements" info={<><p>Temporary covers with another crew, permanent crew moves and day duty. Manpower counts each person in their crew on each date.</p><p>A permanent move is undone or corrected on the employee profile (Correct role / crew). Workbook notes such as "Covering D-shift" are listed in the import preview so they can be recorded here.</p></>}
        action={<Button className="min-h-10 shrink-0 px-3" onClick={() => setSheet({ kind: 'new' })}><Plus className="h-4 w-4" /> New</Button>} />
      {flash && <div role="status" className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">{flash}</div>}
      {error ? <ErrorBox error={error} /> : !view ? <Spinner /> : (
        <div className="space-y-3">
          <Section title={`Covering now (${view.current.length})`} empty="None today">{view.current.map((m) => <Row key={m.id} m={m} actions />)}</Section>
          {view.upcoming.length > 0 && <Section title={`Upcoming (${view.upcoming.length})`}>{view.upcoming.map((m) => <Row key={m.id} m={m} actions />)}</Section>}
          <Section title={`Day duty (${view.dayDuty.length})`} empty="None">{view.dayDuty.map((m) => <Row key={m.id} m={m} actions />)}</Section>
          <Section title={`Permanent moves (${view.permanent.length})`} empty="None">{view.permanent.map((m) => <Row key={m.id} m={m} />)}</Section>
          {view.past.length > 0 && (
            <Card className="p-0">
              <button type="button" onClick={() => setHistory(!history)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">History ({view.past.length})</span>{history ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
              </button>
              {history && <ul className="divide-y divide-slate-100 px-4 pb-2">{view.past.map((m) => <Row key={m.id} m={m} />)}</ul>}
            </Card>
          )}
        </div>
      )}
      {sheet && view && <MovementSheet target={sheet} people={view.people} onClose={() => setSheet(null)} onDone={done} />}
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty?: string; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <Card className="py-2">
      <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {has ? <ul className="divide-y divide-slate-100">{children}</ul> : <p className="py-2 text-sm text-slate-500">{empty}</p>}
    </Card>
  );
}
