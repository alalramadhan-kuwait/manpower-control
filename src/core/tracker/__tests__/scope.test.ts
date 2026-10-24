// Equipment scope: out of scope keeps the records and stops counting; grouping by system is display only.
import { describe, expect, it } from 'vitest';
import { isOutOfScope, logText, scopeImpact, scopeReasonText, shownGroup, ROTATING, type TrkActivity, type TrkEquipment } from '..';

const eq = (tag: string, group: string, more: Partial<TrkEquipment> = {}): TrkEquipment => ({ id: tag, tag, group, description: null, fo: null, hoStep: null, procedure: null, barchartKey: tag, opsItem: true, critical: false, tracked: true,
  disabledReason: null, plannedHo: null, plannedFinish: null, sort: 0, stage: 0, pendingReason: null, remark: null, blindsIn: null, blindsOut: null, updatedBy: null, updatedAt: null, ...more });
const act = (key: string, h: number, more: Partial<TrkActivity> = {}): TrkActivity => ({ id: key + h, activityId: key + h, group: 'M', key, activity: 'x', durationH: h, start: null, finish: null, stage: 1, tracked: true, ...more });

describe('equipment scope', () => {
  it('an item out of scope is recognised and its reason read back', () => {
    const e = eq('C-12-201-E-03', 'Compressor', { tracked: false, disabledReason: 'out of scope: not in this shutdown' });
    expect(isOutOfScope(e)).toBe(true); expect(isOutOfScope(eq('X', 'Y', { tracked: false, disabledReason: 'not tracked' }))).toBe(false);
    expect(scopeReasonText(e.disabledReason)).toBe('not in this shutdown');
  });
  it('the impact counts the planned hours of out-of-scope work against all planned work; detail and Operations lines left out', () => {
    const d = { equipment: [eq('A', 'G'), eq('B', 'G', { tracked: false, disabledReason: 'out of scope: x y z' })],
      activities: [act('A', 30), act('B', 10, { tracked: false, outOfScope: true }), act('A', 50, { detail: true }), act('A', 40, { group: 'Operations' }), act('A', 5, { tracked: false })] };
    expect(scopeImpact(d)).toEqual({ items: 1, hours: 10, totalH: 40, pct: 25 });
  });
  it('a system groups items under its main item, without changing their own group', () => {
    const items = [eq('C-12-201', 'Compressor', { system: 'C-12-201 Recycle gas compressor system' }), eq('C-12-201-F-01B', 'Filters', { system: 'C-12-201 Recycle gas compressor system' }), eq('E-205', 'Exchangers')];
    const g = shownGroup(items);
    expect(items.map(g)).toEqual(['Compressor', 'Compressor', 'Exchangers']); expect(items[1].group).toBe('Filters');
  });
  it('the history says out of scope / back in scope with the reason, and edits of name, group and system', () => {
    const l = (field: string, o: string | null, n: string | null) => logText({ kind: 'equipment', ref: 'E-12-205', field, oldValue: o, newValue: n, byName: 'x', at: '2026-10-24T10:00:00Z' }).what;
    expect(l('scope', null, 'out of scope: spare not installed')).toBe('⊘ out of scope · spare not installed');
    expect(l('scope', 'out of scope: spare not installed', null)).toBe('↺ back in scope');
    expect(l('system', null, 'C-12-201 Recycle gas compressor system')).toContain('system');
  });
  it('routine rotating items are listed under Rotating scope; their steps still count as before', () => {
    const sys = 'C-12-201 Recycle gas compressor system';
    const items = [eq('C-12-201', 'Compressor', { system: sys }), eq('C-12-201-E-03', 'Exchangers', { system: sys, list: 'rotating' }), eq('C-12-201-TK-03', 'Vessels', { system: sys })];
    const g = shownGroup(items);
    expect(g(items[1])).toBe(ROTATING); expect(g(items[2])).toBe('Compressor');
    const all = scopeImpact({ equipment: items, activities: [act('C-12-201-E-03', 8), act('C-12-201', 40)] });
    const plain = scopeImpact({ equipment: items.map((e) => ({ ...e, list: null })), activities: [act('C-12-201-E-03', 8), act('C-12-201', 40)] });
    expect(all).toEqual(plain);
    const l = (n: string | null) => logText({ id: '1', at: '', kind: 'equipment', ref: 'C-12-201-E-03', field: 'list', oldValue: null, newValue: n, byName: null } as never);
    expect(JSON.stringify(l('rotating'))).toContain(ROTATING);
  });
});
