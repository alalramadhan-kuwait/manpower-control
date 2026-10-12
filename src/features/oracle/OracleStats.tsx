// Oracle absence statistics: the figures per person and code from Oracle reports (Data quality → Oracle statistics),
// the code dictionary, a manual entry of one figure, and the file import (Excel import → Upload). Figures are not leave
// cases: they never change a day's manpower, raise no per-absence alert and need no return date.
import { CheckCircle2, FileUp, OctagonX, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { conflicts as findConflicts, personRow, sickBand, sickRolling, type StatCode, type StatSnapshot, type StatValue } from '@/core/oracleStats';
import { parseOracleStats, type ParseResult, type RawCell } from '@/core/oracleStats/parse';
import { fetchDirectory } from '@/data/queries';
import { fetchStatCodes, fetchStats, importStats, type ImportOutcome } from '@/data/oracleStats';
import type { EmployeeDirectoryRow, UserProfile } from '@/data/types';
import { t } from '@/i18n';
import { Button, Card, Chip, ErrorBox, Field, PageHeader, Spinner, cx, type Tone } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';
import { nameFilter } from '@/ui/nameSearch';

const ROLL_TONE: Record<string, Tone> = { verified: 'green', verification_needed: 'amber', outdated: 'amber', missing: 'neutral' };
const ROLL_LABEL: Record<string, string> = { verified: 'Verified', verification_needed: 'Verification needed', outdated: 'Data outdated — Update required', missing: 'No figure' };
const BAND_TONE = { eligible: 'green', warning: 'amber', excluded: 'red' } as const;
const BAND_LABEL = { eligible: 'Eligible (0–21)', warning: 'Warning (22–35)', excluded: 'Excluded (over 35)' } as const;
const period = (s: StatSnapshot) => `${shortDate(s.periodStart)} ${s.periodStart.slice(0, 4)} – ${shortDate(s.periodEnd)} ${s.periodEnd.slice(0, 4)}`;

interface Data { codes: StatCode[]; snapshots: StatSnapshot[]; values: StatValue[]; dir: EmployeeDirectoryRow[] }
function useStats() {
  const [data, setData] = useState<Data | null>(null); const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    Promise.all([fetchStatCodes(), fetchStats(), fetchDirectory()]).then(([codes, s, dir]) => setData({ codes, ...s, dir: dir.filter((d) => d.in_unit12_scope) })).catch(setError);
  }, []);
  useEffect(load, [load]);
  return { data, error, load };
}

export function OracleStatsPanel({ profile }: { profile: UserProfile }) {
  const { data, error, load } = useStats();
  const today = localToday();
  const [snap, setSnap] = useState<string | null>(null);
  const [q, setQ] = useState('');
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  const s = data.snapshots.find((x) => x.id === snap) ?? data.snapshots[0] ?? null;
  const known = new Set(data.codes.map((c) => c.code));
  const unmapped = [...new Set(data.snapshots.flatMap((x) => x.codes))].filter((c) => !known.has(c));
  const match = nameFilter(q);
  const people = data.dir.filter((d) => d.is_active && match([d.display_name, d.employee_number])).sort((a, b) => a.display_name.localeCompare(b.display_name));
  return (
    <div className="space-y-4 lg:max-w-4xl">
      <PageHeader title="Oracle statistics" info={<div className="space-y-2 text-sm">
        <p>{t('Sick leave, absence without reason (AB) and escort leave are counted in Oracle. Their figures are imported or entered here by report and period, with where they came from. They are not leave cases: they never change today’s crews and need no return date.')}</p>
        <p>{t('A person in a report with no figure for a code it covers had 0 days. A person not in a report is unknown, never 0.')}</p>
        <p>{t('Shutdown teams use the rolling 12 months only from a report covering 12 months, taken within 45 days; a calendar-year total gives Verification needed.')}</p>
      </div>} />

      <Card>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Oracle codes')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-start text-[11px] uppercase text-slate-500"><th className="py-1 text-start">{t('Code')}</th><th className="text-start">{t('Meaning')}</th><th className="text-start">{t('Sick days')}</th><th className="text-start">{t('Tracked in the app as')}</th><th className="text-start">{t('Source')}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.codes.map((c) => (
                <tr key={c.code}><td className="py-1.5 font-mono font-semibold">{c.code}</td><td>{c.label}</td><td>{c.countsAsSick ? t('Yes') : t('No')}</td><td className="text-xs text-slate-600">{c.appType ?? t('Statistics only')}</td><td className="text-xs text-slate-500">{c.verified ? '✓ ' : ''}{c.source}</td></tr>
              ))}
              {unmapped.map((c) => <tr key={c}><td className="py-1.5 font-mono font-semibold">{c}</td><td colSpan={4}><Chip tone="amber">{t('Unmapped · Verification needed')}</Chip></td></tr>)}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Figures by person')}</h2>
          {data.snapshots.length > 0 && (
            <select className="input max-w-xs" value={s?.id ?? ''} onChange={(e) => setSnap(e.target.value)}>
              {data.snapshots.map((x) => <option key={x.id} value={x.id}>{x.source} · {period(x)} · {t('taken')} {x.extractedOn}</option>)}
            </select>
          )}
        </div>
        {!s ? <p className="text-sm text-slate-500">{t('No Oracle report imported yet. Use Excel import → Upload, or enter one figure below.')}</p> : <>
          <p className="mb-2 text-xs text-slate-500">{t('Report period')}: <b>{period(s)}</b> · {t('taken from Oracle')} {s.extractedOn} · {t('imported')} {s.importedAt.slice(0, 10)} · {t('codes')}: {s.codes.join(', ')}</p>
          <label className="mb-2 flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 ring-1 ring-slate-200">
            <Search className="h-4 w-4 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Name or number')} className="w-full bg-transparent text-sm outline-none" />
            {q && <button type="button" onClick={() => setQ('')} aria-label={t('Clear')}><X className="h-4 w-4 text-slate-400" /></button>}
          </label>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] uppercase text-slate-500"><th className="py-1 text-start">{t('Employee')}</th>{s.codes.map((c) => <th key={c} className="px-1 text-end font-mono">{c}</th>)}<th className="px-1 text-start">{t('Rolling 12 months (sick)')}</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {people.map((p) => {
                  const row = personRow(s, data.values, p.id);
                  const roll = sickRolling(p.id, today, data.snapshots, data.values, data.codes);
                  return (
                    <tr key={p.id}>
                      <td className="py-1.5"><Link to={`/employees/${p.id}`} className="font-medium text-brand-700">{p.display_name}</Link><div className="text-[11px] text-slate-400">#{p.employee_number}</div></td>
                      {s.codes.map((c) => <td key={c} className={cx('px-1 text-end tabular-nums', row[c] === null && 'text-slate-300')}>{row[c] === null ? '—' : row[c]}</td>)}
                      <td className="px-1"><div className="flex flex-wrap items-center gap-1">
                        <Chip tone={ROLL_TONE[roll.state]}>{t(ROLL_LABEL[roll.state])}</Chip>
                        {roll.days !== null && <Chip tone={roll.state === 'verified' ? BAND_TONE[sickBand(roll.days)] : 'neutral'}>{roll.days} {t('d')}{roll.state === 'verified' ? ` · ${t(BAND_LABEL[sickBand(roll.days)])}` : ''}</Chip>}
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{t('— : not in this report (unknown). 0 : in the report, nothing recorded.')}</p>
        </>}
      </Card>

      <ManualEntry data={data} profile={profile} onDone={load} />
    </div>
  );
}

function ManualEntry({ data, profile, onDone }: { data: Data; profile: UserProfile; onDone: () => void }) {
  const today = localToday();
  const [emp, setEmp] = useState(''); const [code, setCode] = useState('SK'); const [days, setDays] = useState(''); const [occ, setOcc] = useState('');
  const [from, setFrom] = useState(`${Number(today.slice(0, 4)) - 1}${today.slice(4)}`); const [to, setTo] = useState(today); const [taken, setTaken] = useState(today);
  const [source, setSource] = useState('Oracle absence report (entered by hand)');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [res, setRes] = useState<ImportOutcome | null>(null);
  const ok = emp && code && days !== '' && Number(days) >= 0 && from <= to && taken && source.trim();
  async function save(replace = false) {
    setBusy(true); setErr(null);
    try {
      const r = await importStats({ source: source.trim(), periodStart: from, periodEnd: to, extractedOn: taken, codes: [code] }, [{ employeeId: emp, code, days: Number(days), occurrences: occ === '' ? null : Number(occ) }], replace);
      setRes(r);
      if (r.snapshot) { setDays(''); setOcc(''); onDone(); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Card>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Enter one figure from an Oracle report')}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Employee"><select className="input" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">{t('Choose…')}</option>{data.dir.filter((d) => d.is_active).sort((a, b) => a.display_name.localeCompare(b.display_name)).map((d) => <option key={d.id} value={d.id}>{d.display_name}</option>)}</select></Field>
        <Field label="Code"><select className="input" value={code} onChange={(e) => setCode(e.target.value)}>{data.codes.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}</select></Field>
        <Field label="Days"><input className="input" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        <Field label="Occurrences (optional)"><input className="input" inputMode="numeric" value={occ} onChange={(e) => setOcc(e.target.value)} /></Field>
        <Field label="Period from"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Period to"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Taken from Oracle on"><input type="date" className="input" value={taken} max={today} onChange={(e) => setTaken(e.target.value)} /></Field>
        <div className="col-span-2"><Field label="Source report"><input className="input" value={source} onChange={(e) => setSource(e.target.value)} /></Field></div>
      </div>
      {err != null && <div className="mt-2"><ErrorBox error={err} /></div>}
      <Outcome res={res} isHead={profile.role_code === 'section_head'} onReplace={() => save(true)} busy={busy} dir={data.dir} />
      <Button className="mt-3 w-full" disabled={!ok || busy} onClick={() => save(false)}>{busy ? t('Saving…') : t('Save figure')}</Button>
    </Card>
  );
}

function Outcome({ res, isHead, onReplace, busy, dir }: { res: ImportOutcome | null; isHead: boolean; onReplace: () => void; busy: boolean; dir: EmployeeDirectoryRow[] }) {
  if (!res) return null;
  const name = (id: string) => dir.find((d) => d.id === id)?.display_name ?? id;
  if (res.snapshot) return <p className="mt-2 flex items-center gap-1 text-sm text-status-green"><CheckCircle2 className="h-4 w-4" />{t('Saved')}: {res.inserted} {t('figures')}{res.replaced ? ` · ${res.replaced} ${t('replaced (old ones kept as history)')}` : ''}{res.unchanged ? ` · ${res.unchanged} ${t('unchanged')}` : ''}</p>;
  return (
    <div className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-300">
      <p className="font-medium">{res.message ? t(res.message) : t('Some figures differ from what is recorded.')}</p>
      <ul className="mt-1 space-y-0.5 text-xs">{res.conflicts.map((c, i) => <li key={i}>{name(c.employee_id)} · {c.code}: {t('recorded')} {c.existing} → {t('new')} {c.new}</li>)}</ul>
      {isHead ? <Button variant="danger" className="mt-2 w-full" disabled={busy} onClick={onReplace}>{t('Replace with the new figures (Section Head)')}</Button>
        : <p className="mt-1 text-xs">{t('Nothing was saved. The Section Head confirms replacing recorded figures.')}</p>}
    </div>
  );
}

/** Excel import → Upload: an Oracle absence-statistics report file, previewed against what is recorded before anything is saved. */
export function OracleStatsImport({ profile }: { profile: UserProfile }) {
  const { data, error, load } = useStats();
  const today = localToday();
  const [file, setFile] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [taken, setTaken] = useState(today);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [res, setRes] = useState<ImportOutcome | null>(null);
  const byNumber = useMemo(() => new Map((data?.dir ?? []).map((d) => [d.employee_number, d])), [data]);
  async function read(f: File) {
    setErr(null); setRes(null); setFile(f.name); setSource(f.name.replace(/\.[^.]+$/, ''));
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const rows = XLSX.utils.sheet_to_json<RawCell[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
      setParsed(parseOracleStats(rows));
    } catch (e) { setErr(e); setParsed(null); }
  }
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const known = new Set(data.codes.map((c) => c.code));
  const matched = (parsed?.values ?? []).filter((v) => byNumber.has(v.employeeNumber));
  const unknownPeople = [...new Set((parsed?.values ?? []).filter((v) => !byNumber.has(v.employeeNumber)).map((v) => v.employeeNumber))];
  const incoming = matched.map((v) => ({ employeeId: byNumber.get(v.employeeNumber)!.id, code: v.code, days: v.days, occurrences: v.occurrences }));
  const diff = from && to ? findConflicts({ start: from, end: to }, incoming, data.snapshots, data.values) : [];
  const ready = !!parsed && matched.length > 0 && !!from && !!to && from <= to && !!taken && !!source.trim();
  async function run(replace = false) {
    setBusy(true); setErr(null);
    try {
      const r = await importStats({ source: source.trim(), periodStart: from, periodEnd: to, extractedOn: taken, codes: parsed!.codes }, incoming, replace);
      setRes(r); if (r.snapshot) load();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <Card className="mt-4 lg:max-w-3xl">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-brand-800"><FileUp className="h-4 w-4" />{t('Oracle absence statistics')}</h2>
      <p className="mb-3 text-xs text-slate-600">{t('A report of sick / AB / escort figures per person (one row per person and code, or one column per code). Give the period it covers and the day it was taken from Oracle. Nothing is saved before the preview.')}</p>
      <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-white text-sm font-medium text-brand-800 ring-1 ring-slate-300">
        <FileUp className="h-4 w-4" />{file ?? t('Choose the report file (Excel or CSV)')}
        <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} />
      </label>
      {parsed && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Period from"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Period to"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label="Taken from Oracle on"><input type="date" className="input" value={taken} max={today} onChange={(e) => setTaken(e.target.value)} /></Field>
            <Field label="Source report"><input className="input" value={source} onChange={(e) => setSource(e.target.value)} /></Field>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Chip tone="blue">{t('Layout')}: {parsed.layout ?? '—'}</Chip>
            <Chip tone="green">{matched.length} {t('figures for staff in scope')}</Chip>
            {unknownPeople.length > 0 && <Chip tone="amber">{unknownPeople.length} {t('numbers not in Section 1 (left out)')}</Chip>}
            {parsed.problems.length > 0 && <Chip tone="red">{parsed.problems.length} {t('rows not readable')}</Chip>}
            {parsed.codes.map((c) => <Chip key={c} tone={known.has(c) ? 'neutral' : 'amber'}>{c}{known.has(c) ? '' : ` · ${t('Unmapped')}`}</Chip>)}
          </div>
          {diff.length > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-300">{diff.length} {t('figures differ from what is recorded for the same period: they are replaced only after the Section Head confirms.')}</p>}
          {parsed.problems.length > 0 && <ul className="max-h-32 overflow-y-auto text-xs text-red-700">{parsed.problems.slice(0, 30).map((p, i) => <li key={i}>{t('Row')} {p.row}: {p.message}</li>)}</ul>}
          {err != null && <ErrorBox error={err} />}
          <Outcome res={res} isHead={profile.role_code === 'section_head'} onReplace={() => run(true)} busy={busy} dir={data.dir} />
          <Button className="w-full" disabled={!ready || busy || !!res?.snapshot} onClick={() => run(false)}>{busy ? t('Saving…') : res?.snapshot ? <><CheckCircle2 className="h-4 w-4" />{t('Imported')}</> : t('Import these figures')}</Button>
          {!ready && !res && <p className="flex items-center gap-1 text-xs text-slate-500"><OctagonX className="h-3.5 w-3.5" />{t('Give the period, the date taken and the source first.')}</p>}
        </div>
      )}
    </Card>
  );
}
