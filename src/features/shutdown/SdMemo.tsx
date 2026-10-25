// The instruction memo sent to the operation staff with the shutdown schedule ("Turnaround Manpower Coverage"), laid
// out like the section's memo: the groups and their basis, the controllers left on the crews, each one's day of joining,
// the signature and cc, then the schedule as the attachment (landscape). Everything but the memo's date, signer, cc and
// extra lines is read from the plan, so it follows every change to the plan.
import { ArrowLeft, Pencil, Printer } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { buildMemo, memoLong, type MemoGroup } from '@/core/shutdown/memo';
import { updateSdPlan, type MemoSettings } from '@/data/shutdown';
import { BottomSheet, Button, ErrorBox, Field, Spinner, cx } from '@/ui/components';
import { ScheduleBody, useDoc, type Doc } from './SdDocuments';

const today = () => new Date().toISOString().slice(0, 10);
const dmy = (d: string) => `${d.slice(8)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
export const DEFAULT_CC = ['Refinery Shift Leader', 'Controller-I (Area-4)', 'Operations Area-4 Controller'];

const cell = 'border border-slate-700 px-2 py-0.5';

function GroupTable({ groups }: { groups: MemoGroup[] }) {
  return (
    <table className="mx-auto my-2 w-[92%] border-collapse text-center">
      <thead><tr><th className={cx(cell, 'w-14 font-normal')}>S. No.</th><th className={cx(cell, 'font-normal')}>Name</th><th className={cx(cell, 'w-20 font-normal')}>Emp. No.</th><th className={cx(cell, 'w-20 font-normal')}>Group</th><th className={cx(cell, 'w-44 font-normal')}>Remark</th></tr></thead>
      {groups.map((g, gi) => (
        <tbody key={g.team.id} className={cx(gi % 2 === 1 && 'bg-slate-100', 'border-2 border-slate-800 break-inside-avoid')}>
          {g.people.map((p, i) => (
            <tr key={`${p.number}-${i}`}>
              <td className={cell}>{i + 1}</td>
              <td className={cx(cell, 'text-left')}>{p.name}{p.note && <span className="text-[0.85em] text-slate-600"> ({p.note})</span>}</td>
              <td className={cell}>{p.number}</td>
              {i === 0 && <><td rowSpan={g.people.length} className={cell}>{g.numeral}</td><td rowSpan={g.people.length} className={cell}>{g.remark}</td></>}
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

function Section({ no, title, children }: { no: string; title: string; children: ReactNode }) {
  return <section className="mt-4"><h2 className="font-bold">{no}&nbsp;&nbsp;{title}</h2><div className="ml-8 mt-1 space-y-2">{children}</div></section>;
}
const Item = ({ no, children }: { no: string; children: ReactNode }) => <p className="flex gap-3"><span className="shrink-0">{no}</span><span>{children}</span></p>;

/** The memo of a shutdown plan, ready to print or save as PDF. */
export function SdMemoPage() {
  const { id } = useParams();
  const { doc, error, reload } = useDoc(id!);
  const [edit, setEdit] = useState(false);
  const memo = useMemo(() => {
    if (!doc) return null;
    const byMember = new Map(doc.rows.map((x) => [x.m.id, x]));
    const byEmp = new Map(doc.rows.map((x) => [x.m.employeeId, x]));
    const person = new Map((doc.people ?? []).map((p) => [p.id, p]));
    const who = (e: string) => { const r = byEmp.get(e)?.r; const p = person.get(e); return { name: r?.display_name ?? p?.name ?? '', number: r?.employee_number ?? p?.employeeNumber ?? '' }; };
    return buildMemo(doc.plan, doc.teams, doc.rows.map((x) => x.m), doc.people ?? [], who, (m) => byMember.get(m.id)?.crew ?? null);
  }, [doc]);
  if (error) return <ErrorBox error={error} />;
  if (!doc || !memo) return <Spinner />;
  const { plan } = doc;
  const s = doc.memo ?? {};
  const cc = s.cc?.length ? s.cc : DEFAULT_CC;
  let n = 0;
  const next = () => `${++n}.0`;
  const ctlNo = memo.controllers.length ? next() : '';
  const croNo = next();
  const foNo = memo.operators.length ? next() : '';
  const personnel = [...memo.personnel, ...(s.notes ?? []).filter((x) => x.trim())];
  const perNo = personnel.length ? next() : '';
  const header = (
    <div className="pb-4 text-center">
      <p className="text-[13px] font-bold tracking-wide text-brand-700">ARDS Operations · Area 4 · Unit 12</p>
    </div>
  );
  return (
    <div className="[print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      <style>{'@page { size: A4 portrait; margin: 12mm 16mm; } @page land { size: A4 landscape; margin: 8mm; } .memo-land { page: land; break-before: page; }'}</style>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link to={`/shutdown/${plan.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700"><ArrowLeft className="h-4 w-4" />{plan.title}</Link>
        <div className="flex gap-2">
          <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => setEdit(true)}><Pencil className="h-3.5 w-3.5" />Date, signer, cc</Button>
          <Button className="min-h-9 px-3 text-xs" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" />Print / save PDF</Button>
        </div>
      </div>
      <p className="mb-2 text-xs text-slate-600 print:hidden">Written from the plan as it is now: the groups, the controllers left on each crew and every person&rsquo;s day of joining follow the plan. Change the plan, and the memo changes with it.</p>
      <div className="overflow-x-auto">
        <table className="mx-auto w-full max-w-[210mm] bg-white font-serif text-[13px] leading-snug text-slate-950 ring-1 ring-slate-200 print:max-w-none print:ring-0">
          <thead><tr><td className="px-6 pt-6 print:px-0 print:pt-0">{header}</td></tr></thead>
          <tbody><tr><td className="px-6 pb-8 print:px-0 print:pb-0">
            <div className="text-center font-bold">
              <p className="text-[16px]">Operations Area-4</p>
              <p className="text-[16px]">{memo.heading}</p>
              <p className="mt-2 text-[16px]">Turnaround Manpower Coverage</p>
            </div>
            <p className="mt-4 text-right">Date: {dmy(s.date ?? today())}</p>
            <p className="mt-3 text-justify">{memo.intro}</p>

            {ctlNo && <Section no={ctlNo} title="Controller">
              <Item no={`${ctlNo.slice(0, -2)}.1`}>The following Operations Controllers will work on {plan.shiftHours} hrs basis starting from {memoLong(plan.start)} to follow the {memo.short.replace('ARDS ', 'ARDS Unit (')}{memo.train ? ')' : ''} Turnaround activities. The Operations Controller groups will be as follow:</Item>
              <GroupTable groups={memo.controllers} />
              <Item no={`${ctlNo.slice(0, -2)}.2`}>Operations Controllers Shift Schedule is shown in the attachment.</Item>
              <Item no={`${ctlNo.slice(0, -2)}.3`}>The remaining Operations Controllers will work on normal {plan.normalHours} hrs. to cover the running Units. The Shift schedule are as follow:</Item>
              <table className="mx-auto my-2 w-[92%] border-collapse text-center">
                <thead><tr><th className={cx(cell, 'w-16 font-normal')}>S. No.</th><th className={cx(cell, 'font-normal')}>Name</th><th className={cx(cell, 'w-20 font-normal')}>Emp. No.</th><th className={cx(cell, 'w-16 font-normal')}>Shift</th><th className={cx(cell, 'w-40 font-normal')}>Remarks</th></tr></thead>
                <tbody>
                  {memo.remaining.flatMap((r) => (r.people.length ? r.people : [null]).map((p) => ({ r, p }))).map(({ r, p }, i) => (
                    <tr key={`${r.crew}-${i}`}>
                      <td className={cell}>{i + 1}</td>
                      {p ? <><td className={cx(cell, 'text-left')}>{p.name}</td><td className={cell}>{p.number}</td></> : <td colSpan={2} className={cell}>Shutdown Controller</td>}
                      <td className={cell}>{r.crew}</td><td className={cell}>{plan.normalHours} hrs. basis</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {memo.train && <p className="text-center"><b>Note:</b> They will be assigned to follow-up normal activities for the running train.</p>}
            </Section>}

            <Section no={croNo} title="Control Room Operators">
              <Item no={`${croNo.slice(0, -2)}.1`}>Control Room Operators will continue working on normal shift.</Item>
            </Section>

            {foNo && <Section no={foNo} title="Field Operators">
              <Item no={`${foNo.slice(0, -2)}.1`}>The following Field Operators will join the Turnaround Teams on {plan.shiftHours} hrs. basis starting from {dmy(plan.start)} as follows:</Item>
              <GroupTable groups={memo.operators} />
              <Item no={`${foNo.slice(0, -2)}.2`}>The ARDS Unit Field Operators shutdown groups shift schedule are shown in the Attachment.</Item>
              <Item no={`${foNo.slice(0, -2)}.3`}>The remaining Field Operators will continue working on normal shift.</Item>
            </Section>}

            {perNo && <Section no={perNo} title="Personnel">
              <ul className="ml-4 list-disc space-y-1.5">{personnel.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </Section>}

            <div className="mt-10 flex justify-end break-inside-avoid">
              <div className="min-w-64 text-center">
                <div className="h-10" />
                <p className="font-bold">{s.signer?.name || <span className="font-normal text-slate-500 print:hidden">Signer — set with “Date, signer, cc”</span>}</p>
                <p>{s.signer?.title}</p>
              </div>
            </div>
            <div className="mt-6 flex gap-6 break-inside-avoid">
              <span>cc:</span>
              <table><tbody>{cc.map((c) => { const [a, b] = c.split(/\s+-\s+(?=[^-]+$)/); return <tr key={c}><td className="pr-10">{a}</td><td>{b ? `- ${b}` : ''}</td></tr>; })}</tbody></table>
            </div>
          </td></tr></tbody>
        </table>
      </div>
      <div className="memo-land mt-8 rounded-lg bg-white p-3 ring-1 ring-slate-200 print:mt-0 print:rounded-none print:p-0 print:ring-0">
        <p className="mb-2 text-xs font-semibold text-slate-500 print:hidden">Attachment · shift schedule</p>
        <div className="overflow-x-auto print:overflow-visible"><ScheduleBody doc={doc} /></div>
      </div>
      {edit && <MemoSheet doc={doc} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
    </div>
  );
}

function MemoSheet({ doc, onClose, onDone }: { doc: Doc; onClose: () => void; onDone: () => void }) {
  const s = doc.memo ?? {};
  const [date, setDate] = useState(s.date ?? today());
  const [name, setName] = useState(s.signer?.name ?? ''); const [title, setTitle] = useState(s.signer?.title ?? '');
  const [cc, setCc] = useState((s.cc?.length ? s.cc : DEFAULT_CC).join('\n'));
  const [notes, setNotes] = useState((s.notes ?? []).join('\n'));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  async function save() {
    setBusy(true); setErr(null);
    const v: MemoSettings = { date, signer: { name: name.trim(), title: title.trim() }, cc: lines(cc), notes: lines(notes) };
    try { await updateSdPlan(doc.plan.id, { memo: v }); onDone(); } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="Memo · date, signer, cc">
      <div className="space-y-3">
        <Field label="Date"><input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Signed by"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        </div>
        <Field label="cc (one a line)"><textarea className="input min-h-24" value={cc} onChange={(e) => setCc(e.target.value)} /></Field>
        <Field label="More instructions under Personnel (one a line, optional)"><textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Name #number to …" /></Field>
        <p className="text-[11px] text-slate-500">The groups, the controllers left on the crews and each person&rsquo;s day of joining are written from the plan.</p>
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy} onClick={save}>Save</Button>
      </div>
    </BottomSheet>
  );
}
