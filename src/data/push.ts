// Shift alerts on this phone: the push subscription, the server's test call and the alert settings (times, minutes before).
import { FunctionsHttpError } from '@supabase/supabase-js';
import { DEFAULT_SHIFT_ALERTS, type ShiftAlertSettings } from '@/core/shiftAlerts';
import { supabase } from './supabase';
import { dataChanged } from './changes';

/** unsupported: no push here (a browser tab on iPhone, or dev); blocked: refused in the phone settings; off / on: this phone's alerts. */
export type PushState = 'unsupported' | 'blocked' | 'off' | 'on';

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** The app's service worker, or null when there is none (dev, or not registered yet). */
async function worker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await worker();
  if (!reg) return 'unsupported';
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const keyBytes = (s: string) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Ask the phone for permission (must come from a tap), subscribe and tell the server. */
export async function enablePush(label: string): Promise<void> {
  const reg = await worker();
  if (!reg) throw new Error('Alerts need the installed app. On iPhone, open it from the Home Screen icon.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for this app in the phone settings.' : 'Notifications were not allowed.');
  const key = await supabase.rpc('push_public_key');
  if (key.error || !key.data) throw key.error ?? new Error('Shift alerts are not set up on the server.');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.data as string) }));
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error('This phone gave no push address.');
  const { error } = await supabase.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_label: label });
  if (error) throw error;
}

export async function disablePush(): Promise<void> {
  const reg = await worker();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const { error } = await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
  if (error) throw error;
}

/** The server sends the next shift's alert to this person's phones, marked Test. */
export async function sendTestAlert(): Promise<{ sent: number; failed: number; next?: { shift: string; startsAt: string; date: string } }> {
  const { data, error } = await supabase.functions.invoke('shift-alerts', { body: { action: 'test' } });
  if (error) {
    if (error instanceof FunctionsHttpError) throw new Error(await error.context.json().then((b: { error?: string }) => b.error).catch(() => null) ?? error.message);
    throw error;
  }
  const r = data as { error?: string; sent: number; failed: number };
  if (r.error) throw new Error(r.error);
  return r;
}

interface SettingsRow { enabled: boolean; lead_minutes: number; tz: string; morning_start: string; afternoon_start: string; night_start: string }
const hm = (t: string) => String(t).slice(0, 5);

export async function fetchShiftAlertSettings(): Promise<ShiftAlertSettings> {
  const { data, error } = await supabase.from('shift_alert_settings').select('*').eq('id', true).maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_SHIFT_ALERTS;
  const r = data as SettingsRow;
  return { enabled: r.enabled, leadMinutes: r.lead_minutes, tz: r.tz, starts: { M: hm(r.morning_start), A: hm(r.afternoon_start), N: hm(r.night_start) } };
}

/** Section Head only (the database refuses anyone else). */
export async function saveShiftAlertSettings(v: ShiftAlertSettings): Promise<void> {
  const { error } = await supabase.from('shift_alert_settings').update({ enabled: v.enabled, lead_minutes: v.leadMinutes, morning_start: v.starts.M, afternoon_start: v.starts.A, night_start: v.starts.N }).eq('id', true);
  if (error) throw error;
  dataChanged();
}
