// The blind list for the startup: positively isolated only when the item has blinds and all are recorded in.
import { describe, expect, it } from 'vitest';
import { blindList, type TrkActivity, type TrkEquipment, type TrkPoint } from '..';

const eq = (tag: string, more: Partial<TrkEquipment> = {}): TrkEquipment => ({ id: tag, tag, group: 'Vessels', description: null, fo: null, hoStep: null, procedure: null, barchartKey: tag, opsItem: true, critical: false, tracked: true,
  disabledReason: null, plannedHo: null, plannedFinish: null, sort: 0, stage: 0, pendingReason: null, remark: null, blindsIn: null, blindsOut: null, updatedBy: null, updatedAt: null, ...more });
const act = (key: string, activity: string, more: Partial<TrkActivity> = {}): TrkActivity => ({ id: key + activity, activityId: 'A1', group: 'M', key, activity, durationH: 1, start: null, finish: null, stage: 1, tracked: true, ...more });
const pt = (ref: string, items: string[], status: TrkPoint['status']): TrkPoint => ({ id: ref, kind: 'blind', grp: 'segregation', ref, name: ref, detail: null, fo: null, stepId: null, items, beforeHo: false, sort: 0, status,
  inAt: status === 'in' ? '2026-10-20T05:00:00Z' : null, outAt: null, fillAt: null, soakAt: null, drainAt: null, doneAt: null, soakH: null, remark: null, updatedBy: null, updatedAt: null });

describe('blind list', () => {
  const d = {
    equipment: [eq('V-1'), eq('V-2'), eq('V-3', { stage: 2 }), eq('V-4'), eq('V-5', { tracked: false, disabledReason: 'out of scope: x' })],
    activities: [act('V-1', 'Install blinds'), act('V-1', 'Deblind', { stage: 6 }), act('V-2', 'Blinding', { actualFinish: '2026-10-21T00:00:00Z' }), act('V-2', 'Blind as per list', { group: 'Operations' })],
    points: [pt('SEG-1', ['V-1'], 'in'), pt('SEG-2', ['V-2'], 'in'), pt('SEG-3', ['X-9'], 'open')],
  };
  const r = blindList(d);
  it('an item is positively isolated only when every blind is in', () => {
    expect(r.items.map((i) => [i.e.tag, i.inN, i.blinds.length, i.positive])).toEqual([['V-1', 1, 2, false], ['V-2', 2, 2, true]]);
  });
  it('flags items opened with no blind recorded and line blinds linked to no item', () => {
    expect(r.opened.map((e) => e.tag)).toEqual(['V-3']);
    expect(r.unlinked.map((p) => p.ref)).toEqual(['SEG-3']);
  });
});
