// On Today, during a tracked shutdown: one line of its progress (ahead / behind, what needs attention), tap to open.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { attention, bannerText, equipViews, phases, stepViews } from '@/core/tracker';
import { currentTracker, fetchTrackerData, fetchTrackers } from '@/data/tracker';
import { cx } from '@/ui/components';

const DOT = { AHEAD: 'bg-[#08A048]', BEHIND: 'bg-[#E02028]', ON_PLAN: 'bg-amber-500' } as const;

export function TrackerTodayCard({ date }: { date: string }) {
  const [v, setV] = useState<{ id: string; title: string; test: boolean; state: keyof typeof DOT; text: string; att: number } | null>(null);
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
      if (live) setV({ id: t.id, title: t.title, test: t.mode === 'test', state, text, att: attention(steps, eqs).length });
    })().catch(() => { if (live) setV(null); });
    return () => { live = false; };
  }, [date]);
  if (!v) return null;
  return (
    <Link to={`/progress/${v.id}`} className="mb-3 flex items-center gap-3 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
      <span className={cx('h-3 w-3 shrink-0 rounded-full', DOT[v.state])} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{v.test ? '[TEST] ' : ''}{v.title} · {v.text}</span>
        <span className="block text-xs text-slate-500">{v.att ? `${v.att} need${v.att === 1 ? 's' : ''} attention` : 'Nothing needs attention'} · shutdown progress</span>
      </span>
      <span className="text-brand-700">›</span>
    </Link>
  );
}
