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
    for (const p of result.rows.filter((x) => x.status === 'ready' && ['finish_step', 'start_step', 'status_line', 'drums', 'planning', 'hold_release'].includes(x.type))) {
      try { await applyProposal(d, p); ok++; } catch (e) { bad.push(`${p.tag ?? p.type}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    const fresh = await fetchIntel(d.tracker.id, 30);
    setResult({ ...result, rows: fresh.proposals.filter((p) => p.reportId === result.reportId) });
    setBusy(null); if (bad.length) setErr(new Error(bad.join('\n')));
    onDone(`${ok} change${ok === 1 ? '' : 's'} applied${bad.length ? `, ${bad.length} not` : ''}.`);
  }
  const readyN = result ? result.rows.filter((x) => x.status === 'ready').length : 0;
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
          <p className="text-[12px] text-slate-600">{result.duplicate ? 'This text was already read: its proposals are below. ' : ''}{result.rows.length} proposal{result.rows.length === 1 ? '' : 's'} · <b className="text-green-800">{readyN} ready</b> · {result.rows.filter((x) => x.status === 'review').length} to review · <span className={cx(result.rows.some((x) => x.status === 'conflict') && 'text-red-800')}>{result.rows.filter((x) => x.status === 'conflict').length} conflicts</span> · {result.rows.filter((x) => x.status === 'info').length} info</p>
          {canEdit && readyN > 0 && <Button className="w-full" disabled={!!busy} onClick={applyReady}>{busy ?? `Apply all ready (${result.rows.filter((x) => x.status === 'ready' && ['finish_step', 'start_step', 'status_line', 'drums', 'planning', 'hold_release'].includes(x.type)).length})`}</Button>}
          {err != null && <ErrorBox error={err} />}
          <ProposalList rows={result.rows} d={d} canEdit={canEdit} onDone={async (m) => { onDone(m); const fresh = await fetchIntel(d.tracker.id, 30); setResult((r) => (r ? { ...r, rows: fresh.proposals.filter((p) => p.reportId === r.reportId) } : r)); }} />
          <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => { setResult(null); setText(''); }}>Paste another</Button><Button variant="secondary" className="flex-1" onClick={onClose}>Close</Button></div>
        </div>
      )}
    </BottomSheet>
  );
}
