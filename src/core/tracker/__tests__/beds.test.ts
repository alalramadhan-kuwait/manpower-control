import { describe, expect, it } from 'vitest';
import { doneShare, stepLate, bedItemDone, bedLate, bedMatrix, bedName, bedRowDone, bedRowOff, bedSets, bedWindow, stepGroups, type TrkActivity, type TrkEquipment } from '..';

let n = 0;
const eq = (tag: string, x: Partial<TrkEquipment> = {}) => ({ id: tag, tag, barchartKey: tag, group: 'Reactors', sort: n++, ...x } as unknown as TrkEquipment);
const st = (key: string, activity: string, seq: number, x: Partial<TrkActivity> = {}) =>
  ({ id: `a${++n}`, activityId: `X${n}`, group: 'Mech', key, activity, durationH: null, start: null, finish: null, stage: null, tracked: true, seq, ...x } as TrkActivity);
const t = '2026-10-29T05:00:00Z';

describe('items on one page', () => {
  it('groups by type and department; the four fixed beds keep their range label', () => {
    const reactors = ['R-12-201', 'R-12-202', 'R-12-203', 'R-12-204'].map((x) => eq(x));
    const r205 = eq('R-12-205', { inspRef: 'worklist item 10' });
    const acts = [...reactors, r205].flatMap((e) => ['Blind', 'Load catalyst', 'Deblind'].map((s, i) => st(e.tag, s, i + 1)));
    const g = stepGroups([...reactors, r205], acts);
    expect(g.map((x) => x.label)).toEqual(['R-201 – R-204']);
    expect(g[0].dept).toBe('cleaning');
    expect(bedSets([...reactors, r205], acts)[0].keys).toEqual(['R-12-201', 'R-12-202', 'R-12-203', 'R-12-204']);
  });
  it('splits a large type by department, leaves out rotating items and groups whose steps do not line up', () => {
    const v = [eq('V-1', { group: 'Vessels', inspRef: 'x' }), eq('V-2', { group: 'Vessels', inspRef: 'x' }), eq('V-3', { group: 'Vessels' }), eq('V-4', { group: 'Vessels' }), eq('V-5', { group: 'Vessels' }), eq('P-1', { group: 'Vessels', list: 'rotating' })];
    const e = [eq('E-1', { group: 'Exchangers' }), eq('E-2', { group: 'Exchangers' })];
    const acts = [...['V-1', 'V-2', 'V-3', 'V-4', 'V-5', 'P-1'].flatMap((k) => ['Blind', 'Box-up', 'Deblind'].map((s, i) => st(k, s, i))),
      ...['Blind', 'Pull bundle', 'Hydrotest', 'Retube'].map((s, i) => st('E-1', s, i)), ...['Blind', 'Shell out', 'Grit blast', 'Paint'].map((s, i) => st('E-2', s, i))];
    expect(stepGroups([...v, ...e], acts).map((x) => `${x.label}:${x.keys.join(',')}`)).toEqual(['Vessels · inspection:V-1,V-2', 'Vessels · cleaning / painting:V-3,V-4,V-5']);
  });
  it('matches names without case, punctuation or test pressure', () => {
    expect(bedName('Shell Hydrotest at 225 PSIG')).toBe(bedName('shell hydrotest at 300 psig'));
    expect(bedName('Hydrotest (2860 psig)')).toBe('hydrotest');
    expect(bedName('Neutralize with 2% soda ash.')).toBe(bedName('neutralize with 2% soda ash'));
  });
  it('lines the steps up by name in each item order; missing and not-required cells are kept apart', () => {
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
    expect(bedRowOff(m.find((r) => r.name === 'Scaffold')!)).toBe(true);
    expect(bedRowDone(m.find((r) => r.name === 'Load  catalyst')!)).toBe(false);
    expect(bedItemDone(m, 0)).toBe(false);
  });
  it('late against the plan: not started after the plan start, not done after the plan finish, finished late', () => {
    const now = Date.parse('2026-10-29T16:00:00Z');
    const plan = { start: '2026-10-29T12:00:00Z', finish: '2026-10-30T06:00:00Z' };
    const m = bedMatrix([st('A', 'Load', 1, plan), st('B', 'Load', 1, { ...plan, actualStart: t }), st('C', 'Load', 1, { start: '2026-10-28T00:00:00Z', finish: '2026-10-28T12:00:00Z', actualStart: t, actualFinish: '2026-10-29T00:00:00Z' })], ['A', 'B', 'C']);
    const [a, b, c] = m[0].cells.map((x) => bedLate(x, now));
    expect(a).toEqual({ late: true, byH: 4 });
    expect(b.late).toBe(false);
    expect(c).toEqual({ late: true, byH: 12 });
    expect(bedWindow(m[0])).toEqual({ start: Date.parse('2026-10-28T00:00:00Z'), finish: Date.parse('2026-10-30T06:00:00Z') });
  });
});

describe('linked items and small types', () => {
  it('linked items get their own page; a type of four or fewer is one page across departments when three steps are shared', () => {
    const items = [eq('E-1', { group: 'Exchangers', inspRef: 'x', linked: 'E-1 + E-2' }), eq('E-2', { group: 'Exchangers', linked: 'E-1 + E-2' }), eq('E-3', { group: 'Exchangers' }),
      eq('H-1', { group: 'Heaters', inspRef: 'x' }), eq('H-2', { group: 'Heaters' })];
    const acts = [...['E-1', 'E-2'].flatMap((k) => ['Blind', 'Hydrotest shell & tube · 300 / 200 psig'].map((s, i) => st(k, s, i))), st('E-3', 'Blind', 1),
      ...['H-1', 'H-2'].flatMap((k) => ['Blind', 'Burners down', 'Fix back burners', 'Deblind'].map((s, i) => st(k, s, i))), st('H-1', 'Pass 1 pigging', 9)];
    const g = stepGroups(items, acts);
    expect(g.map((x) => `${x.label}:${x.dept}:${x.keys.join(',')}`)).toEqual(['E-1 + E-2 · linked:mixed:E-1,E-2', 'Heaters:mixed:H-1,H-2']);
  });
});

describe('type page helpers (owner, 31 Oct 2026)', () => {
  it('done share by plan hours, else by count; late open steps', () => {
    expect(doneShare([])).toBeNull();
    expect(doneShare([{ durationH: 30, actualFinish: 'x' }, { durationH: 10, actualFinish: null }])).toBe(0.75);
    expect(doneShare([{ durationH: null, actualFinish: 'x' }, { durationH: null, actualFinish: null }])).toBe(0.5);
    const now = Date.parse('2026-10-31T10:00:00Z');
    expect(stepLate({ start: '2026-10-30T00:00:00Z', finish: '2026-11-02T00:00:00Z', actualStart: null, actualFinish: null }, now)).toBe(true);
    expect(stepLate({ start: '2026-10-30T00:00:00Z', finish: '2026-11-02T00:00:00Z', actualStart: 'x', actualFinish: null }, now)).toBe(false);
    expect(stepLate({ start: null, finish: '2026-10-30T00:00:00Z', actualStart: 'x', actualFinish: 'y' }, now)).toBe(false);
  });
});
