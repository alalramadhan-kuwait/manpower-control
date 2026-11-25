// Made-up logs and samples only.
import { describe, expect, it } from 'vitest';
import type { RemarkSection, Reading } from '../parse';
import { byShiftDesc, eventsIn, followUps, kuwaitParts, labDays, labTrend, samplesOn, skinGrid, tagsIn, type StoredSample } from '../view';

const sec = (...items: string[]): RemarkSection[] => [{ role: 'CONTROLLER', groups: [{ group: 'OCR', items }] }];
const rd = (label: string, key: string, tr1: string | null, tr2: string | null): Reading => ({ label, key, tr1, tr2, unit: '°F' });

describe('tagsIn', () => {
  it('finds equipment tags, drops the unit prefix, skips unit and train numbers', () => {
    expect(tagsIn('P-901A tripped; TC-987 on manual; R-12-905 dP; feed to U-916; TR-2 steady; PSV-937/938')).toEqual(['P-901A', 'TC-987', 'R-905', 'PSV-937']);
  });
});

describe('followUps', () => {
  it('counts how many logs in a row named a tag', () => {
    const f = followUps(sec('TC-987 still on manual', 'P-900 started'), [sec('TC-987 calibrated'), sec('TC-987 not ok'), sec('nothing')]);
    expect(f).toEqual([
      { tag: 'TC-987', text: 'TC-987 still on manual', group: 'OCR', logs: 3 },
      { tag: 'P-900', text: 'P-900 started', group: 'OCR', logs: 1 },
    ]);
  });
});

describe('eventsIn', () => {
  it('picks out trips and leaks once each', () => {
    expect(eventsIn(sec('Pump A tripped at 09:00', 'Small leak at flange', 'All normal'))).toEqual([
      { word: 'Tripped', text: 'Pump A tripped at 09:00', group: 'OCR' }, { word: 'Leak', text: 'Small leak at flange', group: 'OCR' }]);
  });
});

describe('byShiftDesc', () => {
  it('orders by date then Night, Afternoon, Morning', () => {
    const xs = [{ date: '2030-01-02', shift: 'Morning', logNo: 5 }, { date: '2030-01-01', shift: 'Night', logNo: 4 }, { date: '2030-01-02', shift: 'Night', logNo: 7 }];
    expect(byShiftDesc(xs).map((x) => x.logNo)).toEqual([7, 5, 4]);
  });
});

describe('skinGrid', () => {
  it('lays the pass rows out as heater columns', () => {
    const g = skinGrid([rd('PASS-1 SKIN TEMP (H-12-101/201)', 'PASS1SKINTEMPH12101201', '800', '700'), rd('PASS-1 SKIN TEMP (H-12-102 /202)', 'PASS1SKINTEMPH12102202', '810', null),
      rd('PASS 2 SKIN TEMP (H 12-101/201)', 'PASS2SKINTEMPH12101201', '805', '705'), rd('FEED', 'FEED', '1', '2')]);
    expect(g).toEqual({ heaters: ['H-101', 'H-201', 'H-102', 'H-202'], unit: '°F', passes: [
      { pass: 1, values: ['800', '700', '810', null] }, { pass: 2, values: ['805', '705', null, null] }] });
    expect(skinGrid([rd('FEED', 'FEED', '1', '2')])).toBeNull();
  });
});

describe('lab helpers', () => {
  const s = (id: string, at: string, v: string): StoredSample => ({ sampleId: id, material: 'OIL', equipment: 'T-1', collectedAt: at, note: null, results: [{ component: 'S', unit: '%', value: v }] });
  const xs = [s('a', '2030-01-01T22:30:00+00:00', '0.1'), s('b', '2030-01-02T04:00:00+00:00', '0.2'), s('c', '2030-01-01T20:00:00+00:00', '0.3')];
  it('uses Kuwait dates', () => {
    expect(kuwaitParts('2030-01-01T22:30:00+00:00')).toEqual({ date: '2030-01-02', time: '01:30' });
    expect(labDays(xs)).toEqual(['2030-01-02', '2030-01-01']);
    expect(samplesOn(xs, '2030-01-02').map((x) => x.sampleId)).toEqual(['a', 'b']);
  });
  it('follows one test at one point, newest first', () => {
    expect(labTrend(xs, xs[0], 'S').map((x) => x.r!.value)).toEqual(['0.2', '0.1', '0.3']);
  });
});
