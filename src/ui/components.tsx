import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function cx(...parts: (string | false | null | undefined)[]) { return parts.filter(Boolean).join(' '); }

export function Button({ children, variant = 'primary', className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const base = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100';
  const v = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800',
    secondary: 'bg-white text-brand-800 ring-1 ring-slate-300 hover:bg-slate-50',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    ghost: 'text-brand-700 hover:bg-brand-50'
  }[variant];
  return <button className={cx(base, v, className)} {...rest}>{children}</button>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Card({ children, className, to }: { children: ReactNode; className?: string; to?: string }) {
  const cls = cx('block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200', to && 'hover:ring-brand-600/50 active:bg-slate-50', className);
  return to ? <Link to={to} className={cls}>{children}</Link> : <div className={cls}>{children}</div>;
}

export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue';
export function Chip({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  const t = {
    neutral: 'bg-slate-100 text-slate-700',
    green: 'bg-green-50 text-green-700 ring-1 ring-green-200',
    amber: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
    red: 'bg-red-50 text-red-700 ring-1 ring-red-200',
    blue: 'bg-brand-50 text-brand-700 ring-1 ring-brand-100'
  }[tone];
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', t, className)}>{children}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-brand-800">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, tone = 'neutral', to }: { label: string; value: ReactNode; tone?: Tone; to?: string }) {
  const color = { neutral: 'text-brand-800', green: 'text-status-green', amber: 'text-status-amber', red: 'text-status-red', blue: 'text-brand-600' }[tone];
  return (
    <Card to={to} className="min-w-0">
      <div className={cx('text-2xl font-semibold tabular-nums', color)}>{value}</div>
      <div className="mt-0.5 truncate text-xs text-slate-600">{label}</div>
    </Card>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {label}</div>;
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {body && <p className="mt-1 text-sm text-slate-500">{body}</p>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return <div role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{msg}</div>;
}

/** Bottom sheet: the mobile editing surface. Renders as a centred dialog on wide screens. */
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl safe-bottom sm:max-w-lg sm:rounded-3xl">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" />
        <h2 className="mb-3 text-lg font-semibold text-brand-800">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value ?? <span className="text-slate-400">—</span>}</span>
    </div>
  );
}

export const qualificationTone = (s: string | null | undefined): Tone => (s === 'yes' ? 'green' : s === 'no' ? 'red' : s === 'not_yet_confirmed' ? 'amber' : 'neutral');
export const qualificationLabel = (s: string | null | undefined) => (s === 'yes' ? 'Yes' : s === 'no' ? 'No' : s === 'not_yet_confirmed' ? 'Not yet confirmed' : 'Not recorded');
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
