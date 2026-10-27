// Updates by item (owner, 27 Oct 2026): every line of a report is either part of an existing step (the step starts or
// finishes; the card says how much the progress moves) or a missing step to add. One card per item; the status line rides
// with the card. Cards that need a look first (a missing step, a hold, a conflict) come before the ready ones.
import { useMemo, useState } from 'react';
import { phases } from '@/core/tracker';
import { DEPT_SHORT } from '@/core/tracker/intel';
import { applyProposal, reviewProposal, type ProposalRow } from '@/data/trackerIntel';
import type { TrackerData } from '@/data/tracker';
import { ErrorBox, cx } from '@/ui/components';
import { ProposalList, when } from './ProposalList';

export type Card = { tag: string; rows: ProposalRow[]; look: boolean };
const OPEN = new Set(['ready', 'review', 'conflict']);
const STEP = new Set(['start_step', 'finish_step']);
const MISSING = new Set(['new_step', 'defect']);
const LOOK = new Set(['new_step', 'defect', 'hold', 'risk']);
/** What one tap may apply on a card: the ready step, count, status, hold-release and planning changes (never a conflict,
 *  never a missing step: those are added one by one). */
export const cardApplicable = (p: ProposalRow) => p.status === 'ready' && ['start_step', 'finish_step', 'status_line', 'drums', 'hold_release', 'planning'].includes(p.type);

/** Open proposals into item cards; everything else (notes, older statuses, lines on no item) is left for the notes. */
export function toCards(rows: ProposalRow[]): { cards: Card[]; notes: ProposalRow[] } {
  const by = new Map<string, ProposalRow[]>(); const notes: ProposalRow[] = [];
  for (const p of rows) {
    if (!OPEN.has(p.status)) { if (p.status === 'info') notes.push(p); continue; }
    const tag = p.tag ?? (p.type === 'planning' ? 'Maintenance Planning' : null);
    // neither a step to move nor a missing step (an item not in this tracker, an unclear line, readiness): a note
    if (!tag || p.type === 'review') { notes.push(p); continue; }
    by.set(tag, [...(by.get(tag) ?? []), p]);
  }
  const cards = [...by].map(([tag, rs]) => ({ tag, rows: rs.sort((a, b) => Date.parse(a.eventAt) - Date.parse(b.eventAt)),
    look: rs.some((p) => LOOK.has(p.type) || p.status !== 'ready') }));
  cards.sort((a, b) => Number(b.look) - Number(a.look) || a.tag.localeCompare(b.tag));
  return { cards, notes };
}

type Pct = { item: number | null; total: number | null };
/** The progress before, after applying the card, and once its started steps finish (the tracker's own calculation). */
function cardProgress(d: TrackerData, c: Card): string | null {
  const steps = c.rows.filter((p) => STEP.has(p.type) && p.activityId);
  if (!steps.length) return c.rows.some((p) => MISSING.has(p.type)) ? 'No progress change until the added step has plan hours.' : null;
  const now = Date.now(), t = new Date(now).toISOString();
  const key = steps[0].key;
  const snap = (x: TrackerData): Pct => { const w = phases(x, now).mi.weighted; const it = w?.items.find((i) => i.key === key || i.tag === c.tag); return { item: it?.physPct ?? null, total: w?.actualPct ?? null }; };
  const patched = (finishAll: boolean) => ({ ...d, activities: d.activities.map((a) => {
    const p = steps.find((s) => s.activityId === a.id); if (!p) return a;
    const fin = p.type === 'finish_step' || finishAll;
    return { ...a, actualStart: a.actualStart ?? t, actualFinish: fin ? (a.actualFinish ?? t) : a.actualFinish };
  }) }) as TrackerData;
  const b = snap(d), now1 = snap(patched(false)), done = snap(patched(true));
  const part = (x: Pct, y: Pct) => [x.item != null && y.item != null ? `${c.tag} ${x.item}% → ${y.item}%` : null,
    x.total != null && y.total != null ? (x.total === y.total ? `M & I stays ${x.total}%` : `M & I ${x.total}% → ${y.total}%`) : null].filter(Boolean).join(' · ');
  const moved = now1.item !== b.item || now1.total !== b.total;
  if (moved) return `Progress ${part(b, now1)}`;
  return `No change now · when done ${part(b, done)}`;
}

const line = (p: ProposalRow): { icon: string; text: React.ReactNode } => {
  const name = p.activityName ?? (p.proposed.title as string) ?? '';
  switch (p.type) {
    case 'start_step': return { icon: '▶', text: <>Start <b>{name}</b></> };
    case 'finish_step': return { icon: '✓', text: <>Finish <b>{name}</b></> };
    case 'new_step': return { icon: '＋', text: <>Missing step: <b>{p.newStep?.title ?? name}</b>{p.newStep?.after ? <span className="text-slate-500"> · after "{p.newStep.after}"</span> : null}</> };
    case 'defect': return { icon: '⚠', text: <>Defect, add a step: <b>{p.newStep?.title ?? (p.proposed.title as string) ?? p.title}</b></> };
    case 'drums': return { icon: '🛢', text: <>Drums <b>{Number(p.proposed.total ?? 0).toLocaleString()}</b>{p.current.total != null ? <span className="text-slate-500"> (now {Number(p.current.total).toLocaleString()})</span> : null}</> };
    case 'status_line': return { icon: '✎', text: <span className="text-slate-600">Status: {String(p.proposed.remark ?? '')}</span> };
    case 'hold': return { icon: '⛔', text: <>Hold: <b>{String(p.proposed.pendingReason ?? p.title)}</b></> };
    case 'hold_release': return { icon: '▶', text: <>Hold released</> };
    case 'planning': return { icon: '％', text: <>{p.title}</> };
    default: return { icon: '?', text: <span className="text-slate-600">{p.title}</span> };
  }
};

function ItemCard({ c, d, canEdit, onDone }: { c: Card; d: TrackerData; canEdit: boolean; onDone: (m: string) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null); const [details, setDetails] = useState(false);
  const progress = useMemo(() => cardProgress(d, c), [d, c]);
  const ready = c.rows.filter(cardApplicable);
  const src = c.rows[c.rows.length - 1];
  async function run(list: ProposalRow[], kind: 'apply' | 'dismiss', msg: string) {
    setBusy(true); setErr(null); const bad: string[] = [];
    for (const p of list) { try { if (kind === 'apply') await applyProposal(d, p); else await reviewProposal(p.id, 'dismissed', 'dismissed with its item'); } catch (e) { bad.push(`${p.title}: ${e instanceof Error ? e.message : String(e)}`); } }
    setBusy(false); if (bad.length) setErr(new Error(bad.join('\n'))); onDone(msg);
  }
  return (
    <div className="space-y-1.5 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
      <div className="flex items-center gap-2">
        <b className="text-[15px]">{c.tag}</b>
        <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-bold', c.look ? (c.rows.some((p) => p.status === 'conflict') ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900') : 'bg-green-100 text-green-900')}>
          {c.rows.some((p) => p.status === 'conflict') ? 'Conflict' : c.rows.some((p) => MISSING.has(p.type)) ? 'Missing step' : c.look ? 'Check' : 'Ready'}</span>
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-slate-500">{DEPT_SHORT[src.department]} {when(src.eventAt)}</span>
      </div>
      <ul className="space-y-1">
        {c.rows.map((p) => { const l = line(p); return (
          <li key={p.id} className="flex items-start gap-2 text-[13px] leading-snug">
            <span className="w-4 shrink-0 text-center text-slate-500">{l.icon}</span>
            <span className="min-w-0 flex-1">{l.text}{p.status === 'conflict' && p.issues[0] ? <span className="block text-[11px] text-status-red">⚠ {p.issues[0]}</span> : null}</span>
            {canEdit && MISSING.has(p.type) && <button type="button" disabled={busy} onClick={() => run([p], 'apply', `${c.tag}: applied · step added`)} className="shrink-0 rounded-lg bg-brand-700 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50">Add</button>}
          </li>); })}
      </ul>
      {progress && <p className="rounded-lg bg-brand-50 px-2 py-1 text-[12px] font-semibold tabular-nums text-brand-800">{progress}</p>}
      {err != null && <ErrorBox error={err} />}
      <div className="flex gap-1.5">
        {canEdit && ready.length > 0 && <button type="button" disabled={busy} onClick={() => run(ready, 'apply', `${c.tag}: applied · ${ready.length} change${ready.length === 1 ? '' : 's'}`)} className="min-h-9 flex-1 rounded-xl bg-brand-700 text-[13px] font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : c.look ? `Apply the rest (${ready.length})` : ready.length === 1 ? 'Apply' : `Apply ${ready.length}`}</button>}
        <button type="button" onClick={() => setDetails((x) => !x)} className="min-h-9 flex-1 rounded-xl bg-white text-[13px] font-bold text-brand-700 ring-1 ring-slate-300">{details ? 'Hide details' : 'Details'}</button>
        {canEdit && <button type="button" disabled={busy} onClick={() => run(c.rows, 'dismiss', `${c.tag}: dismissed.`)} className="min-h-9 rounded-xl px-3 text-[13px] font-semibold text-slate-600 ring-1 ring-slate-200 disabled:opacity-50">Dismiss</button>}
      </div>
      {details && <ProposalList rows={c.rows} d={d} canEdit={canEdit} onDone={onDone} />}
    </div>
  );
}

/** The two sections: Need your look, Ready to apply (with Apply all). */
export function ItemCards({ cards, d, canEdit, onDone, show, applyAll: withAll = true }: { cards: Card[]; d: TrackerData; canEdit: boolean; onDone: (m: string) => void; show: 'all' | 'look' | 'ready'; applyAll?: boolean }) {
  const look = cards.filter((c) => c.look), ready = cards.filter((c) => !c.look);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  async function applyAll() {
    const list = ready.flatMap((c) => c.rows.filter(cardApplicable)).sort((a, b) => Date.parse(a.eventAt) - Date.parse(b.eventAt));
    setBusy(true); setErr(null); let ok = 0; const bad: string[] = [];
    for (const p of list) { try { await applyProposal(d, p); ok++; } catch (e) { bad.push(`${p.title}: ${e instanceof Error ? e.message : String(e)}`); } }
    setBusy(false); if (bad.length) setErr(new Error(bad.join('\n')));
    onDone(`${ok} change${ok === 1 ? '' : 's'} applied${bad.length ? `, ${bad.length} not` : ''}.`);
  }
  const head = (t: string, n: number, extra?: React.ReactNode) => <div className="flex items-center justify-between px-1 pt-1"><span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t} · {n}</span>{extra}</div>;
  return (
    <div className="space-y-2">
      {show !== 'ready' && look.length > 0 && <>{head('To check', look.length)}{look.map((c) => <ItemCard key={c.tag} c={c} d={d} canEdit={canEdit} onDone={onDone} />)}</>}
      {show !== 'look' && ready.length > 0 && <>{head('Ready to apply', ready.length, withAll && canEdit && ready.length > 1 ? <button type="button" disabled={busy} onClick={applyAll} className="text-[12px] font-bold text-brand-700 disabled:opacity-50">{busy ? 'Applying…' : 'Apply all'}</button> : null)}
        {err != null && <ErrorBox error={err} />}
        {ready.map((c) => <ItemCard key={c.tag} c={c} d={d} canEdit={canEdit} onDone={onDone} />)}</>}
      {!cards.length && <p className="rounded-xl bg-white px-3 py-2 text-[12px] text-slate-500 ring-1 ring-slate-200">Nothing to apply. Paste a report to read it.</p>}
    </div>
  );
}

/** What a whole report does to the M & I progress if its ready changes are applied, and once the steps it starts finish. */
export function reportProgress(d: TrackerData, rows: ProposalRow[]): string | null {
  const steps = rows.filter((p) => cardApplicable(p) && STEP.has(p.type) && p.activityId);
  if (!steps.length) return null;
  const now = Date.now(), t = new Date(now).toISOString();
  const total = (x: TrackerData) => phases(x, now).mi.weighted?.actualPct ?? null;
  const patched = (finishAll: boolean) => ({ ...d, activities: d.activities.map((a) => {
    const p = steps.find((s) => s.activityId === a.id); if (!p) return a;
    return { ...a, actualStart: a.actualStart ?? t, actualFinish: p.type === 'finish_step' || finishAll ? (a.actualFinish ?? t) : a.actualFinish };
  }) }) as TrackerData;
  const b = total(d), a = total(patched(false)), w = total(patched(true));
  if (b == null || a == null || w == null) return null;
  const starts = steps.filter((p) => p.type === 'start_step').length, fins = steps.length - starts;
  return `This report: ${fins} step${fins === 1 ? '' : 's'} finish, ${starts} start · M & I ${a === b ? `stays ${b}%` : `${b}% → ${a}%`} if applied${w !== a ? ` · ${w}% when the started steps finish` : ''}`;
}
