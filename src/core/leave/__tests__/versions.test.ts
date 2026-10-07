import { describe, expect, it } from 'vitest';
import { leaveChains, versionState, type VersionRow } from '../versions';

const row = (id: string, root: string, v: number, start: string, current: boolean, status = current ? 'approved' : 'rescheduled'): VersionRow =>
  ({ id, root_id: root, version_no: v, created_at: `2026-0${v}-01T00:00:00Z`, start_date: start, end_date: start, status, in_current_plan: current, origin: 'import', change_reason: null });

describe('leave versions', () => {
  it('keeps only leaves with more than one version, oldest first', () => {
    const chains = leaveChains([row('b2', 'b', 2, '2026-11-11', true), row('a', 'a', 1, '2026-03-01', true), row('b', 'b', 1, '2026-11-03', false)]);
    expect(chains).toHaveLength(1);
    expect(chains[0].map((r) => r.id)).toEqual(['b', 'b2']);
  });
  it('orders chains by their first dates', () => {
    const chains = leaveChains([row('y2', 'y', 2, '2026-12-01', true), row('y', 'y', 1, '2026-11-20', false), row('x2', 'x', 2, '2026-05-02', true), row('x', 'x', 1, '2026-05-01', false)]);
    expect(chains.map((c) => c[0].id)).toEqual(['x', 'y']);
  });
  it('says what a version is now', () => {
    expect(versionState({ status: 'approved', in_current_plan: true })).toBe('current');
    expect(versionState({ status: 'rescheduled', in_current_plan: false })).toBe('replaced');
    expect(versionState({ status: 'cancelled', in_current_plan: false })).toBe('cancelled');
  });
});
