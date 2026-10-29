import { describe, expect, it } from 'vitest';
import { bedMatrix, bedRowDone, bedRowOff, bedSets, type TrkActivity, type TrkEquipment } from '..';

const eq = (tag: string) => ({ id: tag, tag, barchartKey: tag } as unknown as TrkEquipment);
let n = 0;
const st = (key: string, activity: string, seq: number, x: Partial<TrkActivity> = {}) =>
  ({ id: `a${++n}`, activityId: `X${n}`, group: 'Mech', key, activity, durationH: null, start: null, finish: null, stage: null, tracked: true, seq, ...x } as TrkActivity);

describe('fixed-bed reactors on one page', () => {
  it('finds a set only when all four reactors are listed', () => {
    const s = bedSets(['R-12-203', 'R-12-201', 'R-12-204', 'R-12-202', 'R-12-205', 'E-12-129'].map(eq));
    expect(s).toHaveLength(1);
    expect(s[0].label).toBe('R-201 – R-204');
    expect(s[0].keys).toEqual(['R-12-201', 'R-12-202', 'R-12-203', 'R-12-204']);
    expect(bedSets(['R-12-201', 'R-12-202', 'R-12-203'].map(eq))).toEqual([]);
  });
  it('lines the steps up by name in each reactor order; missing and not-required cells are kept apart', () => {
    const t = '2026-10-29T05:00:00Z';
    const acts = [
      st('A', 'Blind', 1, { actualStart: t, actualFinish: t }), st('A', 'Initial inspection', 2, { actualStart: t, actualFinish: t }), st('A', 'Load  catalyst', 3),
      st('B', 'Blind', 1, { actualStart: t, actualFinish: t }), st('B', 'Repair if required', 2, { tracked: false, disabledReason: 'not required' }), st('B', 'Load catalyst', 3, { actualStart: t }),
      st('B', 'Scaffold', 4, { tracked: false, disabledReason: 'not required' }), st('B', 'Field check', 5, { detail: true }), st('B', 'Gone', 6, { tracked: false, disabledReason: 'out of scope', outOfScope: true }),
    ];
    const m = bedMatrix(acts, ['A', 'B']);
    expect(m.map((r) => r.name)).toEqual(['Blind', 'Repair if required', 'Initial inspection', 'Load  catalyst', 'Scaffold']);
    const by = (name: string) => m.find((r) => r.name === name)!.cells.map((c) => c.state);
    expect(by('Initial inspection')).toEqual(['done', 'none']);
    expect(by('Repair if required')).toEqual(['none', 'nr']);
    expect(by('Load  catalyst')).toEqual(['open', 'run']);
    expect(bedRowDone(m[0])).toBe(true);
    expect(bedRowDone(m.find((r) => r.name === 'Initial inspection')!)).toBe(true);
    expect(bedRowOff(m.find((r) => r.name === 'Scaffold')!)).toBe(true);
    expect(bedRowDone(m.find((r) => r.name === 'Load  catalyst')!)).toBe(false);
  });
});
