// Admin of the progress tracker (Section Head): the bar chart (import, items and activities on / off), the step
// pre-requisites and targets, the WhatsApp number, the TEST clock, Reset test and Publish, the engineer links, the change log.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STAGES, type EquipView } from '@/core/tracker';
import { barchartRows, parseCsv } from '@/core/tracker/csv';
import { importBarchart, publishTracker, resetTest, setActivity, setEquipment, setStep, setTrackerSettings, type TrackerData } from '@/data/tracker';
import { Button, ErrorBox, Field, cx } from '@/ui/components';
import { EngineerLinks } from './EngineerLinks';
import { ChangeLog } from './ChangeLog';

export const clockKey = (id: string) => `trk-clock-${id}`;
const local = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 3 * 36e5).toISOString().slice(0, 16) : '');
const fromLocal = (v: string) => (v ? `${v}:00+03:00` : null);

function Section({ title, children, open: initial = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return <section className="rounded-2xl bg-white p-3 ring-1 ring-slate-200"><button type="button" onClick={() => setOpen((x) => !x)} className="flex w-full items-center justify-between text-sm font-bold text-[#004080]"><span>{title}</span><span>{open ? '▾' : '▸'}</span></button>{open && <div className="mt-2 space-y-2">{children}</div>}</section>;
}

export function TrackerAdmin({ data, eqs, by = 'Section Head', onDone }: { data: TrackerData; eqs: EquipView[]; by?: string; onDone: (msg: string) => void }) {
  const t = data.tracker; const nav = useNavigate();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const [wa, setWa] = useState(t.settings.whatsapp ?? '');
  const [clock, setClock] = useState(() => { try { return localStorage.getItem(clockKey(t.id)) ?? ''; } catch { return ''; } });
  const [q, setQ] = useState('');
  async function run(f: () => Promise<unknown>, msg: string) { setBusy(true); setErr(null); try { await f(); onDone(msg); } catch (e) { setErr(e); } finally { setBusy(false); } }
  async function onFile(file: File) {
    const rows = barchartRows(parseCsv(await file.text()));
    if (!rows.length) { setErr(new Error('No bar-chart lines found: the file needs the columns activity_id, equipment_key, activity, planned_start, planned_finish, stage.')); return; }
    await run(() => importBarchart(t.id, rows), `Bar chart imported: ${rows.length} activities (new baseline).`);
  }
  const keys = [...new Set(data.activities.map((a) => a.key))].sort();
  const acts = data.activities.filter((a) => !q || `${a.key} ${a.activity} ${a.activityId}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-3">
      {err != null && <ErrorBox error={err} />}
      <Section title="Change log · who edited what" open><ChangeLog trackerId={t.id} acts={data.activities} /></Section>
      <Section title="Engineer links (update without login)" open><EngineerLinks trackerId={t.id} by={by} /></Section>
      <Section title={`${t.mode === 'test' ? 'TEST' : 'LIVE'} · reset and publish`} open>
        {t.mode === 'test' ? <>
          <Field label="Clock for trying the scenarios (this device only)">
            <div className="flex gap-2"><input type="datetime-local" className="input" value={clock} onChange={(e) => setClock(e.target.value)} />
              <Button variant="secondary" onClick={() => { try { if (clock) localStorage.setItem(clockKey(t.id), fromLocal(clock)!); else localStorage.removeItem(clockKey(t.id)); } catch { /* storage blocked */ } window.dispatchEvent(new Event('trk-clock')); onDone(clock ? `Clock set to ${clock.replace('T', ' ')}.` : 'Clock back to now.'); }}>Set</Button>
              {clock && <Button variant="ghost" onClick={() => { setClock(''); try { localStorage.removeItem(clockKey(t.id)); } catch { /* storage blocked */ } window.dispatchEvent(new Event('trk-clock')); onDone('Clock back to now.'); }}>Now</Button>}</div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => { if (window.confirm('Start a fresh test from the seed (19-Oct statuses)? The current test is closed and kept.')) run(async () => { const id = await resetTest(t.id); nav(`/progress/${id}`); }, 'Fresh test from the seed.'); }}>Reset test data</Button>
            <Button disabled={busy} onClick={() => { if (window.confirm('Publish: the setup of this test (steps, pre-requisites, equipment, bar chart, on/off) becomes the LIVE tracker with clean progress. Continue?')) run(async () => { const id = await publishTracker(t.id); nav(`/progress/${id}`); }, 'Published: the live tracker is ready.'); }}>Publish to LIVE</Button>
          </div>
          <p className="text-[11px] text-slate-500">Run the test scenarios here first. Reset keeps the setup you made only if it is in the seed: set the pre-requisites and on/off after the last reset, then publish.</p>
        </> : <p className="text-sm text-slate-600">This is the live tracker. Try changes on the test one first.</p>}
      </Section>

      <Section title="WhatsApp number">
        <div className="flex gap-2"><input className="input" inputMode="numeric" placeholder="965XXXXXXXX (no +)" value={wa} onChange={(e) => setWa(e.target.value.replace(/\D/g, ''))} />
          <Button variant="secondary" disabled={busy} onClick={() => run(() => setTrackerSettings(t.id, { ...t.settings, whatsapp: wa }), 'WhatsApp number saved.')}>Save</Button></div>
        <p className="text-[11px] text-slate-500">"WhatsApp" on the report opens this chat with the text ready. "Share" opens the iPhone share sheet (any chat or group).</p>
      </Section>

      <Section title={`Bar chart · ${data.activities.length} activities · ${keys.length} items`} open={!data.activities.length}>
        <label className={cx('flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-[#0850A0] px-4 text-sm font-medium text-white', busy && 'opacity-50')}>
          Import bar chart (CSV)<input type="file" accept=".csv,text/csv" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
        </label>
        <p className="text-[11px] text-slate-500">Columns: activity_id, group, equipment_key, activity, duration_h, planned_start, planned_finish, stage, tracked (as barchart_activities.csv; Kuwait time). Each import is a new baseline: the actual progress stays.</p>
        {data.activities.length > 0 && <>
          <input className="input" placeholder="Search activities" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {acts.slice(0, 200).map((a) => (
              <label key={a.id} className={cx('flex items-center gap-2 py-1.5 text-xs', !a.tracked && 'opacity-50')}>
                <input type="checkbox" checked={a.tracked} disabled={busy} onChange={(e) => run(() => setActivity(a.id, { tracked: e.target.checked }), `${a.activityId} ${e.target.checked ? 'on' : 'off'}.`)} />
                <span className="w-24 shrink-0 font-semibold">{a.key}</span><span className="min-w-0 flex-1 truncate">{a.activity}</span>
                <select className="rounded border border-slate-300 px-1 py-0.5" value={a.stage ?? ''} disabled={busy} onChange={(e) => run(() => setActivity(a.id, { stage: e.target.value === '' ? null : Number(e.target.value) }), `${a.activityId}: stage ${e.target.value || 'none'}.`)}>
                  <option value="">–</option>{STAGES.map((s, i) => <option key={s} value={i}>{i}</option>)}</select>
              </label>
            ))}
          </div>
          {acts.length > 200 && <p className="text-[11px] text-slate-500">{acts.length - 200} more: search to narrow.</p>}
        </>}
      </Section>

      <Section title={`Equipment · on / off, critical, planned dates`}>
        <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
          {eqs.map(({ eq: e }) => (
            <div key={e.id} className={cx('flex flex-wrap items-center gap-2 py-1.5 text-xs', !e.tracked && 'opacity-50')}>
              <label className="flex w-40 items-center gap-1.5 font-semibold"><input type="checkbox" checked={e.tracked} disabled={busy} onChange={(x) => run(() => setEquipment(e.id, { tracked: x.target.checked, disabled_reason: x.target.checked ? null : 'not tracked' }), `${e.tag} ${x.target.checked ? 'tracked' : 'off'}.`)} />{e.tag}</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={e.critical} disabled={busy} onChange={(x) => run(() => setEquipment(e.id, { critical: x.target.checked }), `${e.tag}: ${x.target.checked ? 'critical' : 'not critical'}.`)} />★</label>
              {e.opsItem && <label className="flex items-center gap-1">HO <input type="datetime-local" className="rounded border border-slate-300 px-1 py-0.5" defaultValue={local(e.plannedHo)} onBlur={(x) => { if (fromLocal(x.target.value) !== e.plannedHo && x.target.value) run(() => setEquipment(e.id, { planned_ho: fromLocal(x.target.value) }), `${e.tag}: planned handover saved.`); }} /></label>}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Steps · pre-requisites and target">
        <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
          {[...data.steps].sort((a, b) => a.stepId.localeCompare(b.stepId)).map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
              <b className="w-10">{s.stepId}</b><span className="min-w-0 flex-1 truncate">{s.shortName}</span>
              <input className="w-32 rounded border border-slate-300 px-1 py-0.5" defaultValue={s.prereq.join(', ')} placeholder="pre-req" onBlur={(x) => { const v = x.target.value.split(/[\s,]+/).map((y) => y.trim().toUpperCase()).filter(Boolean); if (v.join(',') !== s.prereq.join(',')) run(() => setStep(s.id, { prereq: v }), `${s.stepId}: pre-requisites ${v.join(', ') || 'none'}.`); }} />
              <input type="datetime-local" className="rounded border border-slate-300 px-1 py-0.5" defaultValue={local(s.target)} onBlur={(x) => { const v = fromLocal(x.target.value); if (v !== s.target) run(() => setStep(s.id, { target_at: v }), `${s.stepId}: target ${x.target.value ? 'saved' : 'default'}.`); }} />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">Target empty: the default handover target ({t.settings.hoTarget ? new Date(Date.parse(t.settings.hoTarget) + 3 * 36e5).toISOString().slice(0, 16).replace('T', ' ') : '20-Oct 07:00'}).</p>
      </Section>
    </div>
  );
}
