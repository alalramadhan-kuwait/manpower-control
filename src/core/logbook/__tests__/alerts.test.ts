// Made-up limits, logs and lab results only.
import { describe, expect, it } from 'vitest';
import type { Limit, LimitMatch } from '../limits';
import type { StoredLog, StoredSample } from '../view';
import { labAlert, logAlert } from '../alerts';
import { componentRank, productCards, shiftEnd, shortComponent } from '../products';

const L = (o: Partial<Limit> & { paramId: string }): Limit => ({ section: 'J Common', description: o.paramId, unit: 'u', target: null, normalLo: null, normalHi: null,
  iowStd: null, iowCrit: null, trip: null, roc: null, source: 'src', action: null, status: 'active', ...o });
const limits = new Map([L({ paramId: 'F1', section: 'A Feed', normalHi: 40 }), L({ paramId: 'Q1', description: 'Product sulfide', normalHi: 2 }), L({ paramId: 'M1', section: 'H Amine', description: 'Amine strength', iowStd: '10–12' })].map((l) => [l.paramId, l]));
const matches: LimitMatch[] = [{ paramId: 'F1', kind: 'reading', key: 'FEED' }, { paramId: 'Q1', kind: 'lab', material: 'LIGHT CUT', component: 'H2S' }, { paramId: 'M1', kind: 'lab', material: 'AMINE', component: 'Strength' }];
const r = (key: string, tr1: string, tr2: string) => ({ label: key, key, tr1, tr2, unit: 'u' });
const log: StoredLog = { kind: 'ards', logNo: 7, date: '2030-03-04', shift: 'Night', crew: 'A', day: '1st', recordedAt: null, feed: [], products: [],
  sections: [{ role: 'CONTROLLER', groups: [{ group: 'Train 2', items: ['P-950 B tripped at 02:10, restarted'] }] }], readings: [r('FEED', '30', '44')] };
const S = (id: string, mat: string, eq: string, t: string, res: [string, string, string | null][]): StoredSample => ({ sampleId: id, material: mat, equipment: eq, collectedAt: t, note: null, results: res.map(([component, value, unit]) => ({ component, value, unit })) });

describe('logAlert', () => {
  it('gives one line per train and the trips', () => {
    const a = logAlert({ log, controller: null, lab: [], limits, matches, overrides: [] });
    expect(a.title).toBe('Unit log · Mon 4 Mar Night');
    expect(a.body.split('\n')).toEqual(['TR-1 ✓ in range', 'TR-2 ▲ 1 off', 'Common ✓ in range', 'Trip: P-950 02:10 (TR-2)']);
    expect(a.url).toContain('tab=overview');
  });
});

describe('labAlert', () => {
  it('puts results beyond the limits first and counts the rest', () => {
    const xs = [S('a', 'AMINE', 'T-901', '2030-03-04T03:00:00Z', [['Strength', '13', '%']]), S('b', 'LIGHT CUT', 'T-904', '2030-03-04T03:30:00Z', [['H2S', '1', 'ppm'], ['Colour', '+30', null]])];
    const a = labAlert(xs, limits, matches)!;
    expect(a.title).toBe('Lab results · Mon 4 Mar 06:30 · 2 samples');
    expect(a.body).toBe('● Amine strength 13 % (T-901)');
    expect(labAlert([xs[1]], limits, matches)!.body).toBe('✓ 1 result within limits');
    expect(labAlert([], limits, matches)).toBeNull();
  });
});

describe('productCards', () => {
  it('takes the newest sample up to the day and compares with the one before', () => {
    const lab = [S('1', 'NAPHTHA', 'T-904', '2030-03-03T04:00:00Z', [['H2S', '0.5', 'ppm'], ['API Gravity @ 60 F', '70.0', null]]),
      S('2', 'NAPHTHA', 'T-904', '2030-03-04T04:00:00Z', [['H2S', '3', 'ppm'], ['API Gravity @ 60 F', '70.0', null]]),
      S('3', 'NAPHTHA', 'T-904', '2030-03-05T04:00:00Z', [['H2S', '9', 'ppm']])];
    const m: LimitMatch[] = [{ paramId: 'Q1', kind: 'lab', material: 'NAPHTHA', component: 'H2S' }];
    const [nap, dist] = productCards(lab, shiftEnd('2030-03-04', 'Morning'), '2030-03-04', limits, m);
    expect([nap.sample?.sampleId, nap.when, dist.sample]).toEqual(['2', '07:00', null]);
    expect(nap.values.map((v) => [v.label, v.value, v.prev, v.move, v.state])).toEqual([['API', '70.0', '70.0', 'same', null], ['H₂S', '3', '0.5', 'up', 'off']]);
    // a later, smaller sample: H2S from it, API still from the one before
    const later = productCards([...lab, S('4', 'NAPHTHA', 'T-904', '2030-03-04T09:00:00Z', [['H2S', '1', 'ppm']])], shiftEnd('2030-03-04', 'Afternoon'), '2030-03-04', limits, m)[0];
    expect([later.when, later.values.map((v) => `${v.label} ${v.value} ${v.prev}`)]).toEqual(['12:00', ['API 70.0 70.0', 'H₂S 1 3']]);
    expect([shiftEnd('2030-03-04', 'Night'), shiftEnd('2030-03-04', 'Morning')]).toEqual(['2030-03-05 06:00', '2030-03-04 14:00']);
  });
  it('shortens the lab names', () => {
    expect(['FBP', '10%', 'Sulphur', '5%', 'IBP', 'API'].sort((a, b) => componentRank(a) - componentRank(b))).toEqual(['API', 'Sulphur', 'IBP', '5%', '10%', 'FBP']);
    expect(['Distillation 05%', 'Distillaiton 10%', 'Distillation FBP', 'Sulphur, Total', 'Colour, Saybolt', 'Recovery'].map(shortComponent)).toEqual(['5%', '10%', 'FBP', 'Sulphur', 'Colour', 'Recovery']);
  });
});
