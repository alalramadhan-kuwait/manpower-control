import { useMemo, useState } from 'react';
import type { ImportPlan, Outcome, StagedRow } from '@/core/import';
import { Button, Card, Chip, cx } from '@/ui/components';
import type { Tone } from '@/ui/components';

export const OUTCOME_META: Record<Outcome, { label: string; tone: Tone }> = {
  new: { label: 'New', tone: 'green' }, changed: { label: 'Changed', tone: 'blue' }, unchanged: { label: 'Unchanged', tone: 'neutral' },
  unmatched: { label: 'Unmatched', tone: 'red' }, ignored_out_of_scope: { label: 'Ignored (outside Section 1)', tone: 'neutral' },
  review: { label: 'Needs review', tone: 'amber' }, error: { label: 'Error', tone: 'red' }
};
export const KIND_LABEL: Record<string, string> = {
  employee: 'Employee', role_assignment: 'Role / crew', qualification: 'Qualification', leave_record: 'Leave', performance: 'Performance', sick_total: 'Sick leave total', note: 'Note'
};

export function PlanPreview({ plan, detection, onCancel, onConfirm }: { plan: ImportPlan; detection: string; onCancel: () => void; onConfirm: () => void }) {
  const s = plan.summary;
  const blocking = s.errors > 0;
  const tiles: [string, number, Tone][] = [
    ['Employees matched', s.employeesChanged + s.employeesUnchanged, 'neutral'], ['Employee records changed', s.employeesChanged, 'blue'], ['New employees', s.employeesNew, 'green'],
    ['Unmatched', s.unmatched, s.unmatched ? 'red' : 'neutral'], ['Ignored outside Section 1', s.ignored, 'neutral'], ['Needs review', s.review, s.review ? 'amber' : 'neutral'],
    ['Leave added (marked on the monthly sheets)', s.pvAdded, 'green'], ['Leave moved or trimmed to the marked days', s.pvRescheduled, s.pvRescheduled ? 'amber' : 'neutral'], ['Planned leave not taken', s.pvNotTaken, s.pvNotTaken ? 'amber' : 'neutral'], ['Leave cancelled', s.pvCancelled, s.pvCancelled ? 'amber' : 'neutral'], ['New unresolved absences', s.unresolvedNew, s.unresolvedNew ? 'amber' : 'neutral'], ['Leave dates to update', s.leaveChanged - s.pvRescheduled - s.pvCancelled - s.pvNotTaken, 'neutral'], ['Role assignments', s.roleAssignmentsNew, 'neutral'], ['Errors', s.errors, s.errors ? 'red' : 'neutral']
  ];
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Chip tone="blue">{plan.importType === 'promotion_master' ? 'Promotion master' : 'U-12 manpower workbook'}</Chip>
          <span className="truncate font-medium text-slate-800">{plan.fileName}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500">Identified by: {detection}{plan.sourceAsOfDate ? ` · as of ${plan.sourceAsOfDate}` : ''}{plan.periodStart ? ` · ${plan.periodStart} → ${plan.periodEnd}` : ''}</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {tiles.map(([l, v, t]) => (
            <div key={l} className="rounded-xl bg-slate-50 p-2 text-center"><div className={cx('text-lg font-semibold tabular-nums', t === 'red' ? 'text-status-red' : t === 'amber' ? 'text-status-amber' : t === 'green' ? 'text-status-green' : 'text-brand-800')}>{v}</div><div className="text-[11px] leading-tight text-slate-500">{l}</div></div>
          ))}
        </div>
        {plan.warnings.length > 0 && (
          <details className="mt-3 text-xs"><summary className="cursor-pointer text-amber-800">{plan.warnings.length} warning(s) from parsing</summary><ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-600">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
        )}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1" disabled={blocking} onClick={onConfirm}>{blocking ? 'Fix errors first' : 'Confirm and update database'}</Button>
        </div>
      </Card>
      <RowBrowser rows={plan.rows} />
    </div>
  );
}

export function RowBrowser({ rows, initial = 'review' }: { rows: StagedRow[]; initial?: Outcome | 'all' }) {
  const counts = useMemo(() => { const c: Partial<Record<Outcome, number>> = {}; for (const r of rows) c[r.outcome] = (c[r.outcome] ?? 0) + 1; return c; }, [rows]);
  const order: Outcome[] = ['review', 'error', 'unmatched', 'new', 'changed', 'ignored_out_of_scope', 'unchanged'];
  const available = order.filter((o) => counts[o]);
  const [tab, setTab] = useState<Outcome | 'all'>(available.includes(initial as Outcome) ? initial : (available[0] ?? 'all'));
  const [kind, setKind] = useState<string>('');
  const shown = rows.filter((r) => (tab === 'all' || r.outcome === tab) && (!kind || r.entity_kind === kind)).slice(0, 400);
  const kinds = Array.from(new Set(rows.filter((r) => tab === 'all' || r.outcome === tab).map((r) => r.entity_kind)));
  return (
    <Card className="p-0">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 p-2 [scrollbar-width:none]">
        {available.map((o) => <button key={o} type="button" onClick={() => { setTab(o); setKind(''); }} className={cx('shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1', tab === o ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{OUTCOME_META[o].label} · {counts[o]}</button>)}
        <button type="button" onClick={() => { setTab('all'); setKind(''); }} className={cx('shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ring-1', tab === 'all' ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>All · {rows.length}</button>
      </div>
      {kinds.length > 1 && (
        <div className="flex gap-1 overflow-x-auto px-2 pt-2 [scrollbar-width:none]">
          <button type="button" onClick={() => setKind('')} className={cx('shrink-0 rounded-md px-2 py-1 text-[11px]', !kind ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600')}>All kinds</button>
          {kinds.map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={cx('shrink-0 rounded-md px-2 py-1 text-[11px]', kind === k ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600')}>{KIND_LABEL[k] ?? k}</button>)}
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {shown.map((r) => <li key={r.seq} className="px-3 py-2.5"><RowLine row={r} /></li>)}
        {shown.length === 0 && <li className="p-6 text-center text-sm text-slate-500">Nothing in this group.</li>}
        {shown.length === 400 && <li className="p-3 text-center text-xs text-slate-500">Showing the first 400 rows.</li>}
      </ul>
    </Card>
  );
}

export interface RowLineProps { outcome: string; entity_kind: string; employee_number: string | null; sheet: string | null; row_ref: string | null; message: string | null; diff: Record<string, { from: unknown; to: unknown }> | null; payload: Record<string, unknown> | null; raw: Record<string, unknown> | null }
export function RowLine({ row }: { row: RowLineProps }) {
  const meta = OUTCOME_META[row.outcome as Outcome] ?? OUTCOME_META.unchanged;
  const name = (row.raw as Record<string, unknown> | null)?.name ?? (row.payload as Record<string, unknown> | null)?.short_name ?? (row.raw as Record<string, unknown> | null)?.fullName;
  const payload = row.payload as Record<string, unknown> | null;
  const auto = row.entity_kind === 'leave_record' && payload?.start_date ? `${payload.status === 'unresolved' ? 'Unresolved absence' : 'Planned annual leave'} ${payload.start_date} → ${payload.end_date}` : null;
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone={meta.tone}>{meta.label}</Chip>
        <Chip>{KIND_LABEL[row.entity_kind] ?? row.entity_kind}</Chip>
        {row.employee_number && <span className="font-mono text-xs text-slate-600">#{row.employee_number}</span>}
        {typeof name === 'string' && <span className="truncate text-xs text-slate-700">{name}</span>}
        <span className="ml-auto text-[11px] text-slate-400">{[row.sheet, row.row_ref].filter(Boolean).join(' · ')}</span>
      </div>
      {(row.message || auto) && <p className="mt-1 text-slate-700">{row.message ?? auto}</p>}
      {row.diff && Object.keys(row.diff).length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {Object.entries(row.diff).map(([k, v]) => <li key={k} className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600"><span className="font-medium">{k.replace(/_/g, ' ')}</span>: {String(v.from ?? '—')} → {String(v.to ?? '—')}</li>)}
        </ul>
      )}
    </div>
  );
}
