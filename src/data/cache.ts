// One shared answer for identical reads made a few seconds apart (owner, 22 Nov 2026: "the app feels slow" when it
// opens: Today, the bell, the badge counts and the side panel each sent the same reads, 4–5 times per opening).
// Phone only: this sits in trackedFetch, so the server checks (edge functions) never use it.
// An answer is reused only for the same GET (same address, same signed-in user, same reply shape) within 10 s, and
// every copy is dropped at once when anything is saved from this phone or the live check sees a change from
// elsewhere, so a screen never shows older data than a fresh read a moment earlier would have.
const TTL_MS = 10_000;
/** Never shared: the live change counter (it must always be read fresh). */
const NEVER = /\/manpower_version\b/;

interface Kept { status: number; statusText: string; headers: [string, string][]; body: ArrayBuffer }
const store = new Map<string, { at: number; p: Promise<Kept> }>();

const headerOf = (h: HeadersInit | undefined, name: string): string => {
  if (!h) return '';
  if (h instanceof Headers) return h.get(name) ?? '';
  if (Array.isArray(h)) return h.find(([k]) => k.toLowerCase() === name)?.[1] ?? '';
  const k = Object.keys(h).find((x) => x.toLowerCase() === name);
  return k ? (h as Record<string, string>)[k] : '';
};

const toResponse = (k: Kept) => new Response(k.body.slice(0), { status: k.status, statusText: k.statusText, headers: k.headers });

/** fetch with sharing for repeated GET reads of the database's data (REST only). */
export function sharedGet(url: string, init: RequestInit | undefined, go: () => Promise<Response>): Promise<Response> {
  if (!/\/rest\/v1\//.test(url) || NEVER.test(url)) return go();
  const h = init?.headers;
  const key = [url, headerOf(h, 'authorization'), headerOf(h, 'accept'), headerOf(h, 'prefer'), headerOf(h, 'range'), headerOf(h, 'x-trk-key')].join('|');
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.p.then(toResponse);
  const p: Promise<Kept> = go().then(async (r) => {
    const kept: Kept = { status: r.status, statusText: r.statusText, headers: [...r.headers.entries()], body: await r.arrayBuffer() };
    // only a good answer is kept for the next caller
    if (!r.ok && store.get(key)?.p === p) store.delete(key);
    return kept;
  });
  for (const [k, v] of store) if (now - v.at >= TTL_MS) store.delete(k);   // old answers are not kept around
  store.set(key, { at: now, p });
  p.catch(() => { if (store.get(key)?.p === p) store.delete(key); });
  return p.then(toResponse);
}

export function clearCache() { store.clear(); }
