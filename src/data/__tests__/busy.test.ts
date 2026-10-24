import { describe, expect, it } from 'vitest';
import { kindOf } from '../busy';

describe('saving or loading', () => {
  const R = 'https://x.supabase.co/rest/v1';
  it('a change is a save, a read is a load, the background calls are not shown', () => {
    expect(kindOf(`${R}/trk_equipment?id=eq.1`, 'PATCH')).toBe('save');
    expect(kindOf(`${R}/trk_event`, 'POST')).toBe('save');
    expect(kindOf(`${R}/rpc/trk_set_order`, 'POST')).toBe('save');
    expect(kindOf(`${R}/trk_activities?select=*`, 'GET')).toBe('load');
    expect(kindOf(`${R}/rpc/trk_sd_team`, 'POST')).toBe('load');
    expect(kindOf(`${R}/rpc/app_visit`, 'POST')).toBeNull();
    expect(kindOf('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', 'POST')).toBeNull();
  });
});

describe('no connection', () => {
  it('a save is refused with a clear message; a load still goes out', async () => {
    const { trackedFetch } = await import('../busy');
    const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
    const real = globalThis.fetch; globalThis.fetch = (async () => new Response('[]')) as typeof fetch;
    try {
      await expect(trackedFetch('https://x.supabase.co/rest/v1/trk_event', { method: 'POST' })).rejects.toThrow('No connection: not saved');
      await expect(trackedFetch('https://x.supabase.co/rest/v1/trk_event', { method: 'GET' })).resolves.toBeInstanceOf(Response);
    } finally { globalThis.fetch = real; if (was) Object.defineProperty(globalThis, 'navigator', was); else delete (globalThis as { navigator?: unknown }).navigator; }
  });
});
