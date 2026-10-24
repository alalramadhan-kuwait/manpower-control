// On Today, during a tracked shutdown: one line of its progress (ahead / behind, what needs attention), tap to open.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { attention, bannerText, equipViews, phases, stepViews } from '@/core/tracker';
import { currentTracker, fetchTrackerData, fetchTrackers } from '@/data/tracker';
import { cx } from '@/ui/components';

const DOT = { AHEAD: 'bg-status-green', BEHIND: 'bg-status-red', ON_PLAN: 'bg-amber-500' } as const;

export function TrackerTodayCard({ date, embedded = false }: { date: string; embedded?: boolean }) {
  const [v, setV] = useState<{ id: string; title: string; test: boolean; state: keyof typeof DOT; text: string; att: number; pct: [number, number] | null } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const list = await fetchTrackers();
      const t = currentTracker(list, date);
      if (!t || !t.eventStart || !t.eventEnd || date < t.eventStart || date > t.eventEnd) { if (live) setV(null); return; }
      const d = await fetchTrackerData(t.id); const now = Date.now();
      const steps = stepViews(d, now); const eqs = equipViews(d, now, steps); const { ops, mi } = phases(d, now, steps);
      // operations until R-12-205 is handed over, then M & I
      const state = mi.weighted ? mi.weighted.state : mi.banner ? mi.banner.state : ops && (ops.state === 'AHEAD' || ops.state === 'BEHIND') ? ops.state : 'ON_PLAN';
      const text = mi.weighted ? `M & I ${mi.weighted.actualPct}% of ${mi.weighted.planPct}%` : mi.banner ? `M & I ${bannerText(mi.banner)}` : ops ? `Operations day ${ops.day}/${ops.days} · ${ops.actualPct}% of ${ops.planPct}%` : 'Operations';
      if (live) setV({ id: t.id, title: t.title, test: t.mode === 'test', state, text, att: attention(steps, eqs).length, pct: mi.weighted ? [mi.weighted.actualPct, mi.weighted.planPct] : null });
    })().catch(() => { if (live) setV(null); });
    return () => { live = false; };
  }, [date]);
  if (!v) return null;
  // inside the day's events card: one row, done against plan on a bar (green done, black mark the plan)
  return (
    <Link to={`/progress/${v.id}`} className={embedded ? 'flex items-center gap-2 px-3 py-2' : 'mb-3 flex items-center gap-3 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-slate-200'}>
      <span className={cx('h-3 w-3 shrink-0 rounded-full', DOT[v.state], embedded && 'mx-1.5')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{v.test ? '[TEST] ' : ''}{embedded && v.pct ? <>{v.title.replace(/^U-12 /, '')} · M & I {v.pct[0]}% <span className="font-normal text-slate-500">plan {v.pct[1]}%{v.att ? ` · ${v.att} need${v.att === 1 ? 's' : ''} attention` : ''}</span></> : <>{v.title} · {v.text}</>}</span>
        {embedded && v.pct ? <span className="relative mt-1 block h-1.5 rounded-full bg-slate-200"><span className="absolute inset-y-0 left-0 rounded-full bg-status-green" style={{ width: `${Math.min(100, v.pct[0])}%` }} /><span className="absolute -inset-y-0.5 w-0.5 bg-slate-900" style={{ left: `${Math.min(100, v.pct[1])}%` }} /></span>
          : <span className="block text-xs text-slate-500">{v.att ? `${v.att} need${v.att === 1 ? 's' : ''} attention` : 'Nothing needs attention'} · shutdown progress</span>}
      </span>
      <span className="text-brand-700">›</span>
    </Link>
  );
}
