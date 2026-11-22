import { describe, expect, it, vi, beforeEach } from 'vitest';
import { clearCache, sharedGet } from '../cache';

const ok = (body: string) => () => Promise.resolve(new Response(body, { status: 200 }));
const U = 'https://x.supabase.co/rest/v1/leave_records?select=*';

describe('shared reads (phone only)', () => {
  beforeEach(() => clearCache());
  it('two identical reads a moment apart send one request and both get the answer', async () => {
    const go = vi.fn(ok('[1]'));
    const [a, b] = await Promise.all([sharedGet(U, { headers: { authorization: 'u1' } }, go), sharedGet(U, { headers: { authorization: 'u1' } }, go)]);
    expect(go).toHaveBeenCalledTimes(1);
    expect(await a.text()).toBe('[1]'); expect(await b.text()).toBe('[1]');
  });
  it('another user, another reply shape or another address is read again', async () => {
    const go = vi.fn(ok('[]'));
    await sharedGet(U, { headers: { authorization: 'u1' } }, go);
    await sharedGet(U, { headers: { authorization: 'u2' } }, go);
    await sharedGet(U, { headers: { authorization: 'u1', accept: 'application/vnd.pgrst.object+json' } }, go);
    await sharedGet(U + '&id=eq.1', { headers: { authorization: 'u1' } }, go);
    expect(go).toHaveBeenCalledTimes(4);
  });
  it('a save (clearCache) means the next read is fresh', async () => {
    const go = vi.fn(ok('[]'));
    await sharedGet(U, undefined, go); clearCache(); await sharedGet(U, undefined, go);
    expect(go).toHaveBeenCalledTimes(2);
  });
  it('an error answer is not kept, and the live change counter is never shared', async () => {
    const bad = vi.fn(() => Promise.resolve(new Response('no', { status: 500 })));
    await sharedGet(U, undefined, bad); await sharedGet(U, undefined, bad);
    expect(bad).toHaveBeenCalledTimes(2);
    const v = vi.fn(ok('[{"v":1}]')); const V = 'https://x.supabase.co/rest/v1/manpower_version?select=v';
    await sharedGet(V, undefined, v); await sharedGet(V, undefined, v);
    expect(v).toHaveBeenCalledTimes(2);
  });
  it('older than 10 s is read again', async () => {
    vi.useFakeTimers(); const go = vi.fn(ok('[]'));
    await sharedGet(U, undefined, go); vi.advanceTimersByTime(10_001); await sharedGet(U, undefined, go);
    expect(go).toHaveBeenCalledTimes(2); vi.useRealTimers();
  });
});
