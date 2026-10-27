// Paste update: one large field for a departmental report (several reports can be pasted one after another), the
// department, the report date and shift, the reporter; Read → the proposals, grouped by item, each with Apply · Edit ·
// Dismiss · Source, and "Apply all ready" for the plain ones. The report is stored as pasted the moment it is read, so
// an error later never loses it; the same text read twice is recognised.
import { useMemo, useState } from 'react';
import { DEPARTMENTS, type Department, type ReportMeta } from '@/core/tracker/intel';
import { applyProposal, fetchIntel, readAgainst, submitReport, type IntelData, type ProposalRow } from '@/data/trackerIntel';
import type { TrackerData } from '@/data/tracker';
import { BottomSheet, Button, ErrorBox, Field, cx } from '@/ui/components';
import { ProposalList } from './ProposalList';
import { ItemCards, cardApplicable, reportProgress, toCards } from './ItemCards';

const KW = 3 * 36e5;
const today = () => new Date(Date.now() + KW).toISOString().slice(0, 10);
const LAST = 'trk-paste-dept';

export function PasteUpdate({ d, canEdit, onClose, onDone }: { d: TrackerData; canEdit: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [text, setText] = useState('');
  const [dept, setDept] = useState<Department>(() => { try { return (localStorage.getItem(LAST) as Department) || 'shift_ops'; } catch { return 'shift_ops'; } });
  const [date, setDate] = useState(today()); const [shift, setShift] = useState<'' | 'D' | 'N'>(''); const [who, setWho] = useState('');
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);
  const [result, setResult] = useState<{ reportId: string; rows: ProposalRow[]; summary: Record<string, number>; duplicate: boolean } | null>(null);
  const meta = useMemo((): ReportMeta => ({ department: dept, reportDate: date, shift: shift || null, reporter: who.trim() || null, submittedAt: new Date().toISOString() }), [dept, date, shift, who]);
  async function read() {
    setBusy('Reading against the tracker…'); setErr(null);
    try {
      try { localStorage.setItem(LAST, dept); } catch { /* no storage */ }
      const intel: IntelData = await fetchIntel(d.tracker.id, 30);
      const r = readAgainst(d, text, meta, intel);
      const { reportId, duplicate } = await submitReport(d, text, meta, r);
      const fresh = await fetchIntel(d.tracker.id, 30);
      const rows = fresh.proposals.filter((p) => p.reportId === reportId);
      setResult({ reportId, rows, summary: r.summary as unknown as Record<string, number>, duplicate });
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }
  async function applyReady() {
    if (!result) return; setBusy('Applying…'); setErr(null); let ok = 0; const bad: string[] = [];
    for (const p of result.rows.filter(cardApplicable).sort((a, b) => Date.parse(a.eventAt) - Date.parse(b.eventAt))) {
      try { await applyProposal(d, p); ok++; } catch (e) { bad.push(`${p.tag ?? p.type}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    const fresh = await fetchIntel(d.tracker.id, 30);
    setResult({ ...result, rows: fresh.proposals.filter((p) => p.reportId === result.reportId) });
    setBusy(null); if (bad.length) setErr(new Error(bad.join('\n')));
    onDone(`${ok} change${ok === 1 ? '' : 's'} applied${bad.length ? `, ${bad.length} not` : ''}.`);
  }
  return (
    <BottomSheet open onClose={onClose} title="📋 Paste update">
      {!result ? (
        <div className="space-y-2">
          <textarea className="input min-h-44 py-2 text-[13px]" placeholder="Paste the department's report (English or Arabic): one line per item, e.g. R-205: dumping I/P. 1972 drums." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Department"><select className="input py-1.5 text-[13px]" value={dept} onChange={(e) => setDept(e.target.value as Department)}>{DEPARTMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Report date"><input type="date" className="input py-1.5 text-[13px]" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Shift (if known)"><select className="input py-1.5 text-[13px]" value={shift} onChange={(e) => setShift(e.target.value as '' | 'D' | 'N')}><option value="">—</option><option value="D">Day</option><option value="N">Night</option></select></Field>
            <Field label="Reporter (if known)"><input className="input py-1.5 text-[13px]" value={who} onChange={(e) => setWho(e.target.value)} /></Field>
          </div>
          <p className="text-[11px] text-slate-500">The text is kept as pasted. Nothing changes in the tracker until you apply a proposal. Read by the site's rules in this app; no outside service sees the report.</p>
          {err != null && <ErrorBox error={err} />}
          <Button className="w-full" disabled={!!busy || !text.trim() || !canEdit} onClick={read}>{busy ?? 'Read'}</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {(() => {
            const { cards, notes } = toCards(result.rows); const look = cards.filter((c) => c.look).length;
            const effect = reportProgress(d, result.rows); const readyN2 = result.rows.filter(cardApplicable).length;
            const refresh = async (m: string) => { onDone(m); const fresh = await fetchIntel(d.tracker.id, 30); setResult((r) => (r ? { ...r, rows: fresh.proposals.filter((p) => p.reportId === r.reportId) } : r)); };
            return <>
              <p className="text-[12px] text-slate-600">{result.duplicate ? 'This text was already read. ' : ''}{cards.length} item{cards.length === 1 ? '' : 's'} · <b className={cx(look ? 'text-amber-800' : 'text-slate-600')}>{look} to check</b> · <b className="text-green-800">{cards.length - look} ready</b> · {notes.length} notes</p>
              {effect && <p className="rounded-xl bg-brand-50 px-3 py-2 text-[13px] font-semibold tabular-nums text-brand-800">{effect}</p>}
              {canEdit && readyN2 > 0 && <Button className="w-full" disabled={!!busy} onClick={applyReady}>{busy ?? `Apply all ready (${readyN2})`}</Button>}
              {err != null && <ErrorBox error={err} />}
              <ItemCards cards={cards} d={d} canEdit={canEdit} onDone={refresh} show="all" applyAll={false} />
              {notes.length > 0 && <details className="rounded-2xl bg-white px-3 py-1.5 text-[12px] ring-1 ring-slate-200"><summary className="cursor-pointer font-semibold text-slate-700">Notes · {notes.length}</summary><div className="mt-1.5"><ProposalList rows={notes} d={d} canEdit={canEdit} onDone={refresh} /></div></details>}
            </>;
          })()}
          <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => { setResult(null); setText(''); }}>Paste another</Button><Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button></div>
        </div>
      )}
    </BottomSheet>
  );
}
