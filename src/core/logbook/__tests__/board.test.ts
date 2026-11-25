// Made-up limits, logs and lab results only.
import { describe, expect, it } from 'vitest';
import type { Limit, LimitMatch } from '../limits';
import type { StoredLog, StoredSample } from '../view';
import { checksOf, handover, incidentsOf, sectionOf, summarize, trainOfEquipment, whatsappText, type BoardInput, type Override } from '../board';

const L = (o: Partial<Limit> & { paramId: string; section: string }): Limit => ({ description: o.paramId, unit: 'u', target: null, normalLo: null, normalHi: null,
  iowStd: null, iowCrit: null, trip: null, roc: null, source: 'src', action: null, status: 'active', ...o });
const lim = [
  L({ paramId: 'F1', section: 'A Feed', description: 'Feed rate', unit: 'KBPD', normalHi: 42 }),
  L({ paramId: 'W1', section: 'B Heater', description: 'Water per train', unit: 'gpm', normalLo: 24, normalHi: 37, status: 'verify' }),
  L({ paramId: 'H1-SKIN', section: 'B Heater', description: 'Skin A', unit: '°F', iowStd: '988', iowCrit: '1280' }),
  L({ paramId: 'H2-SKIN', section: 'C Heater', description: 'Skin B', unit: '°F', iowStd: '1042', iowCrit: '1280' }),
  L({ paramId: 'X-DP', section: 'D Reactor', description: 'Outlet ΔP', unit: 'psi', normalLo: 2, normalHi: 5 }),
  L({ paramId: 'M1', section: 'H Amine', description: 'Total amine', unit: 'wt%', normalLo: 15, normalHi: 20, iowStd: '15–20', action: 'Inform U-9' }),
  L({ paramId: 'Z1', section: 'G Water', description: 'Outlet temp', unit: '°F', iowStd: '550' }),
  L({ paramId: 'N1', section: 'J Common', description: 'Naphtha H2S', unit: 'ppm', normalHi: 1 }),
  L({ paramId: 'T1', section: 'F Gas', description: 'Target only', target: '190' }),
];
const limits = new Map(lim.map((l) => [l.paramId, l]));
const matches: LimitMatch[] = [
  { paramId: 'F1', kind: 'reading', key: 'FEED' }, { paramId: 'W1', kind: 'reading_sum', key: '/^WPASS\\d$/' },
  { paramId: 'H1-SKIN', kind: 'reading', key: '/^PASS\\dSKINTEMPH12101201$/' }, { paramId: 'H2-SKIN', kind: 'reading', key: '/^PASS\\dSKINTEMPH12102202$/' },
  { paramId: 'X-DP', kind: 'reading', key: 'XDP' }, { paramId: 'M1', kind: 'lab', material: 'AMINE', component: 'Total' }, { paramId: 'N1', kind: 'lab', material: 'NAPHTHA', component: 'H2S' },
];
const r = (key: string, tr1: string | null, tr2: string | null) => ({ label: key, key, tr1, tr2, unit: 'u' });
const skins = (pair: string, a: (string | null)[], b: (string | null)[]) => [1, 2, 3, 4].map((p, k) => r(`PASS${p}SKINTEMPH12${pair}`, a[k], b[k]));
const log: StoredLog = { kind: 'ards', logNo: 1, date: '2030-01-02', shift: 'Morning', crew: 'C', day: '2nd', recordedAt: null, feed: [], products: [],
  sections: [{ role: 'CONTROLLER', groups: [{ group: 'Train 1', items: ['P-901 A tripled at 9:28, restarted'] }] }],
  readings: [r('FEED', '25', '45'), r('WPASS1', '6', '7'), r('WPASS2', '6', '7'), r('WPASS3', '6', '0'), r('WPASS4', '6', '7'), r('XDP', '-0.3', '3'),
    ...skins('101201', ['900', '910', '920', '930'], ['600', '610', null, '630']), ...skins('102202', ['901', '911', '919', '931'], ['700', '700', '700', '700'])] };
const ctl: StoredLog = { ...log, kind: 'controller1', logNo: 2, readings: [], sections: [{ role: 'CONTROLLER I', groups: [{ group: 'TRAIN-1', items: ['@ 09:28 Feed pump trip due to instrument.'] }, { group: 'LP', items: ['P-901-A trip and start again.'] }] }] };
const S = (id: string, mat: string, eq: string, comp: string, v: string, t = '2030-01-02T04:00:00+00:00'): StoredSample => ({ sampleId: id, material: mat, equipment: eq, collectedAt: t, note: null, results: [{ component: comp, value: v, unit: 'x' }] });
const lab = [S('a', 'AMINE', 'T-101', 'Total', '20.7'), S('b', 'AMINE', 'T-201', 'Total', '20.9'), S('c', 'NAPHTHA', 'T-104', 'H2S', '5.5'), S('d', 'AMINE', 'T-101', 'Total', '99', '2030-01-05T04:00:00+00:00')];
const overrides: Override[] = [{ id: 'o', train: 'TR-2', item: 'C-201 overspeed trip on 2oo2', tags: null, reason: 'SI module faulty', moc: null, startedOn: '2030-01-01', expiresOn: null, source: 'spec' }];
const input: BoardInput = { log, controller: ctl, lab, limits, matches, overrides };
const get = (p: string, t: string) => checksOf(input).find((c) => c.paramId === p && c.train === t)!;

describe('checksOf', () => {
  it('judges readings, sums, lab results and missing values', () => {
    expect([get('F1', 'TR-1').state, get('F1', 'TR-2').state]).toEqual(['ok', 'off']);
    expect([get('W1', 'TR-1').value, get('W1', 'TR-1').state, get('W1', 'TR-2').value, get('W1', 'TR-2').state]).toEqual(['24', 'ok', '21', 'off']);
    expect(get('W1', 'TR-2').band).toBe('24–37 (verify)');
    expect([get('M1', 'TR-1').state, get('M1', 'TR-2').state, get('M1', 'TR-1').value]).toEqual(['bad', 'bad', '20.7']);      // other days' samples ignored
    expect([get('N1', 'Common').state, get('Z1', 'TR-1').state, get('Z1', 'TR-1').note]).toEqual(['off', 'grey', 'not in the e-logbook']);
    expect(checksOf(input).some((c) => c.paramId === 'T1')).toBe(false);          // a target alone is not a limit
  });
  it('flags a negative ΔP and copied heater skins for checking, and a missing pass', () => {
    expect([get('X-DP', 'TR-1').state, get('X-DP', 'TR-2').state]).toEqual(['chk', 'ok']);
    expect(get('H1-SKIN', 'TR-1').state).toBe('chk');
    expect([get('H1-SKIN', 'TR-2').state, get('H1-SKIN', 'TR-2').note]).toEqual(['grey', '1 of 4 not read']);
    expect(get('H2-SKIN', 'TR-1').value).toBe('931');
  });
});

describe('sections and incidents', () => {
  it('counts per section; grey once per parameter; the override counts on the gas loop', () => {
    const s = summarize(checksOf(input), overrides);
    expect([s.feed.off, s.feed.state, s.heat.off, s.heat.chk, s.heat.grey, s.gas.bad, s.gas.state, s.sep.grey, s.sep.greyIow, s.frac.off]).toEqual([1, 'off', 1, 1, 1, 3, 'bad', 1, 1, 1]);
    expect(sectionOf(lim[0])).toBe('feed');
  });
  it('joins remarks about the same trip (same time or same tag) and keeps its train', () => {
    const inc = incidentsOf(log, ctl);
    expect(inc).toHaveLength(1);
    expect([inc[0].word, inc[0].train, inc[0].time, inc[0].tags]).toEqual(['Trip', 'TR-1', '09:28', ['P-901']]);
  });
  it('places equipment on its train', () => {
    expect([trainOfEquipment('T-201'), trainOfEquipment('V-136'), trainOfEquipment('T-104'), trainOfEquipment('X')]).toEqual(['TR-2', 'TR-1', 'Common', null]);
  });
});

describe('handover', () => {
  it('puts overrides first, then both-train breaches, then each train', () => {
    const h = handover(input, checksOf(input));
    expect(h.map((l) => l.key)).toEqual(['Override', 'Both', 'TR-1', 'TR-2', 'Common']);
    expect(h[0].items[0].text).toBe('TR-2 C-201 overspeed trip on 2oo2 (SI module faulty) since 01/01 · expiry not set, MOC not set');
    expect(h[1].items[0].text).toContain('Inform U-9');
    expect(h[2].items[0]).toEqual({ st: 'bad', text: 'Trip: P-901 09:28 · P-901 A tripled at 9:28, restarted' });
    const w = whatsappText(log, h);
    expect(w.split('\n')[0]).toBe('*ARDS – Shift Handover Morning 2 Jan*');
    expect(w).toContain('• Overrides open: 1 – TR-2 C-201 overspeed trip on 2oo2');
  });
});
