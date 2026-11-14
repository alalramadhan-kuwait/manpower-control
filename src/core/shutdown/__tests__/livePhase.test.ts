import { describe, expect, it } from 'vitest';
import { livePhase, startupNow } from '../livePhase';

const s = (id: string, status: 'not_started' | 'running' | 'done' | 'not_required', startedAt: string | null = null, doneAt: string | null = null, kind: 'step' | 'hold' = 'step') => ({ id, title: id, status, startedAt, doneAt, kind });
const now = Date.parse('2026-11-14T13:44:00Z');

describe('live phase (owner, 14 Nov 2026)', () => {
  it('follows what is recorded', () => {
    expect(livePhase(null, now, [])).toBe('ops');
    expect(livePhase(Date.parse('2026-10-20T04:00:00Z'), now, [s('a', 'not_started')])).toBe('mi');
    expect(livePhase(Date.parse('2026-10-20T04:00:00Z'), now, [s('a', 'done', '2026-11-12T07:00:00Z', '2026-11-12T16:51:00Z'), s('b', 'not_started')])).toBe('startup');
    expect(livePhase(Date.parse('2026-10-20T04:00:00Z'), now, [s('a', 'done', 'x', 'y'), s('b', 'not_required')])).toBe('service');
  });
  it('a future handover is still operations', () => {
    expect(livePhase(now + 36e5, now, [])).toBe('ops');
  });
  it('now: running, or the next step and the idle hours', () => {
    const r = startupNow([s('a', 'done', '2026-11-14T03:00:00Z', '2026-11-14T08:50:00Z'), s('b', 'not_started'), s('c', 'not_started')], now);
    expect(r.running).toBeNull(); expect(r.next?.id).toBe('b'); expect(r.idleH).toBe(4.9);
    expect(startupNow([s('a', 'running', '2026-11-14T08:50:00Z')], now).running?.id).toBe('a');
  });
});
