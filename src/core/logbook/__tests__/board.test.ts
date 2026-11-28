// Made-up limits, logs and lab results only.
import { describe, expect, it } from 'vitest';
import type { Limit, LimitMatch } from '../limits';
import type { StoredLog, StoredSample } from '../view';
import { checksOf, handover, incidentsOf, reactorStrip, sectionOf, splitPoint, summarize, trainOfEquipment, whatsappText, type BoardInput, type Override } from '../board';

const L = (o: Partial<Limit> & { paramId: string; section: string }): Limit => ({ description: o.paramId, unit: 'u', target: null, normalLo: null, normalHi: null,
  iowStd: null, iowCrit: null, trip: null, roc: null, source: 'src', action: null, status: 'active', ...o });
const lim = [
  L({ paramId: 'F1', section: 'A Feed', description: 'Feed rate', unit: 'KBPD', normalHi: 40 }),
  L({ paramId: 'W1', section: 'B Heater', description: 'Water per train', unit: 'gpm', normalLo: 22, normalHi: 30, status: 'verify' }),
  L({ paramId: 'H1-SKIN', section: 'B Heater', description: 'Skin A', unit: '°F', iowStd: '960', iowCrit: '1200' }),
  L({ paramId: 'H2-SKIN', section: 'C Heater', description: 'Skin B', unit: '°F', iowStd: '1010', iowCrit: '1200' }),
  L({ paramId: 'X-DP', section: 'D Reactor', description: 'Outlet ΔP', unit: 'psi', normalLo: 1, normalHi: 4 }),
  L({ paramId: 'M1', section: 'H Amine', description: 'Total amine', unit: 'wt%', normalLo: 16, normalHi: 19, iowStd: '16–19', action: 'Inform U-9' }),
  L({ paramId: 'Z1', section: 'G Water', description: 'Outlet temp', unit: '°F', iowStd: '530' }),
  L({ paramId: 'N1', section: 'J Common', description: 'Naphtha H2S', unit: 'ppm', normalHi: 2 }),
  L({ paramId: 'T1', section: 'F Gas', description: 'Target only', target: '160' }),
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
const lab = [S('a', 'AMINE', 'T-101', 'Total', '20.7'), S('b', 'AMINE', 'T-201', 'Total', '20.9'), S('c', 'NAPHTHA', 'T-104', 'H2S', '6.1'), S('d', 'AMINE', 'T-101', 'Total', '99', '2030-01-05T04:00:00+00:00')];
const overrides: Override[] = [{ id: 'o', train: 'TR-2', item: 'Compressor overspeed trip bypassed', tags: null, reason: 'speed probe faulty', moc: null, startedOn: '2030-01-01', expiresOn: null, source: 'spec' }];
const input: BoardInput = { log, controller: ctl, lab, limits, matches, overrides };
const get = (p: string, t: string) => checksOf(input).find((c) => c.paramId === p && c.train === t)!;

describe('checksOf', () => {
  it('judges readings, sums, lab results and missing values', () => {
    expect([get('F1', 'TR-1').state, get('F1', 'TR-2').state]).toEqual(['ok', 'off']);
    expect([get('W1', 'TR-1').value, get('W1', 'TR-1').state, get('W1', 'TR-2').value, get('W1', 'TR-2').state]).toEqual(['24', 'ok', '21', 'off']);
    expect(get('W1', 'TR-2').band).toBe('22–30 (verify)');
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
    const t1 = summarize(checksOf(input), overrides, 'TR-1'), t2 = summarize(checksOf(input), overrides, 'TR-2');
    expect([t1.feed.off, t2.feed.off, t1.gas.bad, t2.gas.bad, t1.heat.chk, summarize(checksOf(input), overrides, 'Common').frac.off]).toEqual([0, 1, 1, 2, 1, 1]);
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
    expect(h[0].items[0].text).toBe('TR-2 Compressor overspeed trip bypassed (speed probe faulty) since 01/01 · expiry not set, MOC not set');
    expect(h[1].items[0].text).toContain('Inform U-9');
    expect(h[2].items[0]).toEqual({ st: 'bad', text: 'Trip: P-901 09:28 · P-901 A tripled at 9:28, restarted' });
    const w = whatsappText(log, h);
    expect(w.split('\n')[0]).toBe('*ARDS – Shift Handover Morning 2 Jan*');
    expect(w).toContain('• Overrides open: 1 – TR-2 Compressor overspeed trip bypassed');
  });
});

describe('reactor exotherm and ΔP', () => {
  const dl = (o: Partial<Limit> & { paramId: string }) => L({ section: 'E Reactors', ...o });
  const lims = new Map([dl({ paramId: 'OCR-DT', normalHi: 45 }), dl({ paramId: 'FB-AXDT', normalHi: 30 }), dl({ paramId: 'RX-RISE', normalHi: 70 }), dl({ paramId: 'FB-DP', normalHi: 90 }), dl({ paramId: 'OCR-DP-TOT', normalHi: 65 })].map((l) => [l.paramId, l]));
  const m: LimitMatch[] = [{ paramId: 'OCR-DT', kind: 'reading_diff', key: 'OUTLETTEMPERATURER12105205', key2: 'INLETTEMPERATURER12105205' },
    { paramId: 'FB-AXDT', kind: 'reading_diff', key: '/^OUTLETTEMPERATURER1210[1-4]/' }, { paramId: 'RX-RISE', kind: 'reading_diff', key: 'OUTLETTEMPERATURER12104204', key2: 'INLETTEMPERATURER12105205' }];
  const rd: StoredLog = { ...log, sections: [], readings: [r('INLETTEMPERATURER12105205', '600', '600'), r('OUTLETTEMPERATURER12105205', '640', '660'),
    r('INLETTEMPERATURER12101201', '610', '610'), r('OUTLETTEMPERATURER12101201', '630', '615'), r('INLETTEMPERATURER12104204', '620', null), r('OUTLETTEMPERATURER12104204', '625', '640'),
    r('REACTORDELTAPRESSURER12105205', '20', '70'), r('REACTORDELTAPRESSURER12103R12203', '40', '120')] };
  const cs = checksOf({ ...input, log: rd, controller: null, limits: lims, matches: m });
  const c = (p: string, t: string) => cs.find((x) => x.paramId === p && x.train === t)!;
  it('works out outlet − inlet per reactor and the net rise', () => {
    expect([c('OCR-DT', 'TR-1').value, c('OCR-DT', 'TR-1').state, c('OCR-DT', 'TR-2').value, c('OCR-DT', 'TR-2').state]).toEqual(['40', 'ok', '60', 'off']);
    expect([c('FB-AXDT', 'TR-1').value, c('FB-AXDT', 'TR-1').note, c('FB-AXDT', 'TR-2').state, c('FB-AXDT', 'TR-2').note]).toEqual(['20', 'R-101 20 · R-104 5', 'grey', 'R-201 5 · 1 of 2 not read']);
    expect([c('RX-RISE', 'TR-1').value, c('RX-RISE', 'TR-2').value]).toEqual(['25', '40']);
  });
  it('lays out ΔP and ΔT per reactor in flow order', () => {
    const s1 = reactorStrip(rd, lims, 'TR-2');
    expect(s1.dp.map((x) => `${x.name} ${x.value} ${x.st}`)).toEqual(['OCR 70 off', 'R-201 null grey', 'R-202 null grey', 'R-203 120 off', 'R-204 null grey'].map((x) => x.replace(/R-/, '')));
    expect(s1.dt.map((x) => x.value)).toEqual(['60', '5', null, null, null, '40']);
  });
});

describe('splitPoint', () => {
  it('puts the point first and each sentence of the detail on its own line', () => {
    expect(splitPoint('Trip: P-901 09:28 · P-901 A tripped at 9:28. Restarted and feed normal.')).toEqual({ head: 'Trip P-901 09:28', lines: ['P-901 A tripped at 9:28.', 'Restarted and feed normal.'] });
    expect(splitPoint('TR-2 Compressor bypass since 01/01 · expiry not set, MOC not set')).toEqual({ head: 'TR-2 Compressor bypass since 01/01', lines: ['expiry not set, MOC not set'] });
    expect(splitPoint('OCR inlet 664 °F')).toEqual({ head: 'OCR inlet 664 °F', lines: [] });
  });
});

describe('handover from the remarks and repeated samples', () => {
  it('judges a lab test once per point: the newest sample in the shift, earlier ones in the note', () => {
    const lab2 = [S('n1', 'NAPHTHA', 'T-104', 'H2S', '11', '2030-01-02T04:00:00+00:00'), S('n2', 'NAPHTHA', 'T-104', 'H2S', '1.5', '2030-01-02T08:00:00+00:00'), S('n3', 'NAPHTHA', 'T-104', 'H2S', '9', '2030-01-02T19:00:00+00:00')];
    const n = checksOf({ ...input, lab: lab2 }).filter((c) => c.paramId === 'N1');
    expect(n.map((c) => [c.value, c.state, c.note])).toEqual([['1.5', 'ok', 'T-104 11:00 · earlier 11 at 07:00']]);   // 22:00 sample is after the morning shift
  });
  it('adds remarks that need attention with who wrote them, and a remark naming an unknown override', () => {
    const lg: StoredLog = { ...log, sections: [
      { role: 'CONTROLLER', groups: [{ group: 'Train 2', items: ['Feed rate: 40 KBPD', 'LB 901 pumps need to replace. FSLL 947 override.', 'TV 977 bypass one turn open.'] }] },
      { role: 'CONTROL ROOM OPERATOR', groups: [{ group: 'Train 2', items: ['TV 977 bypass one turn open.'] }, { group: 'Low Pressure', items: ['P-908 B suction strainer to be cleaned.', 'Naphtha sample sent for H2S: 0.38 ppm.'] }] }] };
    const h = handover({ ...input, log: lg, controller: null, before: [] }, checksOf({ ...input, log: lg, controller: null }));
    const ov = h.find((l) => l.key === 'Override')!.items;
    expect(ov.map((x) => [!!x.overrideId, !!x.suggest])).toEqual([[true, false], [false, true]]);
    const t2 = h.find((l) => l.key === 'TR-2')!.items.filter((x) => x.remark);
    expect(t2.map((x) => [x.st, x.text, x.by, x.age])).toEqual([
      ['bad', 'LB 901 pumps need to replace. FSLL 947 override', 'Controller', 'NEW'],
      ['off', 'TV 977 bypass one turn open', 'Controller, Control room', 'NEW']]);
    expect(h.find((l) => l.key === 'Common')!.items.filter((x) => x.remark).map((x) => x.text)).toEqual(['P-908 B suction strainer to be cleaned']);
  });
});
