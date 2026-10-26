// Sick leave (rolling 12 months) from the administrator's Excel file: name, Civil ID, total days. Matched by Civil ID
// (a one-way hash; the ID is never stored, shown only as its last four digits), else by name for confirmation the first
// time. Preview old → new before anything is saved; earlier figures are kept as history.
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { matchSickRows, readSickSheet, type SickMatch } from '@/core/vacation';
import { addDaysIso } from '@/core/roster';
import { civilHash, commitSickImport, fetchCivilLinks, fetchSickImports, fetchStaffNames, type VacationData } from '@/data/vacation';
import { BottomSheet, Button, ErrorBox, cx } from '@/ui/components';
import { localToday } from '@/ui/leave';
import { dm, stamp } from './parts';

const KIND: Record<SickMatch['kind'], string> = { civil: 'Civil ID', name: 'Name · confirm', name_partial: 'Name (partial) · confirm', none: 'Not matched' };

export function SickImportSheet({ d, onClose, onDone }: { d: VacationData; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<{ name: string; hash: string } | null>(null);
  const [matches, setMatches] = useState<SickMatch[] | null>(null);
  const [confirm, setConfirm] = useState<Set<number>>(new Set());
  const [to, setTo] = useState(localToday());
  const [from, setFrom] = useState(addDaysIso(addDaysIso(localToday(), 1), -365));
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof fetchSickImports>>>([]);
  useEffect(() => { fetchSickImports().then(setHistory).catch(() => setHistory([])); }, []);
  const byId = useMemo(() => new Map(d.people.map((p) => [p.id, p])), [d.people]);

  async function read(f: File) {
    setErr(null); setMatches(null);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
      const r = readSickSheet(matrix);
      if (!r.columns) throw new Error(r.problems[0]);
      const [links, staff] = await Promise.all([fetchCivilLinks(), fetchStaffNames()]);
      const hashes = await Promise.all(r.rows.map((x) => (x.civil ? civilHash(x.civil) : Promise.resolve(''))));
      const m = matchSickRows(r.rows, hashes, links, staff);
      setMatches(m);
      setConfirm(new Set(m.map((x, i) => (x.kind === 'name' && !x.error ? i : -1)).filter((i) => i >= 0)));
      setFile({ name: f.name, hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('') });
    } catch (e) { setErr(e); }
  }
  const usable = (matches ?? []).map((m, i) => ({ m, i })).filter(({ m, i }) => !m.error && m.employeeId && (m.kind === 'civil' || confirm.has(i)));
  const counts = matches ? { rows: matches.length, civil: matches.filter((m) => m.kind === 'civil' && !m.error).length, byName: matches.filter((m) => (m.kind === 'name' || m.kind === 'name_partial') && !m.error).length,
    none: matches.filter((m) => m.kind === 'none' && !m.error).length, errors: matches.filter((m) => m.error).length } : null;
  async function commit() {
    if (!file || !matches) return;
    setBusy(true); setErr(null);
    try {
      await commitSickImport({ fileName: file.name, fileHash: file.hash, periodStart: from, periodEnd: to,
        rows: usable.map(({ m }) => ({ employee_id: m.employeeId!, civil_hash: m.hash, last4: m.last4, days: m.row.days!, link: m.kind !== 'civil' })),
        summary: { rows: counts!.rows, unmatched: matches.length - usable.length, refused: counts!.errors, byCivil: counts!.civil, byName: usable.filter(({ m }) => m.kind !== 'civil').length } });
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="Sick leave · rolling 12 months">
      <div className="space-y-2.5 text-sm">
        <p className="-mt-2 text-xs text-slate-600">Excel with Employee name, Civil ID and total sick days of the last 12 months. Civil IDs are never stored or printed (only a one-way code and the last 4 digits).</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label className="space-y-0.5"><span className="font-medium text-slate-700">Period from</span><input type="date" className="input py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="space-y-0.5"><span className="font-medium text-slate-700">to (report date)</span><input type="date" className="input py-1.5" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} className="block w-full text-xs file:mr-2 file:min-h-9 file:rounded-lg file:border-0 file:bg-brand-700 file:px-3 file:text-sm file:font-semibold file:text-white" />
        {err != null && <ErrorBox error={err} />}
        {counts && (
          <>
            <p className="text-xs text-slate-700">{counts.rows} rows · <b>{counts.civil}</b> by Civil ID · <b>{counts.byName}</b> by name (tick to confirm) · <b>{counts.none}</b> not matched · <b className={counts.errors ? 'text-red-700' : ''}>{counts.errors}</b> refused</p>
            <ul className="max-h-[45vh] divide-y divide-slate-100 overflow-y-auto rounded-xl text-xs ring-1 ring-slate-200">
              {matches!.map((m, i) => {
                const p = m.employeeId ? byId.get(m.employeeId) : null;
                const old = p?.sick?.days ?? null;
                const needs = (m.kind === 'name' || m.kind === 'name_partial') && !m.error;
                return (
                  <li key={i} className={cx('flex items-center gap-2 px-2 py-1.5', m.error && 'bg-red-50')}>
                    {needs ? <input type="checkbox" aria-label={`Confirm ${m.row.name}`} checked={confirm.has(i)} onChange={() => setConfirm((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} className="h-4 w-4" /> : <span className="w-4" />}
                    <span className="min-w-0 flex-1">
                      <b className="block">{m.row.name || '—'}</b>
                      <span className="text-slate-500">ID ••••{m.last4 || '—'} · line {m.row.line}{p ? ` → ${p.name} #${p.number}` : ''}</span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">{m.error ? <span className="font-semibold text-red-700">{m.error}</span> : <><span className="text-slate-500">{old ?? '—'} →</span> <b>{m.row.days}</b> d<span className="block text-[10px] text-slate-500">{KIND[m.kind]}</span></>}</span>
                  </li>
                );
              })}
            </ul>
            <Button className="w-full" disabled={busy || !usable.length || !from || !to || from > to} onClick={commit}>Save {usable.length} figures (as of {dm(to)})</Button>
          </>
        )}
        {history.length > 0 && <details className="text-xs"><summary className="cursor-pointer text-slate-600">Earlier imports · {history.length}</summary>
          <ul className="mt-1 space-y-0.5 text-slate-600">{history.map((h) => <li key={h.at}>{stamp(h.at)} · {h.fileName} · {dm(h.periodStart)} – {dm(h.periodEnd)} · {h.matched} saved, {h.changed} changed, {h.unmatched} not matched{h.by ? ` · ${h.by}` : ''}</li>)}</ul></details>}
      </div>
    </BottomSheet>
  );
}
