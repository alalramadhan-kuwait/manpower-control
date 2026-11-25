// Made-up pages only: names, numbers and tags here are invented to mirror the layouts, never taken from a real log.
import { describe, expect, it } from 'vitest';
import { labTime, num, parseControllerArds, parseHeader, parseLabReport, parseReadings, parseRemarks, parseShiftLog, readingKey, type Page, type Piece } from '../parse';

const pc = (x: number, y: number, s: string, w = s.length * 5): Piece => ({ p: 1, x, y, w, s });
const page = (pieces: Piece[], h = 595): Page => ({ h, pieces });

describe('parseHeader', () => {
  it('reads the unit log, the other section and the controller log', () => {
    expect(parseHeader('Logbook #101, ARDS, Area 9\nRecord Created Time: 02-01-2030 08:14:49 Date: 02-01-2030 Morning/C/2nd')).toEqual({
      kind: 'ards', logNo: 101, date: '2030-01-02', shift: 'Morning', crew: 'C', day: '2nd', createdAt: '2030-01-02T08:14:49+03:00' });
    expect(parseHeader('Logbook #7, HTU, x\nDate: 03-01-2030 Night/A/1st')?.kind).toBe('htu');
    expect(parseHeader('Controller I Log #55\nDate: 03-01-2030')?.kind).toBe('controller1');
    expect(parseHeader('Some other letter')).toBeNull();
  });
});

describe('parseRemarks', () => {
  it('splits sections, groups and items, joins a wrapped line, and stops at a table', () => {
    const s = parseRemarks([page([
      pc(44, 100, 'CONTROLLER Remarks'),
      pc(44, 120, 'OCR:'), pc(44, 135, '# Pump A started'), pc(44, 150, 'after the check.'),
      pc(44, 170, 'TR-1:'), pc(44, 185, '- Feed steady'), pc(44, 200, '- Valve B closed'),
      pc(44, 230, 'Products'), pc(44, 250, '# not a remark'),
    ])]);
    expect(s).toEqual([{ role: 'CONTROLLER', groups: [
      { group: 'OCR', items: ['Pump A started after the check.'] },
      { group: 'TR-1', items: ['Feed steady', 'Valve B closed'] },
    ] }]);
  });
  it('reads the other section’s plain headings and numbered items', () => {
    const s = parseRemarks([page([pc(59, 100, 'CONTROL ROOM OPERATOR'), pc(44, 120, 'Unit-9'), pc(44, 135, 'Feed rate 10.'), pc(44, 150, '1) Pump X running'), pc(44, 200, 'FEED & PRODUCTS - Unit-9')])]);
    expect(s).toEqual([{ role: 'CONTROL ROOM OPERATOR', groups: [{ group: 'Unit-9', items: ['Feed rate 10.', 'Pump X running'] }] }]);
  });
});

describe('parseControllerArds', () => {
  it('keeps only the unit’s own section', () => {
    const s = parseControllerArds([page([pc(44, 50, 'Section-1 U-12 ARDS'), pc(44, 70, '# ours'), pc(44, 90, 'Section-2 U-15 Other'), pc(44, 110, '# theirs')])]);
    expect(s).toEqual([{ role: 'CONTROLLER I', groups: [{ group: '', items: ['ours'] }] }]);
  });
});

describe('parseReadings', () => {
  // left block: names x 50, values 142 / 235 / 329; right block: names 429, values 522 / 615 / 708
  const L = (y: number, name: string | null, a?: string, b?: string, u?: string) => [name ? pc(50, y, name) : null, a ? pc(142, y, a) : null, b ? pc(235, y, b) : null, u ? pc(329, y, u) : null].filter(Boolean) as Piece[];
  const R = (y: number, name: string | null, a?: string, b?: string, u?: string) => [name ? pc(429, y, name) : null, a ? pc(522, y, a) : null, b ? pc(615, y, b) : null, u ? pc(708, y, u) : null].filter(Boolean) as Piece[];

  it('flows left, right, next page; joins wrapped names across a break; drops the clipped repeat; NAN is empty', () => {
    const p1 = page([
      pc(44, 40, '# last remark line'),
      ...R(60, 'RATE'), ...R(66, null, '1', '2', 'GPM'), ...R(73, '(Z-1)'),           // right block starts above the title
      pc(44, 70, 'Train1 & 2'),
      ...L(90, 'Parameters /Tag #', 'TR-1 Reading', 'TR-2 Reading', 'UOM'),
      ...L(110, 'FEED', '25', '24', 'KBPD'),
      ...L(560, 'BETA TEMP (X-'), ...L(572, '1/2)', '600', 'NAN', '°F'),
      ...L(590, 'ALPHA'),                                                                // cut: the rest is atop the right block
      ...R(100, 'DELTA', '-', '-', 'BPD'),
      ...R(580, 'EPS', '3', '4', 'PSIG'),
    ]);
    const p2 = page([
      ...L(3, 'GA', '.', '. 5'),                                                         // clipped repeat of the cut row
      ...L(20, 'ZETA', 'no activity', 'no activity', 'Status'),
      pc(44, 60, 'Lab Test Results'),
      ...L(80, 'NOT A READING', '9', '9', 'X'),
    ]);
    const { readings, unplaced } = parseReadings([p1, p2]);
    expect(unplaced).toBe(0);
    expect(readings.map((r) => [r.label, r.tr1, r.tr2, r.unit])).toEqual([
      ['FEED', '25', '24', 'KBPD'],
      ['BETA TEMP (X-1/2)', '600', null, '°F'],
      ['ALPHA RATE (Z-1)', '1', '2', 'GPM'],
      ['DELTA', null, null, 'BPD'],
      ['EPS', '3', '4', 'PSIG'],
      ['ZETA', 'no activity', 'no activity', 'Status'],
    ]);
  });

  it('gives the same key whatever the spacing or a lost dash', () => {
    expect(readingKey('PASS 2 SKIN TEMP (H 12-1 /2)')).toBe(readingKey('PASS-2 SKIN TEMP (H-12-1/2)'));
  });
});

describe('parseShiftLog', () => {
  it('returns null for a page that is not a log', () => {
    expect(parseShiftLog([page([pc(44, 10, 'Hello')])])).toBeNull();
  });
});

describe('lab report', () => {
  const block = (y: number, ids: string[], rows: [string, string | null, string[]][]) => [
    pc(42, y, 'SAMPLEID'), ...ids.map((id, i) => pc(120 + i * 58, y, id, 40)),
    pc(44, y + 19, 'UNIT NO.'), ...ids.map((_, i) => pc(137 + i * 58, y + 19, '012', 10)),
    ...rows.flatMap(([name, unit, vals], r) => [pc(44, y + 40 + r * 14, name), ...(unit ? [pc(85, y + 40 + r * 14, unit, 10)] : []),
      ...vals.map((v, i) => pc(137 + i * 58, y + 40 + r * 14, v, 10))]),
  ];
  it('takes the year from the report for a cut date', () => {
    expect(labTime('2 Jan 203 06:05', 2030)).toBe('2030-01-02T06:05:00+03:00');
    expect(labTime('', 2030)).toBeNull();
  });
  it('reads one column per sample and merges a sample repeated on the next page', () => {
    const head = pc(261, 40, 'From : 2 Jan 2030');
    const pages = [
      page([head, ...block(93, ['S-1', 'S-2'], [['MATERIAL', null, ['OIL', 'WATER']], ['COLLECTION DATE', null, ['2 Jan 203 07:00', '2 Jan 203 09:00']], ['Density', 'kg', ['0.8', '1.0']]])], 842),
      page([head, ...block(93, ['S-1', 'S-2'], [['pH', null, ['7.1', '8.2']]])], 842),
    ];
    const s = parseLabReport(pages);
    expect(s.map((x) => [x.sampleId, x.material, x.collectedAt, x.results.map((r) => `${r.component}=${r.value}${r.unit ? ` ${r.unit}` : ''}`)])).toEqual([
      ['S-1', 'OIL', '2030-01-02T07:00:00+03:00', ['Density=0.8 kg', 'pH=7.1']],
      ['S-2', 'WATER', '2030-01-02T09:00:00+03:00', ['Density=1.0 kg', 'pH=8.2']],
    ]);
  });
  it('num reads plain numbers only', () => {
    expect([num('1.150'), num('-0.3'), num('+30'), num('no activity'), num(null)]).toEqual([1.15, -0.3, 30, null, null]);
  });
});
