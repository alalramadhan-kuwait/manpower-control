// What the app is waiting for: every request to the database goes through `trackedFetch`, which counts the saves
// (writes) and the loads (reads) in flight, so one indicator for the whole app can say so (src/app/BusyIndicator).

/** Calls that only read, though sent as POST; and calls nobody needs to see (the visit record, the sign-in refresh). */
const READ_RPC = new Set(['trk_access_me', 'trk_sd_team', 'user_activity_summary', 'push_public_key', 'app_current_role']);
const SILENT = /\/rpc\/app_visit\b|\/auth\/v1\/|version\.json/;

type Kind = 'save' | 'load';
const count: Record<Kind, number> = { save: 0, load: 0 };
const subs = new Set<(c: Record<Kind, number>) => void>();
const emit = () => { for (const f of subs) f({ ...count }); };
export function onBusy(f: (c: Record<Kind, number>) => void): () => void { subs.add(f); f({ ...count }); return () => { subs.delete(f); }; }

export function kindOf(url: string, method = 'GET'): Kind | null {
  if (SILENT.test(url)) return null;
  const rpc = url.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/)?.[1];
  if (rpc) return READ_RPC.has(rpc) ? 'load' : 'save';
  return method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD' ? 'load' : 'save';
}

export const trackedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const k = kindOf(url, init?.method ?? (input instanceof Request ? input.method : 'GET'));
  // no connection: nothing is saved (no offline queue); the banner says so and the screen shows the error
  if (k === 'save' && typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('No connection: not saved. Reconnect and try again.');
  if (k) { count[k]++; emit(); }
  try { return await fetch(input, init); } finally { if (k) { count[k] = Math.max(0, count[k] - 1); emit(); } }
};
