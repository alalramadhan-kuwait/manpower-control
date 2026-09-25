import { ChevronDown, ChevronUp, History, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AUDIT_CATEGORIES, describe, type AuditCategory, type AuditEntry, type AuditLookups, type AuditRow } from '@/core/audit';
import { AUDIT_PAGE, fetchAudit, fetchAuditLookups } from '@/data/audit';
import { Button, Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dateHeading = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA');

/** Audit history (Stage J): every change made in the app, newest first, in plain words. Read-only. */
export default function AuditPage() {
  const [params, setParams] = useSearchParams();
  const employeeId = params.get('employee') ?? undefined;
  const [cat, setCat] = useState<AuditCategory | 'all'>('all');
  const [imports, setImports] = useState(false);
  const [q, setQ] = useState('');
  const [lk, setLk] = useState<AuditLookups | null>(null);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const tables = cat === 'all' ? undefined : AUDIT_CATEGORIES.find((c) => c.key === cat)!.tables;

  useEffect(() => { fetchAuditLookups().then(setLk).catch(setError); }, []);
  const load = useCallback(async (before?: string) => {
    setBusy(true); setError(null);
    try {
      const page = await fetchAudit({ before, tables, employeeId, includeImports: imports });
      setRows((r) => (before ? [...(r ?? []), ...page] : page)); setMore(page.length === AUDIT_PAGE);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }, [tables?.join(), employeeId, imports]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setRows(null); load(); }, [load]);

  const entries = useMemo(() => {
    if (!rows || !lk) return null;
    const needle = q.trim().toLowerCase();
    return rows.map((r) => describe(r, lk)).filter((e) => !needle || [e.title, e.actor, ...e.details].some((t) => t.toLowerCase().includes(needle)));
  }, [rows, lk, q]);
  const days = useMemo(() => {
    const out: { day: string; items: AuditEntry[] }[] = [];
    for (const e of entries ?? []) { const d = localDay(e.at); const last = out[out.length - 1]; if (last?.day === d) last.items.push(e); else out.push({ day: d, items: [e] }); }
    return out;
  }, [entries]);
  const person = employeeId && lk ? lk.people.get(employeeId) ?? 'Staff member' : null;

  return (
    <div>
      <PageHeader title="Audit history" info="Every change made in the app, newest first: who did it and what changed. Tap an entry for the details. Nothing here can be edited." />
      {person && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 ring-1 ring-brand-100">
          <span className="min-w-0 truncate">Only changes about <Link to={`/employees/${employeeId}`} className="font-semibold underline">{person}</Link></span>
          <button type="button" className="shrink-0 text-xs font-semibold" onClick={() => { params.delete('employee'); setParams(params); }}>Show all</button>
        </div>
      )}
      <div className="-mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {[{ key: 'all' as const, label: 'All' }, ...AUDIT_CATEGORIES].map((c) => (
          <button key={c.key} type="button" aria-pressed={cat === c.key} onClick={() => setCat(c.key)}
            className={cx('shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ring-1', cat === c.key ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200')}>{c.label}</button>
        ))}
      </div>
      <div className="mb-3 flex items-center gap-2">
        <label className="relative block min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input" style={{ paddingLeft: '2.25rem' }} placeholder="Search name or change" value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" /></label>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={imports} onChange={(e) => setImports(e.target.checked)} /> Imports</label>
      </div>
      {!imports && <p className="-mt-1 mb-3 text-[11px] text-slate-500">Imports: see <Link to="/imports/history" className="font-medium text-brand-700">Import history</Link></p>}
      {error ? <ErrorBox error={error} /> : !entries ? <Spinner /> : entries.length === 0 ? (
        <Card className="text-sm text-slate-500"><History className="mb-1 h-5 w-5 text-slate-400" />Nothing recorded{q ? ' matches the search' : ''}.</Card>
      ) : (
        <div className="space-y-3">
          {days.map((d) => (
            <section key={d.day}>
              <h2 className="mb-1 px-1 text-xs font-semibold text-slate-500">{dateHeading(d.items[0].at)}</h2>
              <Card className="divide-y divide-slate-100 p-0">{d.items.map((e) => <Entry key={e.id} e={e} showPerson={!employeeId} />)}</Card>
            </section>
          ))}
          {more && <Button variant="secondary" className="w-full" disabled={busy} onClick={() => load(rows![rows!.length - 1].occurred_at)}>{busy ? 'Loading…' : 'Load older'}</Button>}
        </div>
      )}
    </div>
  );
}

const CAT_LABEL = Object.fromEntries(AUDIT_CATEGORIES.map((c) => [c.key, c.label])) as Record<AuditCategory, string>;

export function Entry({ e, showPerson = true }: { e: AuditEntry; showPerson?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasMore = e.details.length > 0;
  return (
    <div className="px-3 py-2">
      <button type="button" disabled={!hasMore} onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 text-left">
        <span className="w-10 shrink-0 pt-0.5 text-[11px] tabular-nums text-slate-500">{time(e.at)}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-900">{e.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500">
            <span>{e.actor}</span><span>·</span><span>{CAT_LABEL[e.category] ?? 'Other'}</span>
            {e.fromImport && <><span>·</span><span className="rounded bg-slate-100 px-1 font-semibold text-slate-600">Import</span></>}
            {showPerson && e.employeeId && <><span>·</span><Link to={`/employees/${e.employeeId}`} onClick={(ev) => ev.stopPropagation()} className="font-medium text-brand-700">Profile</Link></>}
          </span>
        </span>
        {hasMore && (open ? <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />)}
      </button>
      {open && <ul className="ml-12 mt-1 space-y-0.5 rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-700">{e.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
    </div>
  );
}
