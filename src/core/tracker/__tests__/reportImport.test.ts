// Daily report import: read the plant's text, propose only forward changes, drums once per report.
import { describe, expect, it } from 'vitest';
import { parseReport, planImport, tagsOf } from '../reportImport';
import type { TrkActivity, TrkData, TrkEquipment } from '..';

const eq = (tag: string, more: Partial<TrkEquipment> = {}): TrkEquipment => ({ id: tag, tag, group: 'G', description: null, fo: null, hoStep: null, procedure: null, barchartKey: tag, opsItem: true, critical: false, tracked: true,
  disabledReason: null, plannedHo: null, plannedFinish: null, sort: 0, stage: 1, pendingReason: null, remark: null, blindsIn: null, blindsOut: null, updatedBy: null, updatedAt: '2026-10-24T06:00:00Z', ...more });
const act = (key: string, id: string, activity: string, more: Partial<TrkActivity> = {}): TrkActivity => ({ id: key + id, activityId: id, group: 'M', key, activity, durationH: 8, start: null, finish: null, stage: 2, tracked: true, updatedAt: '2026-10-24T06:00:00Z', ...more });
const TEXT = `*Unit-12* 7:00 pm 24/10\n*Train-2 Shutdown Report*\n* R-201:Internal cleaning done.\n* R-205: Dumping I/P. 1508 drums.\n* H-201: Pass-4 pigging I/P.\n* E-216 A/B: Shell pulled out.\n* E-207: Cleaning I/P.\n* ⁠RTJ flanges inspection I/P.\n- E-122: floating head opened.`;
const data = (): TrkData => ({ steps: [], iats: [],
  equipment: [eq('R-12-201', { remark: 'Trays cleaning I/P' }), eq('R-12-205'), eq('H-12-201'), eq('E-12-216A'), eq('E-12-216B'), eq('E-12-207', { remark: 'Shell hydroblasting done, bundle external cleaning I/P' })],
  activities: [act('R-12-201', 'A1', 'Cleaning all internal by Hydrojetting', { actualStart: '2026-10-24T06:00:00Z' }), act('R-12-201', 'A2', 'Manual cleaning', { actualStart: '2026-10-23T06:00:00Z', actualFinish: '2026-10-23T09:00:00Z' }),
    act('H-12-201', 'P3', 'Pass 3 pigging', { actualStart: '2026-10-24T07:00:00Z' }), act('H-12-201', 'P4', 'Pass 4 pigging'),
    act('E-12-216B', 'S', 'Pull out shell', { actualStart: '2026-10-23T16:00:00Z' }), act('E-12-216A', 'S', 'Pull out shell', { actualStart: '2026-10-23T16:00:00Z', actualFinish: '2026-10-24T05:00:00Z' })],
  engine: { scopes: [{ id: 'sc5', key: 'R-12-205', scope: 'removal', unit: 'drums', low: null, high: null, initial: null, working: null, activityIds: [], completeAt: null, completeBy: null }],
    entries: [{ id: 'e1', scopeId: 'sc5', shiftDate: '2026-10-24', shift: 'D', kind: 'removal', method: 'vacuum', qty: 1150, verify: 'verified', remark: 'morning', source: 'plant_report', enteredBy: null, enteredByName: null, enteredAt: '', verifiedByName: null, verifiedAt: null }], estimates: [], updates: [] },
} as unknown as TrkData);

describe('daily report import', () => {
  it('reads tags as the plant writes them', () => {
    expect(tagsOf('E-216 A/B')).toEqual(['E-12-216A', 'E-12-216B']); expect(tagsOf('V-202 / V-210')).toEqual(['V-12-202', 'V-12-210']); expect(tagsOf('R-201')).toEqual(['R-12-201']);
    const r = parseReport(TEXT, 2026); expect(r.at).toBe('2026-10-24T16:00:00.000Z'); expect(r.lines.find((l) => l.tags[0] === 'R-12-205')?.drums).toBe(1508);
  });
  it('proposes forward steps, the next pass, status lines and drums up to the total', () => {
    const p = planImport(data(), parseReport(TEXT, 2026));
    const has = (k: string, tag: string, name?: string) => p.changes.some((c) => c.kind === k && c.tag === tag && (!name || ('activity' in c && c.activity.activity === name)));
    expect(has('finish', 'R-12-201', 'Cleaning all internal by Hydrojetting')).toBe(true);
    expect(has('start', 'H-12-201', 'Pass 4 pigging') && has('finish', 'H-12-201', 'Pass 3 pigging')).toBe(true);
    expect(has('finish', 'E-12-216B', 'Pull out shell')).toBe(true); expect(has('finish', 'E-12-216A')).toBe(false);
    const d = p.changes.find((c) => c.kind === 'drums'); expect(d && d.kind === 'drums' && d.add === 358 && d.corrects === 'e1').toBe(true);
  });
  it('never moves the tracker back: a fuller status stays ticked off; other units and plain lines are listed as not changed', () => {
    const p = planImport(data(), parseReport(TEXT, 2026));
    expect(p.changes.find((c) => c.kind === 'remark' && c.tag === 'E-12-207')?.on).toBe(false);
    expect(p.skipped.map((s) => s.why)).toEqual(expect.arrayContaining(['not in this tracker', 'not an item line']));
  });
  it('enters the drums of a report only once', () => {
    const d = data(); d.engine!.entries.push({ ...d.engine!.entries[0], id: 'e2', kind: 'correction', qty: 358, remark: 'Report 24/10 19:00: total 1508' } as never);
    const p = planImport(d, parseReport(TEXT, 2026));
    expect(p.changes.some((c) => c.kind === 'drums')).toBe(false); expect(p.skipped.some((s) => s.why === 'this report is already entered')).toBe(true);
  });
});
