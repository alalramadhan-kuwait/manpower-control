// Made-up remarks only.
import { describe, expect, it } from 'vitest';
import type { StoredLog } from '../view';
import { attentionOf, tagsOf } from '../attention';

const L = (logNo: number, date: string, groups: Record<string, string[]>, role = 'CONTROLLER'): StoredLog => ({ kind: 'ards', logNo, date, shift: 'Morning', crew: 'A', day: '1st', recordedAt: null,
  readings: [], feed: [], products: [], sections: [{ role, groups: Object.entries(groups).map(([group, items]) => ({ group, items })) }] });

describe('attentionOf', () => {
  const older = L(1, '2030-05-01', { 'Train 2': ['Feed rate: 40 KBPD', 'H-901 pass-2 very low water flow.'], 'Low Pressure': ['P-950 B inlet MOV-955 closing issue.'] });
  const prev = L(2, '2030-05-02', { 'Train 2': ['H-901 Pass-2 very low water flow', 'TV 977 bypass one turn open.'], 'Low Pressure': ['P-950 B inlet MOV-955 closing issue, min 10% in field.'] });
  const log: StoredLog = { ...L(3, '2030-05-03', {}), sections: [
    { role: 'CONTROLLER', groups: [{ group: 'Train 2', items: ['Feed rate: 40 KBPD', 'H-901 Pass-2 very low water flow.', 'TV 977 bypass one turn open.'] }, { group: 'Low Pressure', items: ['P-950 B inlet MOV-955 closing issue.', 'T-904 sample sent to lab.', 'EA-905 D2 broken belt, to be replaced.'] }] },
    { role: 'FIELD OPERATOR', groups: [{ group: 'Train 2', items: ['H-901 Pass-2 very low water flow.', 'TV977 bypass around one turn open.'] }, { group: 'Train 1', items: ['P-950 A change over done.'] }] }] };
  const ctl: StoredLog = { ...L(9, '2030-05-03', { 'TRAIN-1': ['FEED RATE = 40KBPD.', 'E-912 LEAK FROM FLANGE, BOX UP REQUESTED.'] }, 'CONTROLLER I'), kind: 'controller1' };
  const a = attentionOf(log, ctl, [prev, older]);
  it('keeps the problems, drops routine lines and merges the same point', () => {
    expect(a.map((x) => [x.train, x.level, x.isNew, x.shifts])).toEqual([['Common', 'high', true, 1], ['TR-1', 'high', true, 1], ['TR-2', 'high', false, 3], ['Common', 'medium', false, 3], ['TR-2', 'medium', false, 2]]);
    expect(a[2].text).toBe('H-901 Pass-2 very low water flow');
    expect(a[3].text).toBe('P-950 B inlet MOV-955 closing issue');
    expect([a[2].since, a[4].since, a[1].roles]).toEqual(['2030-05-01', '2030-05-02', ['CONTROLLER I']]);
    expect(a[4].roles).toEqual(['CONTROLLER', 'FIELD OPERATOR']);
  });
  it('places a shared-area remark with a 200-series tag on train 2', () => {
    const lp = L(4, '2030-05-03', { 'Low Pressure': ['F-201 B bank XV passing, to be attended.', 'P-903 B inlet MOV-905 closing issue.'] });
    expect(attentionOf(lp, null, []).map((x) => [x.train, x.tags[0]])).toEqual([['Common', 'P-903'], ['TR-2', 'F-201']]);
  });
  it('treats a finished job as routine unless it still names an urgent problem', () => {
    const d = L(5, '2030-05-03', { 'Low Pressure': ['P-908 strainer cleaning done (30% choked).', 'TC-987 calibration done but still not ok.'] });
    expect(attentionOf(d, null, []).map((x) => [x.level, x.tags[0]])).toEqual([['high', 'TC-987']]);
  });
  it('reads tags written with a space or no dash', () => {
    expect(tagsOf('TV 977 and TC977, PSV-537, feed 42 KBPD')).toEqual(['TV-977', 'TC-977', 'PSV-537']);
  });
});
