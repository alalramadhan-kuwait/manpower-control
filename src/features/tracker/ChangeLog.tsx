// The change log for the Section Head: who changed what and when, newest first. Filter by person, by period and by
// item or words; each change in one short line.
import { useEffect, useMemo, useState } from 'react';
import { kwDay, kwTime, logText, type TrkActivity, type TrkLog } from '@/core/tracker';
import { fetchChangeLog } from '@/data/tracker';
import { ErrorBox, Spinner, cx } from '@/ui/components';

const PERIODS: [number, string][] = [[1, 'Today'], [2, '2 days'], [7, '7 days']];
const kwDate = (iso: string) => new Date(Date.parse(iso) + 3 * 36e5).toISOString().slice(0, 10);

export function ChangeLog({ trackerId, acts }: { trackerId: string; acts: TrkActivity[] }) {
  const [days, setDays] = useState(1);
  const [rows, setRows] = useState<TrkLog[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [who, setWho] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { let live = true; setRows(null); fetchChangeLog(trackerId, days).then((r) => live && setRows(r)).catch((e) => live && setErr(e)); return () => { live = false; }; }, [trackerId, days]);
  const today = kwDate(new Date().toISOString());
  const inPeriod = useMemo(() => (rows ?? []).filter((r) => days > 1 || kwDate(r.at) === today), [rows, days, today]);
  const people = useMemo(() => { const m = new Map<string, number>(); for (const r of inPeriod) m.set(r.byName ?? 'system', (m.get(r.byName ?? 'system') ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); }, [inPeriod]);
  const shown = useMemo(() => inPeriod.filter((r) => (!who || (r.byName ?? 'system') === who)).map((r) => ({ r, ...logText(r, acts) }))
    .filter((x) => !q.trim() || `${x.item} ${x.what} ${x.r.byName ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [inPeriod, who, q, acts]);
  const days_ = [...new Set(shown.map((x) => kwDate(x.r.at)))];
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">{PERIODS.map(([d, l]) => <button key={d} type="button" onClick={() => setDays(d)} className={cx('min-h-8 rounded-full px-3 text-xs font-bold', days === d ? 'bg-[#0d2a5e] text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300')}>{l}</button>)}</div>
      {people.length > 0 && <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setWho(null)} className={cx('min-h-8 rounded-full px-3 text-xs font-semibold', !who ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300')}>Everyone {inPeriod.length}</button>
        {people.map(([p, n]) => <button key={p} type="button" onClick={() => setWho(who === p ? null : p)} className={cx('min-h-8 rounded-full px-3 text-xs font-semibold', who === p ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300')}>{p} {n}</button>)}
      </div>}
      <input className="input" placeholder="Search item or words (e.g. R-205, drums, note)" value={q} onChange={(e) => setQ(e.target.value)} />
      {err != null && <ErrorBox error={err} />}
      {!rows && !err && <div className="py-4"><Spinner /></div>}
      {rows && !shown.length && <p className="py-3 text-center text-sm text-slate-500">No changes{who ? ` by ${who}` : ''} in this period.</p>}
      {days_.map((day) => <div key={day}>
        <p className="mb-1 mt-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">{kwDay(`${day}T12:00:00+03:00`)}</p>
        <div className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
          {shown.filter((x) => kwDate(x.r.at) === day).slice(0, 400).map((x, i) => (
            <div key={i} className="flex gap-2 px-2.5 py-1.5 text-[12.5px]">
              <span className="w-10 shrink-0 tabular-nums text-slate-500">{kwTime(x.r.at)}</span>
              <span className="min-w-0 flex-1"><b>{x.item}</b> <span className="text-slate-700">{x.what}</span></span>
              <span className={cx('shrink-0 self-start rounded px-1.5 py-px text-[10.5px] font-bold', x.r.byName && x.r.byName !== 'system' ? 'bg-sky-100 text-sky-900' : 'bg-slate-100 text-slate-500')}>{x.r.byName ?? 'system'}</span>
            </div>))}
        </div>
      </div>)}
    </div>
  );
}
