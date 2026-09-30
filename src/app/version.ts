// Which version of the app this is, and whether a newer one has been published (dist/version.json, never cached).
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const APP_BUILT: string = typeof __APP_BUILT__ === 'string' ? __APP_BUILT__ : '';
export interface RemoteVersion { version: string; built: string }

/** The published version, or null when it cannot be read (offline, or the dev server). */
export async function fetchRemoteVersion(): Promise<RemoteVersion | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as RemoteVersion;
    return typeof j.version === 'string' ? j : null;
  } catch { return null; }
}

/** "30 Sep 2026, 14:05" for the build time. */
export const builtLabel = (iso: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Update for sure: drop the service workers and their caches, then load the app again under a new address so no cached
 * page or script is used. (The plain service-worker update can stay stuck on a phone; this cannot.)
 */
export async function hardUpdate(toVersion?: string): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
    if (typeof caches !== 'undefined') await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch { /* reload anyway */ }
  const u = new URL(window.location.href);
  u.searchParams.set('v', toVersion ?? String(Date.now()));
  window.location.replace(u.toString());
}
