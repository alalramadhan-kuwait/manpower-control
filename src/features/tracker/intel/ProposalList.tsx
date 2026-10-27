// The review list of update intelligence: one compact row per proposal, expandable; Apply · Edit · Dismiss · Source.
// One tap applies an ordinary permitted change (a step time, a status line, drums, a planning figure); a new step, a
// defect or a hold opens for a look first (the name or the reason can be edited); nothing safety-critical is changed here.
import { useState } from 'react';
import { CLASS_LABEL, DEPT_SHORT } from '@/core/tracker/intel';
import { applyProposal, reviewProposal, type ProposalRow } from '@/data/trackerIntel';
import type { TrackerData } from '@/data/tracker';
import { Button, ErrorBox, cx } from '@/ui/components';

const KW = 3 * 36e5;
export const when = (iso: string) => { const d = new Date(Date.parse(iso) + KW); return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const DOT: Record<string, string> = { ready: 'bg-status-green', review: 'bg-amber-500', conflict: 'bg-status-red', info: 'bg-slate-300', applied: 'bg-brand-500', dismissed: 'bg-slate-200' };
const STATUS_WORD: Record<string, string> = { older: 'Older', ready: 'Ready', review: 'Review', conflict: 'Conflict', info: 'Info', applied: 'Applied', dismissed: 'Dismissed' };
const TYPE_ICON: Record<string, string> = { finish_step: '✓', start_step: '▶', status_line: '✎', drums: '🛢', new_step: '＋', defect: '⚠', hold: '⛔', hold_release: '▶', risk: '◔', planning: '％', info: 'ℹ', review: '?' };
const editable = (p: ProposalRow) => p.type === 'status_line' || p.type === 'new_step' || p.type === 'defect' || p.type === 'hold';
const canApply = (p: ProposalRow) => ['finish_step', 'start_step', 'status_line', 'drums', 'new_step', 'defect', 'hold', 'hold_release', 'planning'].includes(p.type) && (p.status === 'ready' || p.status === 'review' || p.status === 'conflict');

type Pick = { checked: boolean; toggle: () => void };
export function ProposalRowView({ p, d, canEdit, onDone, defaultOpen = false, pick }: { p: ProposalRow; d: TrackerData; canEdit: boolean; onDone: (msg: string) => void; defaultOpen?: boolean; pick?: Pick }) {
  const [open, setOpen] = useState(defaultOpen);
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [src, setSrc] = useState(false);
  const field = p.type === 'status_line' ? 'remark' : p.type === 'hold' ? 'pendingReason' : 'title';
  const initial = p.type === 'status_line' ? (p.proposed.remark as string) : p.type === 'hold' ? (p.proposed.pendingReason as string) : (p.newStep?.title ?? (p.proposed.title as string) ?? '');
  async function apply() {
    setBusy(true); setErr(null);
    try { const ref = await applyProposal(d, p, edit !== null ? { [field]: edit } : {}); onDone(`${p.tag ?? 'Plan'}: applied · ${ref}`); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function dismiss() {
    const note = window.prompt('Dismiss: why? (kept with the proposal)', '') ?? null; if (note === null) return;
    setBusy(true); setErr(null);
    try { await reviewProposal(p.id, 'dismissed', note || 'dismissed'); onDone(`${p.tag ?? 'Proposal'}: dismissed.`); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const done = p.status === 'applied' || p.status === 'dismissed';
  return (
    <div className={cx('px-3 py-1.5', done && 'opacity-70')}>
      <button type="button" aria-pressed={pick ? pick.checked : undefined} onClick={() => (pick ? pick.toggle() : setOpen((x) => !x))} className="flex min-h-9 w-full items-start gap-2 text-left">
        {pick ? <span aria-hidden className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[12px] font-bold ring-1', pick.checked ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-transparent ring-slate-300')}>✓</span>
          : <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[p.status])} />}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold leading-snug text-slate-900"><span className="mr-1 text-slate-500">{TYPE_ICON[p.type]}</span>{p.title}</span>
          <span className="block truncate text-[11px] text-slate-500">{CLASS_LABEL[p.classification]} · {DEPT_SHORT[p.department]} {p.reportDate}{p.issues.length ? ` · ${p.issues[0]}` : ''}{p.status === 'applied' && p.appliedRef ? ` · ${p.appliedRef}` : ''}</span>
        </span>
        <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold', p.status === 'ready' ? 'bg-green-100 text-green-900' : p.status === 'review' ? 'bg-amber-100 text-amber-900' : p.status === 'conflict' ? 'bg-red-100 text-red-900' : p.status === 'applied' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600')}>{STATUS_WORD[(p as { superseded?: boolean }).superseded ? 'older' : p.status]}</span>
      </button>
      {open && !pick && (
        <div className="mb-1 ml-4 space-y-1.5 text-[12px] text-slate-700">
          {p.detail && <p>{p.detail}</p>}
          {p.reason && <p className="text-slate-500">Why: {p.reason}</p>}
          {p.issues.length > 0 && <ul className="text-red-800">{p.issues.map((i) => <li key={i}>⚠ {i}</li>)}</ul>}
          {p.newStep && <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px]">
            <dt className="text-slate-500">Step</dt><dd className="font-semibold">{edit ?? p.newStep.title}</dd>
            <dt className="text-slate-500">After</dt><dd>{p.newStep.after ?? '—'}</dd><dt className="text-slate-500">Before</dt><dd>{p.newStep.before ?? '—'}</dd>
            <dt className="text-slate-500">Owner</dt><dd>{p.newStep.owner ?? '—'}</dd><dt className="text-slate-500">Ops action</dt><dd>{p.newStep.opsAction ? 'yes' : 'no'}</dd>
            <dt className="text-slate-500">Duration</dt><dd>{p.newStep.durationH ?? 'not estimated'}</dd><dt className="text-slate-500">Schedule</dt><dd>{p.newStep.scheduleEffect}</dd></dl>}
          {edit !== null && <input className="input py-1 text-[13px]" value={edit} onChange={(e) => setEdit(e.target.value)} placeholder={p.type === 'hold' ? 'Reason of the hold' : p.type === 'status_line' ? 'Status line' : 'Step name'} />}
          {src && <ul className="rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600">{p.evidence.map((e) => <li key={e}>{e}</li>)}</ul>}
          {p.reviewNote && <p className="text-[11px] text-slate-500">Review: {p.reviewNote}{p.reviewedBy ? ` · ${p.reviewedBy}` : ''}{p.reviewedAt ? ` · ${when(p.reviewedAt)}` : ''}</p>}
          {err != null && <ErrorBox error={err} />}
          <div className="flex flex-wrap gap-1.5">
            {canEdit && canApply(p) && <Button className="min-h-8 px-3 text-[12px]" disabled={busy} onClick={apply}>{busy ? 'Saving…' : p.status === 'conflict' ? 'Apply anyway' : 'Apply'}</Button>}
            {canEdit && canApply(p) && editable(p) && edit === null && <Button variant="secondary" className="min-h-8 px-3 text-[12px]" disabled={busy} onClick={() => setEdit(initial)}>Edit</Button>}
            {canEdit && !done && <Button variant="ghost" className="min-h-8 px-2 text-[12px]" disabled={busy} onClick={dismiss}>Dismiss</Button>}
            <Button variant="ghost" className="min-h-8 px-2 text-[12px]" onClick={() => setSrc((x) => !x)}>{src ? 'Hide source' : 'View source'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Proposals grouped by item, in one box. Select (owner, 27 Oct 2026): tick several rows, or a whole group, then Apply
 *  or Dismiss them together. Apply takes only what one tap could apply (a conflict still needs its own "Apply anyway"). */
export function ProposalList({ rows, d, canEdit, onDone, openAll = false }: { rows: ProposalRow[]; d: TrackerData; canEdit: boolean; onDone: (msg: string) => void; openAll?: boolean }) {
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);
  if (!rows.length) return <p className="rounded-xl bg-white px-3 py-2 text-[12px] text-slate-500 ring-1 ring-slate-200">Nothing here.</p>;
  const tags = [...new Set(rows.map((r) => r.tag ?? '—'))];
  const open = (p: ProposalRow) => p.status !== 'applied' && p.status !== 'dismissed';
  const pickable = rows.filter(open);
  const chosen = pickable.filter((p) => sel.has(p.id));
  const applicable = chosen.filter((p) => canApply(p) && p.status !== 'conflict');
  const toggle = (ids: string[], on: boolean) => setSel((s) => { const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; });
  const stop = () => { setSelecting(false); setSel(new Set()); };
  async function bulk(kind: 'apply' | 'dismiss') {
    // in the order things happened: a later report's change lands last
    const list = [...(kind === 'apply' ? applicable : chosen)].sort((a, b) => Date.parse(a.eventAt) - Date.parse(b.eventAt)); if (!list.length) return;
    setBusy(kind === 'apply' ? 'Applying…' : 'Dismissing…'); setErr(null); let ok = 0; const bad: string[] = [];
    for (const p of list) {
      try { if (kind === 'apply') await applyProposal(d, p); else await reviewProposal(p.id, 'dismissed', 'dismissed with others'); ok++; }
      catch (e) { bad.push(`${p.tag ?? p.title}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    setBusy(null); if (bad.length) setErr(new Error(bad.join('\n'))); else stop();
    onDone(kind === 'apply' ? `${ok} change${ok === 1 ? '' : 's'} applied${bad.length ? `, ${bad.length} not` : ''}.` : `${ok} dismissed${bad.length ? `, ${bad.length} not` : ''}.`);
  }
  return (
    <div className="space-y-1.5">
      {canEdit && pickable.length > 1 && <div className="flex items-center justify-end gap-2 text-[12px]">
        {selecting && <button type="button" onClick={() => toggle(pickable.map((p) => p.id), chosen.length < pickable.length)} className="min-h-8 rounded-lg px-2 font-semibold text-brand-700">{chosen.length < pickable.length ? `Select all ${pickable.length}` : 'Clear'}</button>}
        <button type="button" aria-pressed={selecting} onClick={() => (selecting ? stop() : setSelecting(true))} className={cx('min-h-8 rounded-lg px-2.5 font-semibold ring-1', selecting ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200')}>{selecting ? 'Done' : '☑ Select'}</button>
      </div>}
      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {tags.map((t) => { const group = rows.filter((r) => (r.tag ?? '—') === t), gp = group.filter(open), all = gp.length > 0 && gp.every((p) => sel.has(p.id));
          return (
          <div key={t}>
            {(tags.length > 1 || selecting) && <div className="flex items-center bg-slate-50 px-3 py-1">
              <p className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{t === '—' ? 'Not on an item' : t}</p>
              {selecting && gp.length > 0 && <button type="button" onClick={() => toggle(gp.map((p) => p.id), !all)} className="min-h-7 text-[11px] font-bold text-brand-700">{all ? 'Clear group' : `Select ${gp.length}`}</button>}
            </div>}
            {group.map((p) => <ProposalRowView key={p.id} p={p} d={d} canEdit={canEdit} onDone={onDone} defaultOpen={openAll}
              pick={selecting && open(p) ? { checked: sel.has(p.id), toggle: () => toggle([p.id], !sel.has(p.id)) } : undefined} />)}
          </div>); })}
      </div>
      {selecting && chosen.length > 0 && (
        <div role="toolbar" aria-label="Selected updates" className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[60] mx-auto max-w-md space-y-1.5 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-slate-200 sm:bottom-6">
          {err != null && <ErrorBox error={err} />}
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 px-1 text-[12px] font-semibold text-slate-700">{chosen.length} selected{applicable.length < chosen.length ? <span className="block text-[11px] font-normal text-slate-500">{applicable.length} can be applied</span> : null}</span>
            <Button className="min-h-9 px-3 text-[12px]" disabled={!!busy || applicable.length === 0} onClick={() => bulk('apply')}>{busy === 'Applying…' ? busy : `Apply ${applicable.length}`}</Button>
            <Button variant="secondary" className="min-h-9 px-3 text-[12px]" disabled={!!busy} onClick={() => bulk('dismiss')}>{busy === 'Dismissing…' ? busy : `Dismiss ${chosen.length}`}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
