// Ask for updates: the items with work running (or due) and no update for a while, as one WhatsApp request, for the
// main equipment or the small jobs. Each line can be left out before sending; an item drops off once it is updated.
import { useMemo, useState } from 'react';
import { Copy, MessageCircle } from 'lucide-react';
import { STALE_H, askText, staleItems } from '@/core/tracker';
import type { TrackerData } from '@/data/tracker';
import { Button, cx } from '@/ui/components';

type Scope = 'main' | 'small' | 'all';
const SCOPES: [Scope, string][] = [['main', 'Main equipment'], ['small', 'Small jobs'], ['all', 'All']];

export function AskUpdates({ data, now, by }: { data: TrackerData; now: number; by: string }) {
  const all = useMemo(() => staleItems(data, now), [data, now]);
  const [scope, setScope] = useState<Scope>('main');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const items = all.filter((i) => scope === 'all' || (scope === 'small') === i.small);
  const picked = items.filter((i) => !off.has(i.key));
  const text = askText(picked, now, { name: `${data.tracker.title}${scope === 'all' ? '' : scope === 'main' ? ' · Main equipment' : ' · Small jobs'}`, test: data.tracker.mode === 'test', by });
  const wa = (data.settings.whatsapp ?? '').replace(/\D/g, '');
  const normal = data.settings.staleH ?? STALE_H.normal;
  const count = (s: Scope) => all.filter((i) => s === 'all' || (s === 'small') === i.small).length;
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">{SCOPES.map(([s, l]) => (
        <button key={s} type="button" onClick={() => setScope(s)} className={cx('min-h-9 rounded-full px-3 text-xs font-semibold', scope === s ? 'bg-[#0d2a5e] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}>{l} ({count(s)})</button>))}
      </div>
      <p className="text-xs text-slate-600">Work running or due with no update for <b>{normal} h</b> (critical-path items {STALE_H.critical} h, small jobs {STALE_H.small} h). Untick a line to leave it out.</p>
      {items.length === 0 ? <p className="rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-800 ring-1 ring-green-200">✓ Everything here has a recent update.</p> : <>
        <div className="grid grid-cols-2 gap-2">
          <a href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" aria-disabled={!picked.length}
            className={cx('inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 text-sm font-medium text-white', !picked.length && 'pointer-events-none opacity-50')}><MessageCircle className="h-4 w-4" />WhatsApp ({picked.length})</a>
          <Button variant="secondary" disabled={!picked.length} onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ } }}><Copy className="h-4 w-4" />{copied ? 'Copied' : 'Copy text'}</Button>
        </div>
        <ul className="divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">{items.map((i) => (
          <li key={i.key}><label className="flex cursor-pointer items-start gap-2.5 px-3 py-2">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={!off.has(i.key)} onChange={() => setOff((s) => { const n = new Set(s); if (n.has(i.key)) n.delete(i.key); else n.add(i.key); return n; })} />
            <span className="min-w-0 flex-1 text-[13px]"><b>{i.critical && '⏱ '}{i.tag}</b> <span className="text-slate-500">· {i.section}</span>
              <span className="block text-[12px] text-slate-600">{i.status}</span></span>
            <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold', i.ageH >= i.limitH * 2 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900')}>{i.ageH} h</span>
          </label></li>))}
        </ul>
        <details open><summary className="cursor-pointer text-xs font-semibold text-slate-600">Message text</summary><pre className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs">{text}</pre></details>
      </>}
    </div>
  );
}
