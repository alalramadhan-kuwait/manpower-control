// A start-up step's target profile (owner, 28 Oct 2026): the SOP's hour table as the target now and in an hour, a
// graph, and the panel's readings. A reading behind the profile re-plans the rest at the SOP rate (never faster); the
// step's expected finish moves with it (in the app; the WhatsApp picture keeps the plan). The targets are the SOP's.
import { useState } from 'react';
import { DELAY_MIN_H, DELAY_REASONS, type DelayReason } from '@/core/shutdown/stages';
import { RX_NAMES, clockOf, profileView, uniform, type ProfileRow, type ProfileView } from '@/core/shutdown/profile';
import { kwDay, kwTime12 } from '@/core/tracker';
import { addReading, removeReading, setStartupStep, type PanelReading, type StartupStep } from '@/data/sdPage';
import { Button, ErrorBox, Field, cx } from '@/ui/components';

const H = 3_600_000;
const at = (t: number) => `${kwDay(t).replace(/^\w+,?\s*/, '')} ${kwTime12(t)}`;
const local = (t: number) => new Date(t + 3 * H).toISOString().slice(0, 16);
const fromLocal = (v: string) => Date.parse(`${v}:00+03:00`);
const hrs = (h: number) => `${Math.round(Math.abs(h) * 10) / 10} h`;

/** The profile view of a step at a moment, from its readings (none: on the clock from its start). */
export function stepProfile(s: StartupStep, readings: PanelReading[], now: number): ProfileView | null {
  if (!s.profile?.length || !s.startedAt) return null;
  return profileView(s.profile, Date.parse(s.startedAt), readings.filter((r) => r.stepId === s.id).map((r) => ({ at: Date.parse(r.at), temp: r.temp, holding: r.holding })), now);
}

export function ProfileCard({ step, readings, canEdit, now, onDone }: { step: StartupStep; readings: PanelReading[]; canEdit: boolean; now: number; onDone: (m: string) => void }) {
  const p = step.profile!; const uni = uniform(p);
  const start = step.startedAt ? Date.parse(step.startedAt) : null;
  const mine = readings.filter((r) => r.stepId === step.id);
  const v = start !== null ? profileView(p, start, mine.map((r) => ({ at: Date.parse(r.at), temp: r.temp, holding: r.holding })), now) : null;
  const [table, setTable] = useState(false); const [adding, setAdding] = useState(false);
  const late = v && uni && v.shiftH >= DELAY_MIN_H;
  return (
    <div className="space-y-2 rounded-xl ring-1 ring-slate-200">
      <div className="flex items-baseline justify-between px-2.5 pt-2"><b className="text-[12px] uppercase tracking-wide text-slate-500">Target · SOP</b><span className="text-[10.5px] text-slate-400">{step.profileRef}</span></div>
      {!v ? <p className="px-2.5 pb-2 text-[12px] text-slate-500">Starts when the step starts: hour 0 is its actual start.</p> : <>
        {late && <div className="mx-2.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12px] text-red-900 ring-1 ring-red-200"><b>{v.behindF != null && v.behindF > 0 ? `${v.behindF} °F behind the profile · ` : ''}{hrs(v.shiftH)} late</b>
          <span className="block">End re-planned {at(v.endAt)} (plan {at(v.planEndAt)}), at the SOP rate. Not shown on the WhatsApp picture.</span></div>}
        {v.holding && <div className="mx-2.5 rounded-lg bg-sky-50 px-2.5 py-1.5 text-[12px] text-sky-900 ring-1 ring-sky-200"><b>Holding at {v.now[0]} °F</b> since {at(v.reading!.at)}: the end moves with the clock.</div>}
        <div className="mx-2.5 grid grid-cols-2 gap-1.5">
          <div className="rounded-xl bg-amber-50 px-2.5 py-1.5 ring-1 ring-amber-200"><span className="block text-[10px] font-bold uppercase text-slate-500">Now · {kwTime12(now)}</span>
            {uni ? <b className="block text-[24px] leading-tight tabular-nums">{v.now[0]} °F</b> : <b className="block text-[18px] leading-tight tabular-nums">{v.row.feed} KBPD</b>}
            <span className="text-[11px] text-slate-600">{uni ? 'all reactors inlet' : `AR/DSL ${v.row.ardsl}${v.row.note ? ` · ${v.row.note}` : ''}`}</span></div>
          <div className="rounded-xl bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200"><span className="block text-[10px] font-bold uppercase text-slate-500">Next · {kwTime12(v.next.at)}</span>
            {uni ? <b className="block text-[24px] leading-tight tabular-nums">{v.next.rx[0]} °F</b> : <b className="block text-[18px] leading-tight tabular-nums">{v.nextRow?.feed ?? v.row.feed} KBPD</b>}
            <span className="text-[11px] text-slate-600">{uni ? `end ${at(v.endAt)}` : `AR/DSL ${v.nextRow?.ardsl ?? v.row.ardsl}${v.nextRow?.note ? ` · ${v.nextRow.note}` : ''}`}</span></div>
        </div>
        {uni ? <div className="mx-2.5 flex gap-1.5 text-center text-[10.5px] text-slate-500">
            <span className="flex-1 rounded-lg bg-slate-50 py-1">Feed <b className="block text-[13px] text-slate-900">{v.row.feed}</b>KBPD</span>
            <span className="flex-1 rounded-lg bg-slate-50 py-1">AR/DSL <b className="block text-[13px] text-slate-900">{v.row.ardsl}</b>KBPD</span>
            <span className="flex-1 rounded-lg bg-slate-50 py-1">Rate <b className="block text-[13px] text-slate-900">{p.length > 1 ? p[1].rx[0] - p[0].rx[0] : 0}</b>°F/h</span></div>
          : <div className="mx-2.5 grid grid-cols-5 gap-1 text-center text-[10px] text-slate-500">{RX_NAMES.map((n, k) => <span key={n} className="rounded-lg bg-slate-50 py-1">{n}<b className="block text-[13px] tabular-nums text-slate-900">{v.now[k]}</b>→{v.next.rx[k]}</span>)}</div>}
        <Chart p={p} start={start!} v={v} readings={mine} now={now} />
      </>}
      {v && mine.length > 0 && <ul className="mx-2.5 divide-y divide-slate-100 text-[12px] tabular-nums">{mine.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 py-1"><span>{at(Date.parse(r.at))} · panel{r.holding ? ' · holding' : ''}{r.reason ? ` · ${DELAY_REASONS.find((x) => x.key === r.reason)?.label}` : ''}{r.note ? ` · ${r.note}` : ''}</span>
          <span className="flex items-center gap-2"><b>{r.temp} °F</b>{canEdit && <button type="button" className="text-[11px] text-slate-400" onClick={async () => { await removeReading(r.id); onDone('Reading removed (kept in the history).'); }}>✕</button>}</span></li>))}</ul>}
      {v && canEdit && (adding ? <ReadingForm step={step} readings={mine} now={now} onCancel={() => setAdding(false)} onDone={(m) => { setAdding(false); onDone(m); }} />
        : <div className="mx-2.5"><Button variant="secondary" className="min-h-9 w-full" onClick={() => setAdding(true)}>+ Panel reading</Button></div>)}
      <button type="button" onClick={() => setTable(!table)} className="block w-full px-2.5 pb-2 text-left text-[12px] font-semibold text-brand-700">{table ? 'Hide' : 'Show'} the SOP table ({p.length} hours)</button>
      {table && <div className="overflow-x-auto px-1 pb-2"><table className="w-full text-center text-[11px] tabular-nums">
        <thead><tr className="text-slate-500"><th>h</th><th>{start !== null ? 'Clock' : 'SOP h'}</th><th>Feed</th><th>AR/DSL</th>{RX_NAMES.map((n) => <th key={n}>{n.replace('Rx-', '')}</th>)}<th /></tr></thead>
        <tbody>{p.map((r) => { const cur = v && Math.floor(v.atH) === r.h; const nxt = v && Math.floor(v.atH) + 1 === r.h; return (
          <tr key={r.h} className={cx('border-t border-slate-100', cur && 'bg-amber-100 font-bold', nxt && 'bg-sky-50')}>
            <td>{r.sop_h}</td><td>{start !== null && v ? kwTime12(clockOf(start, v, r.h)) : r.h}</td><td>{r.feed}</td><td>{r.ardsl}</td>{r.rx.map((x, k) => <td key={k}>{x}</td>)}<td className="text-[10px] text-slate-500">{r.note ?? ''}</td></tr>); })}</tbody></table></div>}
    </div>
  );
}

/** The graph: the SOP line (dashed), the line re-planned from the latest reading, the readings, now. Rx-104 (the
 *  highest) for a profile that differs per reactor, the one line for a heat-up. */
function Chart({ p, start, v, readings, now }: { p: ProfileRow[]; start: number; v: ProfileView; readings: PanelReading[]; now: number }) {
  const W = 320, Hh = 120; const k = uniform(p) ? 0 : 4;
  const t0 = start, t1 = Math.max(v.endAt, start + p[p.length - 1].h * H, now) + 0.3 * H;
  const lo = Math.min(...p.map((r) => r.rx[k]), ...readings.map((r) => r.temp)) - 10, hi = Math.max(...p.map((r) => r.rx[k])) + 10;
  const X = (t: number) => 28 + ((t - t0) / (t1 - t0)) * (W - 34), Y = (T: number) => Hh - 14 - ((T - lo) / (hi - lo)) * (Hh - 22);
  const plan = p.map((r) => `${X(start + r.h * H).toFixed(1)},${Y(r.rx[k]).toFixed(1)}`).join(' ');
  const re = v.reading ? [`${X(v.reading.at).toFixed(1)},${Y(v.reading.temp).toFixed(1)}`, ...(v.holding ? [`${X(Math.max(now, v.reading.at)).toFixed(1)},${Y(v.reading.temp).toFixed(1)}`] : []),
    ...p.filter((r) => r.h > v.fromH).map((r) => `${X(clockOf(start, v, r.h)).toFixed(1)},${Y(r.rx[k]).toFixed(1)}`)].join(' ') : '';
  const ticks = [0, 0.33, 0.66, 1].map((f) => t0 + f * (t1 - t0));
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="mx-auto block w-full max-w-md px-1" role="img" aria-label="Target profile">
      <rect x="28" y="4" width={W - 34} height={Hh - 18} fill="#f8fafc" />
      <polyline fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" points={plan} />
      {re && <polyline fill="none" stroke="#f59e0b" strokeWidth="2.5" points={re} />}
      {readings.map((r) => <circle key={r.id} cx={X(Date.parse(r.at))} cy={Y(r.temp)} r="3.5" fill="#dc2626" />)}
      <line x1={X(now)} x2={X(now)} y1="4" y2={Hh - 14} stroke="#dc2626" strokeWidth="1.5" />
      <text x="2" y={Y(hi - 10) + 3} fontSize="9" fill="#94a3b8">{hi - 10}</text><text x="2" y={Y(lo + 10) + 3} fontSize="9" fill="#94a3b8">{lo + 10}</text>
      {ticks.map((t, i) => <text key={i} x={X(t)} y={Hh - 3} fontSize="9" fill="#94a3b8" textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}>{kwTime12(t)}</text>)}
    </svg>
  );
}

/** What the panel says: the inlet temperature (each reactor optional), the time (now), holding; a reason when it is
 *  an hour or more behind. Saving re-plans the step's expected finish. */
function ReadingForm({ step, readings, now, onCancel, onDone }: { step: StartupStep; readings: PanelReading[]; now: number; onCancel: () => void; onDone: (m: string) => void }) {
  const p = step.profile!; const uni = uniform(p); const start = Date.parse(step.startedAt!);
  const [temp, setTemp] = useState(''); const [when, setWhen] = useState(local(now)); const [holding, setHolding] = useState(false);
  const [rx, setRx] = useState<string[]>(['', '', '', '', '']); const [per, setPer] = useState(!uni);
  const [reason, setReason] = useState<DelayReason | null>(null); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const t = Number(temp); const atMs = fromLocal(when);
  const rxNums = rx.map((x) => (x.trim() === '' ? null : Number(x)));
  const value = temp.trim() !== '' && !Number.isNaN(t) ? t : uni ? null : (() => { const xs = rxNums.filter((x): x is number => x !== null && !Number.isNaN(x)); return xs.length ? Math.max(...xs) : null; })();
  const preview = value !== null ? profileView(p, start, [...readings.map((r) => ({ at: Date.parse(r.at), temp: r.temp, holding: r.holding })), { at: atMs, temp: value, holding }], Math.max(now, atMs)) : null;
  const behind = !!preview && uni && preview.shiftH >= DELAY_MIN_H;
  const future = atMs > Date.now() + 15 * 60_000;
  async function save() {
    setBusy(true); setErr(null);
    try {
      await addReading({ stepId: step.id, at: new Date(atMs).toISOString(), temp: value!, rx: per ? rxNums : null, holding, reason: behind || holding ? reason : null, note });
      // the step's expected finish follows the re-planned profile (a heat-up); the shutdown end follows it
      if (uni && preview) await setStartupStep(step.id, { expected_done_at: new Date(Math.max(preview.endAt, start + (step.stdHours ?? 0) * H)).toISOString() });
      onDone(behind ? `Reading saved: ${hrs(preview!.shiftH)} late, end re-planned ${at(preview!.endAt)}.` : 'Reading saved.');
    } catch (e) { setErr(e); setBusy(false); }
  }
  return (
    <div className="mx-2.5 space-y-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
      <div className="space-y-2">
        <Field label={uni ? 'Reactor inlet °F' : 'Highest inlet °F'}><input className="input w-full min-w-0" inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder={preview ? '' : 'e.g. 365'} /></Field>
        <Field label="At"><input type="datetime-local" className="input w-full min-w-0 appearance-none" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-slate-700"><input type="checkbox" className="h-4 w-4" checked={per} onChange={(e) => setPer(e.target.checked)} />Each reactor</label>
      {per && <div className="grid grid-cols-5 gap-1">{RX_NAMES.map((n, k) => <label key={n} className="text-center text-[10px] text-slate-500">{n.replace('Rx-', '')}<input className="input mt-0.5 w-full min-w-0 px-1 text-center" inputMode="decimal" value={rx[k]} onChange={(e) => setRx((x) => x.map((y, j) => (j === k ? e.target.value : y)))} /></label>)}</div>}
      {uni && <label className="flex items-center gap-2 text-[12px] text-slate-700"><input type="checkbox" className="h-4 w-4" checked={holding} onChange={(e) => setHolding(e.target.checked)} />Holding at this temperature (not rising)</label>}
      {preview && uni && <p className={cx('rounded-lg px-2 py-1 text-[12px]', behind ? 'bg-red-50 text-red-900' : Math.abs(preview.shiftH) >= 0.1 ? 'bg-amber-50 text-amber-900' : 'bg-green-50 text-green-900')}>
        {preview.shiftH >= 0.1 ? `${preview.behindF} °F behind · ${hrs(preview.shiftH)}${behind ? ' late' : ' (under 1 h: not late)'} · end ${at(preview.endAt)}`
          : preview.shiftH <= -0.1 ? `${-(preview.behindF ?? 0)} °F ahead · end ${at(preview.endAt)}` : 'On the profile'}</p>}
      {(behind || holding) && <div className="flex flex-wrap gap-1.5">{DELAY_REASONS.map((r) => (
        <button key={r.key} type="button" aria-pressed={reason === r.key} onClick={() => setReason(reason === r.key ? null : r.key)}
          className={cx('min-h-8 rounded-full px-2.5 text-[12px] font-semibold ring-1', reason === r.key ? 'bg-amber-600 text-white ring-amber-600' : 'bg-white text-slate-700 ring-slate-300')}>{r.label}</button>))}</div>}
      <input className="input w-full min-w-0" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {future && <p className="text-xs text-status-red">A time still to come cannot be recorded.</p>}
      {err != null && <ErrorBox error={err} />}
      <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button className="flex-1" disabled={busy || value === null || future || ((behind || holding) && !reason)} onClick={save}>Save reading</Button></div>
    </div>
  );
}
