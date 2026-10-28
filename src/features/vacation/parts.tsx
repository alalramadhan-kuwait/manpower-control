// Small shared pieces of the vacation planning workspace: status chip, section header, dates, toast state.
import { clock12 } from '@/core/clock';
import { AlertTriangle, Check, OctagonX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Toast, cx } from '@/ui/components';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "4 Jan" */
export const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
/** "4–11 Jan" or "29 Jan – 5 Feb" */
export const span = (a: string, b: string) => (a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8))}–${dm(b)}` : `${dm(a)} – ${dm(b)}`);
/** "27 Oct 14:05" (Kuwait time) */
export const stamp = (iso: string) => { const d = new Date(Date.parse(iso) + 3 * 3600_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${clock12(iso)}`; };

export type Level = 'ok' | 'warning' | 'error';
const LV: Record<Level, { cls: string; label: string; Icon: typeof Check }> = {
  ok: { cls: 'bg-green-100 text-green-800', label: 'Ready', Icon: Check },
  warning: { cls: 'bg-amber-100 text-amber-900', label: 'Review', Icon: AlertTriangle },
  error: { cls: 'bg-red-100 text-red-800', label: 'Blocked', Icon: OctagonX }
};
/** Green / amber / red with an icon and a word (never colour alone). */
export function StatusChip({ level, label, className }: { level: Level; label?: string; className?: string }) {
  const s = LV[level];
  return <span className={cx('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-px text-[11px] font-bold', s.cls, className)}><s.Icon className="h-3 w-3" aria-hidden />{label ?? s.label}</span>;
}
export const levelOf = (issues: { level: 'error' | 'warning' }[]): Level => (issues.some((i) => i.level === 'error') ? 'error' : issues.length ? 'warning' : 'ok');

export function SectionHead({ title, right }: { title: ReactNode; right?: ReactNode }) {
  return <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-500"><span className="min-w-0 flex-1">{title}</span>{right}</div>;
}

/** One toast at a time, with Undo when given; disappears after 7 s (3 s without Undo). */
export function useToast() {
  const [t, setT] = useState<{ msg: string; undo?: () => void } | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((msg: string, undo?: () => void) => {
    setT({ msg, undo });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setT(null), undo ? 7000 : 3000);
  }, []);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const el = t ? <Toast msg={t.msg} onUndo={t.undo ? () => { setT(null); t.undo!(); } : undefined} /> : null;
  return { show, el };
}
