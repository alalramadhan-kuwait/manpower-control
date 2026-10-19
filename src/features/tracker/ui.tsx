// Shared look of the progress tracker: the status colours of the module plan (§9), chips and the stage bar.
import type { ReactNode } from 'react';
import { STAGE_SHORT, type Flag, type StepState } from '@/core/tracker';
import { cx } from '@/ui/components';

export const STATE_STYLE: Record<StepState, { bg: string; text: string; label: string }> = {
  WAITING: { bg: 'bg-[#EDEFF2]', text: 'text-slate-600', label: 'Waiting' },
  READY: { bg: 'bg-[#FFE699]', text: 'text-amber-950', label: 'Ready' },
  IN_PROGRESS: { bg: 'bg-[#D6E6F5]', text: 'text-[#004080]', label: 'In progress' },
  PENDING: { bg: 'bg-[#FFC7CE]', text: 'text-red-900', label: 'Pending' },
  DONE: { bg: 'bg-[#C6EFCE]', text: 'text-green-900', label: 'Done' },
  NA: { bg: 'bg-slate-100', text: 'text-slate-500', label: 'N/A' },
};
export const FLAG_STYLE: Record<Flag | 'STEP_LATE' | 'STEP_PENDING', { cls: string; label: string }> = {
  HO_LATE: { cls: 'bg-[#E06666] text-white', label: 'HO LATE' },
  LATE: { cls: 'bg-[#E06666] text-white', label: 'LATE' },
  STEP_LATE: { cls: 'bg-[#E06666] text-white', label: 'LATE' },
  PENDING: { cls: 'bg-[#FFC7CE] text-red-900', label: 'PENDING' },
  STEP_PENDING: { cls: 'bg-[#FFC7CE] text-red-900', label: 'PENDING' },
  IAT_OPEN: { cls: 'bg-[#FFE699] text-amber-950', label: 'IAT OPEN' },
  COMPLETE: { cls: 'bg-[#C6EFCE] text-green-900', label: 'COMPLETE' },
  NOT_HO: { cls: 'bg-[#EDEFF2] text-slate-700', label: 'NOT HO' },
  IN_PROGRESS: { cls: 'bg-[#D6E6F5] text-[#004080]', label: 'IN PROGRESS' },
  NONE: { cls: 'bg-slate-50 text-slate-400', label: '—' },
};
export const FlagChip = ({ flag, className }: { flag: keyof typeof FLAG_STYLE; className?: string }) =>
  <span className={cx('inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide', FLAG_STYLE[flag].cls, className)}>{FLAG_STYLE[flag].label}</span>;
export const StateChip = ({ state, late }: { state: StepState; late?: boolean }) =>
  <span className={cx('inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-bold', late ? 'bg-[#E06666] text-white' : cx(STATE_STYLE[state].bg, STATE_STYLE[state].text))}>{late ? 'LATE' : STATE_STYLE[state].label}</span>;

/** Stage 0–6 as seven segments, the handover segment and the ones after it filled. */
export function StageBar({ stage, className }: { stage: number; className?: string }) {
  return (
    <span className={cx('flex items-center gap-0.5', className)} aria-label={`Stage ${stage}: ${STAGE_SHORT[stage]}`}>
      {[1, 2, 3, 4, 5, 6].map((s) => <span key={s} className={cx('h-1.5 flex-1 rounded-full', s <= stage ? (stage === 6 ? 'bg-[#08A048]' : 'bg-[#0850A0]') : 'bg-slate-200')} />)}
    </span>
  );
}
export function PlanChip({ variance, days, short = false }: { variance: number; days: number; short?: boolean }) {
  if (variance === 0) return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">On plan</span>;
  const ahead = variance > 0;
  return <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-bold', ahead ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800')}>{ahead ? '+' : '−'}{Math.abs(variance)}{short ? '' : ` stage${Math.abs(variance) > 1 ? 's' : ''}`}{days ? ` · ${days} d` : ''}</span>;
}
export const Tile = ({ value, label, tone, onClick }: { value: ReactNode; label: string; tone?: 'red' | 'amber' | 'green'; onClick?: () => void }) => (
  <button type="button" onClick={onClick} className={cx('flex min-h-16 flex-col items-center justify-center rounded-xl bg-white px-1 py-2 ring-1 ring-slate-200 active:scale-[0.98]', !onClick && 'cursor-default')}>
    <span className={cx('text-lg font-bold tabular-nums', tone === 'red' ? 'text-[#E02028]' : tone === 'amber' ? 'text-amber-700' : tone === 'green' ? 'text-[#08A048]' : 'text-slate-900')}>{value}</span>
    <span className="text-[11px] text-slate-500">{label}</span>
  </button>
);
