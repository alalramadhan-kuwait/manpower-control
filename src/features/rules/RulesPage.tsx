// Rules (owner, 27 Oct 2026): every organization rule on one page, grouped and in order. Everybody reads them; the
// Section Head changes a number with a reason, inside its allowed range, from today forward. Every change is kept.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RULE_GROUPS, checkRuleValue, ruleDef, type RuleBound, type RuleField, type RuleGroup, type RuleValue } from '@/core/rules';
import { fetchRuleChanges, fetchRules, type RuleChange, type RuleRow } from '@/data/rules';
import { changeRule } from '@/data/rulesClient';
import type { UserProfile } from '@/data/types';
import ModesPanel from '@/features/operation/OperationPage';
import { BottomSheet, Button, ErrorBox, PageHeader, Spinner, Toast, cx } from '@/ui/components';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const pillOf = (key: string, v: RuleValue | null) => { const d = ruleDef(key); return d && v ? d.pill(v) : '–'; };

export default function RulesPage({ profile }: { profile: UserProfile }) {
  const isHead = profile.role_code === 'section_head';
  const [q, setQ] = useSearchParams();
  const group = (RULE_GROUPS.find((g) => g.key === q.get('group'))?.key ?? 'all') as RuleGroup | 'all';
  const [rows, setRows] = useState<RuleRow[] | null>(null); const [err, setErr] = useState<unknown>(null);
  const [open, setOpen] = useState<RuleRow | null>(null); const [history, setHistory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const load = () => fetchRules().then(setRows).catch(setErr);
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 3000); return () => window.clearTimeout(t); }, [toast]);
  const groups = useMemo(() => RULE_GROUPS.filter((g) => group === 'all' || g.key === group).map((g) => ({ ...g, rows: (rows ?? []).filter((r) => r.def.group === g.key) })).filter((g) => g.rows.length), [rows, group]);
  const pick = (g: RuleGroup | 'all') => { const n = new URLSearchParams(q); if (g === 'all') n.delete('group'); else n.set('group', g); setQ(n, { replace: true }); };

  return (
    <div className="lg:max-w-5xl">
      <PageHeader title="Rules" subtitle={isHead ? 'Tap a rule to change it · applies from today' : 'The rules the app works by · the Section Head changes them'}
        action={<button type="button" onClick={() => setHistory(true)} className="min-h-9 shrink-0 rounded-lg px-2 text-[12px] font-semibold text-brand-700" aria-label="History of changes">History</button>} />
      <div className="no-scrollbar -mx-4 mb-3 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {[{ key: 'all' as const, label: 'All', icon: '' }, ...RULE_GROUPS].map((g) => (
          <button key={g.key} type="button" aria-pressed={group === g.key} onClick={() => pick(g.key)}
            className={cx('min-h-8 shrink-0 rounded-lg px-2.5 text-[12px] font-semibold ring-1', group === g.key ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200')}>
            {g.icon ? `${g.icon} ` : ''}{g.label}
          </button>
        ))}
      </div>
      {err != null && <ErrorBox error={err} />}
      {!rows && err == null && <Spinner />}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        {groups.map((g) => (
          <section key={g.key} className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
            <h2 className="border-b border-slate-100 px-3 py-2 text-[13px] font-bold text-slate-700">{g.icon} {g.label}</h2>
            <ul className="divide-y divide-slate-100">
              {g.rows.map((r) => (
                <li key={r.key}>
                  <button type="button" onClick={() => setOpen(r)} className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left active:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-800">{r.title}</span>
                      <span className="block truncate text-[11px] text-slate-500">{r.def.description}</span>
                    </span>
                    <span className="shrink-0 rounded-lg bg-brand-50 px-2 py-1 text-[12px] font-bold tabular-nums text-brand-800">{r.def.pill(r.value)}</span>
                    <span className="text-slate-400">›</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {(group === 'all' || group === 'crew') && rows && <section className="mt-3 lg:max-w-2xl"><h2 className="mb-1.5 px-1 text-[13px] font-bold text-slate-700">👥 Manual override and operating modes</h2><ModesPanel profile={profile} /></section>}
      {open && <RuleSheet row={open} isHead={isHead} onClose={() => setOpen(null)} onSaved={(m) => { setOpen(null); setToast(m); void load(); }} />}
      <BottomSheet open={history} onClose={() => setHistory(false)} title="History of changes">{history && <ChangeList />}</BottomSheet>
      {toast && <Toast msg={toast} />}
    </div>
  );
}

function RuleSheet({ row, isHead, onClose, onSaved }: { row: RuleRow; isHead: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const [v, setV] = useState<RuleValue>({ ...row.value });
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const problem = checkRuleValue(row.key, v, row.bounds, row.value);
  const ready = !problem && reason.trim().length >= 3;
  async function save() {
    setBusy(true); setErr(null);
    try { await changeRule(row.key, v, reason); onSaved(`${row.title}: ${row.def.pill(v)}. Applies from today.`); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title={row.title}>
      <p className="mb-3 text-[13px] text-slate-600">{row.def.description}</p>
      <div className="space-y-2">
        {row.def.fields.map((f) => <FieldEdit key={f.name} f={f} b={row.bounds[f.name] ?? {}} was={row.value[f.name] ?? null} value={v[f.name] ?? null} edit={isHead}
          onChange={(x) => setV((o) => ({ ...o, [f.name]: x }))} />)}
      </div>
      {isHead ? <>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Reason (required)</span>
          <textarea className="input min-h-16" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the rule changes" />
        </label>
        <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-200">{row.def.effect}</p>
        {problem && problem !== 'Nothing changed.' && <p className="mt-2 text-[12px] font-medium text-red-700">{problem}</p>}
        {err != null && <div className="mt-2"><ErrorBox error={err} /></div>}
        <Button className="mt-3 w-full" disabled={!ready || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
      </> : <p className="mt-3 text-[12px] text-slate-500">Only the Section Head changes the rules.</p>}
      <p className="mt-3 text-[11px] text-slate-500">{row.updatedAt ? `Last changed ${when(row.updatedAt)}${row.updatedBy ? ` by ${row.updatedBy}` : ''}` : 'Not changed since the Rules page started.'}</p>
      <div className="mt-2"><ChangeList ruleKey={row.key} /></div>
    </BottomSheet>
  );
}

function FieldEdit({ f, b, was, value, edit, onChange }: { f: RuleField; b: RuleBound; was: number | string | null; value: number | string | null; edit: boolean; onChange: (v: number | string | null) => void }) {
  const unit = f.unit ? ` ${f.unit}` : '';
  const shown = (x: number | string | null) => (x == null ? f.nullLabel ?? '–' : `${x}${unit}`);
  const step = f.step ?? 1;
  const clamp = (x: number) => Math.min(b.max ?? Infinity, Math.max(b.min ?? -Infinity, Math.round(x * 100) / 100));
  return (
    <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-slate-800">{f.label}</span>
        <span className="block text-[11px] text-slate-500">was {shown(was)}{f.kind !== 'time' && b.min != null ? ` · allowed ${b.min}–${b.max}${unit}` : ''}</span>
      </span>
      {!edit ? <span className="text-[14px] font-bold tabular-nums text-slate-800">{shown(value)}</span>
        : f.kind === 'time' ? <input type="time" className="h-9 w-28 rounded-lg bg-white px-2 text-[14px] tabular-nums ring-1 ring-slate-200" value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)} />
        : <>
          {b.nullable && <button type="button" onClick={() => onChange(value == null ? clamp(Number(was ?? b.min ?? 0)) : null)}
            className={cx('min-h-9 rounded-lg px-2 text-[12px] font-semibold ring-1', value == null ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200')}>{f.nullLabel}</button>}
          {value != null && <div className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label={`${f.label} less`} disabled={b.min != null && Number(value) <= b.min} onClick={() => onChange(clamp(Number(value) - step))} className="h-9 w-9 rounded-lg bg-white text-lg font-bold text-brand-700 ring-1 ring-slate-200 disabled:opacity-40">−</button>
            <input aria-label={f.label} inputMode="decimal" className="h-9 w-14 rounded-lg bg-white text-center text-[14px] font-bold tabular-nums ring-1 ring-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500" value={String(value)}
              onChange={(e) => { const x = e.target.value.trim(); onChange(x === '' || Number.isNaN(Number(x)) ? x : Number(x)); }} />
            <button type="button" aria-label={`${f.label} more`} disabled={b.max != null && Number(value) >= b.max} onClick={() => onChange(clamp(Number(value) + step))} className="h-9 w-9 rounded-lg bg-white text-lg font-bold text-brand-700 ring-1 ring-slate-200 disabled:opacity-40">+</button>
          </div>}
        </>}
    </div>
  );
}

function ChangeList({ ruleKey }: { ruleKey?: string }) {
  const [rows, setRows] = useState<RuleChange[] | null>(null); const [err, setErr] = useState<unknown>(null);
  useEffect(() => { let live = true; fetchRuleChanges(ruleKey).then((x) => live && setRows(x)).catch((e) => live && setErr(e)); return () => { live = false; }; }, [ruleKey]);
  if (err) return <ErrorBox error={err} />;
  if (!rows) return <Spinner />;
  if (!rows.length) return <p className="text-[12px] text-slate-500">{ruleKey ? 'No change yet.' : 'No rule has been changed yet.'}</p>;
  return (
    <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
      {rows.map((c) => (
        <li key={c.id} className="px-3 py-2 text-[12px]">
          {!ruleKey && <b className="block text-slate-800">{ruleDef(c.key)?.label ?? c.key}{c.key.split('.').length > 2 ? ` · ${c.key.split('.').slice(2).join('.').replace(/_/g, ' ')}` : ''}</b>}
          <span className="tabular-nums text-slate-700">{pillOf(c.key, c.oldValue)} → <b>{pillOf(c.key, c.newValue)}</b></span>
          <span className="block text-slate-600">“{c.reason}”</span>
          <span className="block text-[11px] text-slate-500">{when(c.at)}{c.by ? ` · ${c.by}` : ''}</span>
        </li>
      ))}
    </ul>
  );
}
