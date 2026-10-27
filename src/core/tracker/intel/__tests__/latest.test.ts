import { describe, expect, it } from 'vitest';
import { latestStatusOnly } from '../latest';

const row = (id: string, key: string, eventAt: string, dept: 'shift_ops' | 'ops_engineer', over: Record<string, unknown> = {}) =>
  ({ id, type: 'status_line', key, status: 'ready', eventAt, createdAt: eventAt, department: dept, issues: [] as string[], title: id, ...over });

describe('several status lines for one item', () => {
  it('only the newest by report time can be applied; older ones become "older" info rows', () => {
    const out = latestStatusOnly([row('a', 'R-12-205', '2026-10-27T04:00:00Z', 'ops_engineer'), row('b', 'R-12-205', '2026-10-27T09:00:00Z', 'shift_ops'), row('c', 'H-12-201', '2026-10-27T05:00:00Z', 'shift_ops')]);
    expect(out.find((p) => p.id === 'b')!.status).toBe('ready');
    const a = out.find((p) => p.id === 'a')!;
    expect(a.status).toBe('info'); expect(a.superseded).toBe(true); expect(a.issues[0]).toMatch(/newer status from Shift Ops 27\/10 12:00/);
    expect(out.find((p) => p.id === 'c')!.status).toBe('ready');
  });
  it('a conflict or review still counts as open; applied, dismissed and other types are left alone', () => {
    const out = latestStatusOnly([row('a', 'K', '2026-10-27T10:00:00Z', 'shift_ops', { status: 'conflict' }), row('b', 'K', '2026-10-27T08:00:00Z', 'shift_ops', { status: 'applied' }),
      row('c', 'K', '2026-10-27T07:00:00Z', 'shift_ops', { type: 'finish_step' }), row('d', 'K', '2026-10-27T06:00:00Z', 'shift_ops', { status: 'review' })]);
    expect(out.map((p) => p.status)).toEqual(['conflict', 'applied', 'ready', 'info']);
  });
});
