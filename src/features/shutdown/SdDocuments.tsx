// The two shutdown documents, laid out like the section's own sheets and printed landscape A4 (or saved as PDF):
// the shift schedule shared with the team (M / N / O per day) and the overtime sheet for the manager's approval.
import { ArrowLeft, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { personOn } from '@/core/manpower';
import { addDaysIso, type Crew } from '@/core/roster';
import { dayOvertime, memberWorks, planDates, type SdMember, type SdPlan, type SdTeam } from '@/core/shutdown';
import { fetchManpowerInputs } from '@/data/manpower';
import { fetchDirectory } from '@/data/queries';
import { fetchSdPlan, updateSdPlan, type Signature } from '@/data/shutdown';
import type { EmployeeDirectoryRow } from '@/data/types';
import { BottomSheet, Button, ErrorBox, Field, Spinner, cx } from '@/ui/components';

const SLOT_ORDER = { controller: 0, senior: 1, good: 2, new: 3, member: 4 } as const;
const MONTH = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
const hrs = (label: string | null) => label?.replace(/(\d\d:\d\d)/g, '$1 HRS').replace(/\s*-\s*/, ' TO ') ?? '';

interface Row { m: SdMember; team: SdTeam; r: EmployeeDirectoryRow | undefined; crew: Crew | null }
interface Doc { plan: SdPlan; teams: SdTeam[]; rows: Row[]; signatures: Signature[]; dates: string[]; months: string[]; name: string }

function useDoc(id: string) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      const sd = await fetchSdPlan(id);
      const [inputs, dir] = await Promise.all([fetchManpowerInputs(addDaysIso(sd.plan.start, -1), addDaysIso(sd.plan.end, 1)), fetchDirectory()]);
      const people = new Map(inputs.people.map((p) => [p.id, p]));
      const byId = new Map(dir.map((r) => [r.id, r]));
      // the person's own crew, the shutdown aside: overtime counts against that crew's duty days
      const crewOf = (emp: string) => { const p = people.get(emp); return p ? personOn({ ...p, moves: p.moves?.filter((x) => x.kind !== 'sd') }, sd.plan.start).crew : null; };
      const teamSort = new Map(sd.teams.map((t) => [t.id, t.sort]));
      const rows = sd.members.map((m) => ({ m, team: sd.teams.find((t) => t.id === m.teamId)!, r: byId.get(m.employeeId), crew: crewOf(m.employeeId) }))
        .filter((x) => x.team)
        .sort((a, b) => teamSort.get(a.m.teamId)! - teamSort.get(b.m.teamId)! || SLOT_ORDER[a.m.slot] - SLOT_ORDER[b.m.slot] || (a.r?.display_name ?? '').localeCompare(b.r?.display_name ?? ''));
      const dates = planDates(sd.plan);
      const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
      const period = months.length > 1 ? `${MONTH(months[0])} - ${MONTH(months[months.length - 1])}` : MONTH(months[0]);
      const name = `${sd.plan.title.toUpperCase().replace(/\s*SD$/, '')} ${period}`;
      setDoc({ plan: sd.plan, teams: sd.teams, rows, signatures: sd.signatures, dates, months, name });
    } catch (e) { setError(e); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  return { doc, error, reload: load };
}

/** An off day between the member's first and last shutdown day (yellow); before or after it, just not on the shutdown. */
function offInside(p: SdPlan, m: SdMember, dates: string[], d: string) {
  const worked = dates.filter((x) => memberWorks(p, m, x));
  return worked.length > 0 && d > worked[0] && d < worked[worked.length - 1];
}

function Page({ back, title, children, actions }: { back: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="[print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      <style>{'@page { size: A4 landscape; margin: 8mm; }'}</style>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={back} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700"><ArrowLeft className="h-4 w-4" />{title}</Link>
        <div className="flex gap-2">{actions}<Button className="min-h-9 px-3 text-xs" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" />Print / save PDF</Button></div>
      </div>
      <div className="overflow-x-auto rounded-lg bg-white p-3 ring-1 ring-slate-200 print:overflow-visible print:rounded-none print:p-0 print:ring-0">{children}</div>
    </div>
  );
}

const th = 'border border-slate-500 px-1 py-0.5 font-semibold';
const td = 'border border-slate-500 px-1 py-0.5';

/** Shift schedule: everyone of every team, 15 days a block, M / N working, O off (yellow inside the member's run). */
export function SdSchedulePage() {
  const { id } = useParams();
  const { doc, error } = useDoc(id!);
  if (error) return <ErrorBox error={error} />;
  if (!doc) return <Spinner />;
  const { plan, rows, dates } = doc;
  const blocks: string[][] = [];
  for (let i = 0; i < dates.length; i += 15) blocks.push(dates.slice(i, i + 15));
  return (
    <Page back={`/shutdown/${plan.id}`} title={plan.title}>
      <h1 className="mb-2 text-center text-sm font-bold text-slate-900">ARDS UNIT-12 {doc.name} SHUTDOWN MANPOWER SCHEDULE</h1>
      {blocks.map((b, bi) => (
        <table key={bi} className="mb-3 w-full border-collapse text-center text-[10px] text-slate-900 print:break-inside-avoid">
          <thead>
            <tr><th colSpan={3} className={cx(th, 'bg-amber-400')}>EMPLOYEES</th><th colSpan={b.length} className={cx(th, 'bg-sky-100')}>DAYS</th></tr>
            <tr><th className={cx(th, 'w-px')}>S.NO</th><th className={cx(th, 'w-px')}>E NO.</th><th className={cx(th, 'w-px min-w-40 text-left')}>E. NAME</th>
              {b.map((d) => <th key={d} className={cx(th, 'w-8 whitespace-nowrap')}>{Number(d.slice(8))}-{new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((x, i) => (
              <tr key={x.m.id}>
                <td className={td}>{i + 1}</td><td className={td}>{x.r?.employee_number}</td><td className={cx(td, 'whitespace-nowrap text-left')}>{x.r?.display_name}</td>
                {b.map((d) => {
                  const w = memberWorks(plan, x.m, d);
                  return <td key={d} className={cx(td, 'font-semibold', w ? (x.team.shiftCode === 'N' ? 'bg-slate-300' : 'bg-sky-50') : offInside(plan, x.m, dates, d) && 'bg-yellow-300')}>{w ? x.team.shiftCode : 'O'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-700">
        {doc.teams.map((t) => <span key={t.id}><b className={cx('mr-1 inline-block w-5 border border-slate-500 text-center', t.shiftCode === 'N' ? 'bg-slate-300' : 'bg-sky-50')}>{t.shiftCode}</b>{t.name} shift {t.hoursLabel ?? ''}</span>)}
        <span><b className="mr-1 inline-block w-5 border border-slate-500 bg-yellow-300 text-center">O</b>Off</span>
      </div>
    </Page>
  );
}

/** Overtime sheet for approval: per team and month, each day's overtime, the month's total and the shutdown total; signatures. */
export function SdOvertimePage() {
  const { id } = useParams();
  const { doc, error, reload } = useDoc(id!);
  const [editSigs, setEditSigs] = useState(false);
  const ot = useMemo(() => {
    if (!doc) return null;
    const out = new Map<string, Map<string, number>>();
    for (const x of doc.rows) out.set(x.m.id, new Map(doc.dates.map((d) => [d, dayOvertime(doc.plan, x.m, x.crew, d)])));
    return out;
  }, [doc]);
  if (error) return <ErrorBox error={error} />;
  if (!doc || !ot) return <Spinner />;
  const { plan, teams, rows, dates, months } = doc;
  const total = (id: string, month?: string) => [...ot.get(id)!].reduce((n, [d, h]) => n + (!month || d.startsWith(month) ? h : 0), 0);
  return (
    <Page back={`/shutdown/${plan.id}`} title={plan.title} actions={<Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => setEditSigs(true)}><Pencil className="h-3.5 w-3.5" />Signatures</Button>}>
      {months.map((ym, mi) => (
        <section key={ym} className={cx(mi > 0 && 'mt-8 border-t border-dashed border-slate-300 pt-4 print:mt-0 print:border-0 print:pt-0', mi < months.length - 1 && 'print:break-after-page')}>
          <h1 className="mb-2 text-center text-sm font-bold text-slate-900">KNPC-MAB - ARDS UNIT-12 {doc.name} SHUTDOWN MANPOWER OVERTIME</h1>
          {teams.map((t) => {
            const list = rows.filter((x) => x.team.id === t.id);
            const days = dates.filter((d) => d.startsWith(ym));
            if (!list.length) return null;
            return (
              <table key={t.id} className="mb-3 w-full border-collapse text-center text-[10px] text-slate-900 print:break-inside-avoid">
                <thead>
                  <tr><th colSpan={days.length + 5} className={cx(th, 'text-left')}>{t.name.toUpperCase()} GROUP{t.hoursLabel ? ` (${hrs(t.hoursLabel)})` : ''} {MONTH(ym)}</th></tr>
                  <tr className="bg-sky-50"><th className={cx(th, 'w-px')}>Sr.No.</th><th className={cx(th, 'w-px min-w-40')}>NAME</th><th className={cx(th, 'w-px')}>EMP.NO</th>
                    {days.map((d) => <th key={d} className={th}>{Number(d.slice(8))}</th>)}
                    <th className={cx(th, 'w-14')}>Tot {monthName(ym)} OT</th><th className={cx(th, 'w-12')}>Total OT</th></tr>
                </thead>
                <tbody>
                  {list.map((x, i) => (
                    <tr key={x.m.id}>
                      <td className={td}>{i + 1}</td><td className={cx(td, 'whitespace-nowrap text-left')}>{x.r?.display_name}</td><td className={td}>{x.r?.employee_number}</td>
                      {days.map((d) => { const off = !memberWorks(plan, x.m, d) && offInside(plan, x.m, dates, d); return <td key={d} className={cx(td, off && 'bg-yellow-300')}>{ot.get(x.m.id)!.get(d)}</td>; })}
                      <td className={cx(td, 'font-semibold', total(x.m.id, ym) > plan.maxOvertime && 'text-red-700')}>{total(x.m.id, ym)}</td><td className={cx(td, 'font-semibold')}>{total(x.m.id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })}
          <div className="flex flex-wrap items-start justify-between gap-3 text-[10px] text-slate-800">
            <div className="flex gap-2"><b className="underline">Note:-</b><ol className="list-decimal pl-4">{teams.map((t) => <li key={t.id}>{t.name} Shift {t.hoursLabel?.replace(/(\d\d:\d\d)/g, '$1 Hrs') ?? ''}</li>)}</ol></div>
            <div className="flex flex-wrap gap-3">
              {[['0', '', 'No OT'], [String(plan.shiftHours - plan.normalHours), '', `${plan.shiftHours - plan.normalHours} hrs. OT`], ['0', 'bg-yellow-300', 'Off'], [String(plan.shiftHours), '', `${plan.shiftHours} hrs. OT`]].map(([n, bg, label]) => (
                <span key={label} className="flex items-center gap-1"><b className={cx('inline-block w-6 border border-slate-500 text-center', bg)}>{n}</b>{label}</span>
              ))}
            </div>
          </div>
          <div className="mt-14 grid gap-6 text-center text-[11px] text-slate-900" style={{ gridTemplateColumns: `repeat(${Math.max(1, doc.signatures.length)}, minmax(0, 1fr))` }}>
            {doc.signatures.map((s, i) => <div key={i}><div className="mx-auto w-4/5 border-t border-slate-700 pt-1 font-bold">{s.name}</div><div className="font-semibold">{s.title}</div></div>)}
          </div>
        </section>
      ))}
      {editSigs && <SignaturesSheet plan={plan} value={doc.signatures} onClose={() => setEditSigs(false)} onDone={() => { setEditSigs(false); reload(); }} />}
    </Page>
  );
}

function SignaturesSheet({ plan, value, onClose, onDone }: { plan: SdPlan; value: Signature[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState<Signature[]>(value.length ? value : [{ title: '', name: '' }]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const set = (i: number, k: keyof Signature, s: string) => setV((x) => x.map((y, j) => (j === i ? { ...y, [k]: s } : y)));
  async function save() {
    setBusy(true); setErr(null);
    try { await updateSdPlan(plan.id, { signatures: v.filter((s) => s.name.trim() || s.title.trim()).map((s) => ({ name: s.name.trim(), title: s.title.trim() })) }); onDone(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="Signatures · left to right">
      <div className="space-y-3">
        {v.map((s, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="grid flex-1 grid-cols-2 gap-2">
              <Field label="Name"><input className="input" value={s.name} onChange={(e) => set(i, 'name', e.target.value)} /></Field>
              <Field label="Title"><input className="input" value={s.title} onChange={(e) => set(i, 'title', e.target.value)} /></Field>
            </div>
            <button type="button" aria-label="Remove" onClick={() => setV((x) => x.filter((_, j) => j !== i))} className="mb-2 text-slate-400"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setV((x) => [...x, { title: '', name: '' }])} className="flex items-center gap-1 text-sm font-medium text-brand-700"><Plus className="h-4 w-4" />Add signature</button>
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy} onClick={save}>Save</Button>
      </div>
    </BottomSheet>
  );
}
