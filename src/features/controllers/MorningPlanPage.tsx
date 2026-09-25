import { ChevronRight, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MONTH_NAMES, daysInMonth } from '@/core/calendar';
import { morningPlan, morningTurns, proposeRotations, type MorningSegment, type ProposedRotation } from '@/core/controllers/morning';
import { isDayDutyWorkday } from '@/core/manpower';
import { fetchAssignments, toMpAssignment } from '@/data/controllers';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import { Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { CrewBadge } from '@/ui/crew';
import { localToday, shortDate } from '@/ui/leave';

/** One colour per person who may hold the post (not red / amber: those mean empty / on leave). */
const HOLDER = ['bg-sky-500', 'bg-teal-600', 'bg-indigo-500', 'bg-fuchsia-500', 'bg-lime-500', 'bg-stone-600', 'bg-violet-700', 'bg-cyan-400'];
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}${a.slice(0, 4) !== b.slice(0, 4) ? ` ${b.slice(0, 4)}` : ''}`);
const pad = (n: number) => String(n).padStart(2, '0');

/** Morning Controller post from today to the end of next year: who holds it, where it is empty, and whose turn is next. */
export default function MorningPlanPage() {
  const today = localToday();
  const year = Number(today.slice(0, 4));
  const to = `${year + 1}-12-31`;
  const [inputs, setInputs] = useState<ManpowerInputs | null>(null);
  const [rotations, setRotations] = useState<ReturnType<typeof toMpAssignment>[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    Promise.all([fetchManpowerInputs(today, to), fetchAssignments()])
      .then(([i, all]) => { setInputs(i); setRotations(all.filter((a) => a.status === 'active' && a.kind === 'morning_rotation').map(toMpAssignment)); })
      .catch(setError);
  }, [today, to]);

  const view = useMemo(() => {
    if (!inputs) return null;
    const segments = morningPlan(today, to, inputs.people, inputs.absences, inputs.assignments);
    const turns = morningTurns(inputs.people, rotations, [year, year + 1]);
    const colour = new Map(turns.map((t, i) => [t.person.id, HOLDER[i % HOLDER.length]]));
    const people = new Map(inputs.people.map((p) => [p.id, p]));
    const onLeave = (id: string, d: string) => inputs.absences.some((a) => a.employeeId === id && (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && a.start <= d && d <= a.end);
    const day = new Map<string, { holder: string | null; leave: boolean }>();
    for (const s of segments) for (let d = s.start; d <= s.end; d = addDay(d)) day.set(d, { holder: s.employeeId, leave: !!s.employeeId && onLeave(s.employeeId, d) });
    const totals = segments.reduce((t, s) => (s.kind === 'gap' ? { ...t, empty: t.empty + s.workdays } : { ...t, held: t.held + s.workdays - s.leaveDays, leave: t.leave + s.leaveDays }), { held: 0, empty: 0, leave: 0 });
    const gaps = segments.filter((s) => s.kind === 'gap');
    const proposals = proposeRotations(gaps, inputs.people, inputs.absences, inputs.assignments, turns);
    const byGap = new Map(gaps.map((g) => [g.start, proposals.filter((r) => r.start >= g.start && r.end <= g.end)]));
    return { segments, turns, colour, people, day, totals, byGap };
  }, [inputs, rotations, today, to, year]);

  const months: [number, number][] = [];
  for (let y = year, m = Number(today.slice(5, 7)); y < year + 2; m === 12 ? (y++, m = 1) : m++) months.push([y, m]);

  return (
    <div>
      <PageHeader title="Morning rotation" info={<div className="space-y-2 text-sm text-slate-700">
        <p>The Morning Controller post, Sunday–Thursday, from today to the end of {year + 1}.</p>
        <p>Each rotation is one Grade 15+ Controller for up to 2 months. A crew Controller on rotation leaves their crew, which then needs a cover.</p>
        <p>Empty days are red. Empty periods are cut into turns of up to 2 months, each with a suggested Controller: free for the whole turn, fewest Morning days that year, so the turns go round. Nothing is saved until you Assign.</p>
      </div>} action={<Link to="/controllers" className="text-xs font-medium text-brand-700">Controllers ›</Link>} />

      {error ? <ErrorBox error={error} /> : !view || !inputs ? <Spinner /> : (
        <>
          <div className="mb-2 grid grid-cols-3 gap-1 text-center">
            {[{ n: view.totals.held, label: 'Days held', dot: 'bg-status-green' }, { n: view.totals.empty, label: 'Days empty', dot: 'bg-status-red' }, { n: view.totals.leave, label: 'Holder on leave', dot: 'bg-amber-400' }].map((k) => (
              <div key={k.label} className="rounded-lg bg-white px-1 py-1 ring-1 ring-slate-200">
                <div className="flex items-center justify-center gap-1 text-base font-semibold leading-tight tabular-nums text-slate-800"><span className={cx('h-2 w-2 rounded-full', k.dot)} />{k.n}</div>
                <div className="text-[10px] leading-tight text-slate-500">{k.label}</div>
              </div>
            ))}
          </div>

          <Card className="p-2">
            <div className="space-y-1">
              {months.map(([y, m]) => (
                <div key={`${y}-${m}`} className="flex items-center gap-1.5">
                  <span className="w-11 shrink-0 text-[10px] font-medium tabular-nums text-slate-500">{MONTH_NAMES[m - 1].slice(0, 3)} {String(y).slice(2)}</span>
                  <div className="grid flex-1 gap-px" style={{ gridTemplateColumns: 'repeat(31, minmax(0, 1fr))' }}>
                    {Array.from({ length: daysInMonth(y, m) }, (_, i) => {
                      const d = `${y}-${pad(m)}-${pad(i + 1)}`;
                      const info = view.day.get(d);
                      const work = isDayDutyWorkday(d);
                      const cls = d < today ? 'bg-slate-100' : !work ? 'bg-slate-50' : !info?.holder ? 'bg-red-300' : info.leave ? 'bg-amber-300' : view.colour.get(info.holder) ?? 'bg-slate-400';
                      return <span key={d} title={`${shortDate(d)}${info?.holder ? ` · ${view.people.get(info.holder)?.name}${info.leave ? ' (on leave)' : ''}` : work && d >= today ? ' · empty' : ''}`}
                        className={cx('h-3.5 rounded-[2px]', cls, d === today && 'ring-2 ring-brand-700')} />;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-slate-500">
              {view.turns.filter((t) => view.segments.some((s) => s.employeeId === t.person.id)).map((t) => (
                <span key={t.person.id} className="flex items-center gap-1"><span className={cx('h-2.5 w-2.5 rounded-sm', view.colour.get(t.person.id))} />{t.person.name}</span>
              ))}
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-300" />empty</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-300" />on leave</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-50 ring-1 ring-slate-200" />Fri / Sat</span>
            </div>
          </Card>

          <Card className="mt-3 py-1.5">
            <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Plan</h2>
            <div className="divide-y divide-slate-100">
              {view.segments.map((s) => <SegmentRow key={s.start} s={s} view={view} />)}
            </div>
          </Card>

          <Card className="mt-3 py-1.5">
            <h2 className="pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Turns · Morning days</h2>
            <table className="mt-1 w-full text-sm">
              <thead><tr className="text-left text-[11px] text-slate-500"><th className="py-1 font-medium">Controller</th><th className="w-12 text-right font-medium">{year}</th><th className="w-12 text-right font-medium">{year + 1}</th><th className="w-20 text-right font-medium">Last</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {view.turns.map((t) => (
                  <tr key={t.person.id}>
                    <td className="py-1.5"><span className="flex items-center gap-1.5"><span className={cx('h-2.5 w-2.5 shrink-0 rounded-sm', view.colour.get(t.person.id))} /><span className="truncate">{t.person.name}</span>{t.person.crew ? <CrewBadge crew={t.person.crew} size="sm" /> : <span className="text-[10px] font-semibold text-slate-400">VR</span>}</span></td>
                    <td className="text-right tabular-nums">{t.byYear[year] || '–'}</td>
                    <td className="text-right tabular-nums">{t.byYear[year + 1] || '–'}</td>
                    <td className="text-right text-xs text-slate-500">{t.lastEnd ? shortDate(t.lastEnd) : 'Never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

const addDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

type View = { colour: Map<string, string>; people: Map<string, { name: string }>; byGap: Map<string, ProposedRotation[]> };
function SegmentRow({ s, view }: { s: MorningSegment; view: View }) {
  if (s.kind === 'gap') return <>{(view.byGap.get(s.start) ?? []).map((r) => <GapRow key={r.start} r={r} view={view} />)}</>;
  return (
    <Link to="/controllers" className="flex items-center gap-2.5 py-2">
      <span className={cx('h-6 w-6 shrink-0 rounded-md', view.colour.get(s.employeeId!) ?? 'bg-slate-400')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{view.people.get(s.employeeId!)?.name ?? 'Unknown'} <span className="font-normal text-slate-500">· {s.workdays} days</span></span>
        <span className="block truncate text-xs text-slate-500">{range(s.start, s.end)}{s.assignmentId ? '' : ' · regular post'}</span>
        <span className="flex flex-wrap gap-1">
          {s.leaveDays > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-900">On leave {s.leaveDays}d</span>}
          {s.crewDuties && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-700">{s.crewDuties.crew} Shift needs cover · {s.crewDuties.duties} duties</span>}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
    </Link>
  );
}

/** An empty turn (at most 2 months) with the proposed Controller; Assign opens the rotation sheet with both filled in. */
function GapRow({ r, view }: { r: ProposedRotation; view: View }) {
  const sug = r.suggestion;
  return (
    <div className="flex items-center gap-2.5 py-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-red-100 text-status-red"><Sun className="h-3.5 w-3.5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-status-red">Empty · {r.workdays} days</span>
        <span className="block text-xs text-slate-500">{range(r.start, r.end)}</span>
        {sug ? <span className="flex items-center gap-1 text-xs font-medium text-slate-800"><span className={cx('h-2.5 w-2.5 shrink-0 rounded-sm', view.colour.get(sug.employeeId))} /><span className="truncate">Suggest {view.people.get(sug.employeeId)?.name}</span></span>
          : <span className="block text-xs text-status-amber">No one free for the whole period</span>}
        {sug?.warnings.map((w) => <span key={w} className="block truncate text-[11px] text-status-amber">{w}</span>)}
      </span>
      <Link to={`/controllers?assign=morning&from=${r.start}&to=${r.end}${sug ? `&who=${sug.employeeId}` : ''}`} className="shrink-0 rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-medium text-white">Assign</Link>
    </div>
  );
}
