import { BellRing, Check, Pencil, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { SHIFT_LABEL } from '@/core/roster';
import { SHIFT_CODES, type ShiftAlertSettings } from '@/core/shiftAlerts';
import { disablePush, enablePush, fetchShiftAlertSettings, pushState, saveShiftAlertSettings, sendTestAlert, type PushState } from '@/data/push';
import { BottomSheet, Button, Card, ErrorBox, Field, cx } from '@/ui/components';

const deviceLabel = () => (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Browser');

/** Shift alerts: turn the alert on for this phone, send a test, and (Section Head) set when each shift starts. */
export function ShiftAlertsCard({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [settings, setSettings] = useState<ShiftAlertSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(() => { pushState().then(setState).catch(() => setState('unsupported')); fetchShiftAlertSettings().then(setSettings).catch(setError); }, []);
  useEffect(load, [load]);

  async function run(f: () => Promise<string | void>) {
    setBusy(true); setError(null); setNote(null);
    try { const m = await f(); if (m) setNote(m); } catch (e) { setError(e); } finally { setBusy(false); setState(await pushState().catch(() => 'unsupported' as PushState)); }
  }
  const turnOn = () => run(async () => { await enablePush(deviceLabel()); return 'Shift alerts are on for this phone.'; });
  const turnOff = () => run(async () => { await disablePush(); return 'Shift alerts are off for this phone.'; });
  const test = () => run(async () => {
    const r = await sendTestAlert();
    return r.sent ? `Test sent for the ${r.next ? `${SHIFT_LABEL[r.next.shift as 'M' | 'A' | 'N']} shift at ${r.next.startsAt}` : 'next shift'}: it should arrive in a few seconds.` : 'The phone did not accept the test. Turn alerts off and on again.';
  });

  return (
    <Card className="mb-4">
      <div className="flex items-start gap-3">
        <span className={cx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', state === 'on' ? 'bg-green-50 text-status-green' : 'bg-brand-50 text-brand-700')}><BellRing className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900">Shift alerts</h2>
          <p className="text-xs text-slate-600">
            {settings ? `${settings.leadMinutes} minutes before each shift starts: the crew coming on and the Controller in charge.` : 'Before each shift starts: the crew coming on and the Controller in charge.'}
          </p>
        </div>
        {canEdit && settings && <button type="button" aria-label="Change the times" onClick={() => setEditing(true)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-brand-700 hover:bg-slate-50"><Pencil className="h-4 w-4" /></button>}
      </div>

      {settings && (
        <p className="mt-2 text-xs text-slate-500">
          {SHIFT_CODES.map((c) => `${SHIFT_LABEL[c]} ${settings.starts[c]}`).join(' · ')}{settings.enabled ? '' : ' · alerts paused'}
        </p>
      )}

      <div className="mt-3">
        {state === null ? <p className="text-xs text-slate-500">Checking this phone…</p>
          : state === 'unsupported' ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">Alerts need the installed app. On iPhone: open the app from its Home Screen icon (Share ▸ Add to Home Screen first), then come back here.</p>
          : state === 'blocked' ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">Notifications are blocked for this app. Allow them in the phone's Settings ▸ Notifications, then come back here.</p>
          : state === 'off' ? <Button className="w-full" disabled={busy} onClick={turnOn}><BellRing className="h-4 w-4" />Turn on for this phone</Button>
          : (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-status-green"><Check className="h-4 w-4" />On for this phone</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={busy} onClick={test}><Send className="h-4 w-4" />Send a test</Button>
                <Button variant="secondary" disabled={busy} onClick={turnOff}>Turn off</Button>
              </div>
            </div>
          )}
      </div>
      {note && <p role="status" className="mt-2 text-xs text-status-green">{note}</p>}
      {error != null && <div className="mt-2"><ErrorBox error={error} /></div>}
      {editing && settings && <TimesSheet value={settings} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); setNote('Shift alert times saved.'); }} />}
    </Card>
  );
}

function TimesSheet({ value, onClose, onSaved }: { value: ShiftAlertSettings; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const valid = SHIFT_CODES.every((c) => /^\d{2}:\d{2}$/.test(v.starts[c])) && v.leadMinutes >= 1 && v.leadMinutes <= 120;
  async function save() { setBusy(true); setErr(null); try { await saveShiftAlertSettings(v); onSaved(); } catch (e) { setErr(e); } finally { setBusy(false); } }
  return (
    <BottomSheet open onClose={onClose} title="Shift alert times">
      <div className="space-y-3">
        <div className="space-y-2">
          {SHIFT_CODES.map((c) => (
            <label key={c} className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-700">{SHIFT_LABEL[c]} starts</span>
              <input type="time" className="input w-44" value={v.starts[c]} onChange={(e) => setV((x) => ({ ...x, starts: { ...x.starts, [c]: e.target.value } }))} />
            </label>
          ))}
        </div>
        <Field label="Minutes before the shift"><input className="input" inputMode="numeric" value={v.leadMinutes} onChange={(e) => setV((x) => ({ ...x, leadMinutes: Number(e.target.value.replace(/\D/g, '')) || 0 }))} /></Field>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={v.enabled} onChange={(e) => setV((x) => ({ ...x, enabled: e.target.checked }))} />Send shift alerts</label>
        <p className="text-[11px] text-slate-500">Times are Kuwait time. The alert goes out once for each shift, to every phone that turned alerts on.</p>
        {err != null && <ErrorBox error={err} />}
        <Button className="w-full" disabled={busy || !valid} onClick={save}>Save</Button>
      </div>
    </BottomSheet>
  );
}
