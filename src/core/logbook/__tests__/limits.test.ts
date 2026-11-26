// Made-up limits only.
import { describe, expect, it } from 'vitest';
import { iowBand, limitBand, limitForLab, limitForReading, limitState, plainNumber, worse, type Limit, type LimitMatch } from '../limits';

const L = (o: Partial<Limit>): Limit => ({ paramId: 'X', section: 'A', description: 'x', unit: 'u', target: null, normalLo: null, normalHi: null,
  iowStd: null, iowCrit: null, trip: null, roc: null, source: null, action: null, status: 'active', ...o });

describe('reading a limit', () => {
  it('reads numbers and IOW bands', () => {
    expect([plainNumber('1,500'), plainNumber('no activity'), plainNumber(null)]).toEqual([1500, null, null]);
    expect(iowBand('8–9')).toEqual({ lo: 8, hi: 9 });
    expect(iowBand('25')).toEqual({ lo: null, hi: 25 });
    expect(iowBand('see note')).toBeNull();
  });
});

describe('limitState (spec §4.1)', () => {
  const band = L({ normalLo: 10, normalHi: 20, iowStd: '25', iowCrit: '40' });
  it('normal, off, breach, critical', () => {
    expect(limitState('15', band)).toBe('normal');
    expect(limitState('21', band)).toBe('off');
    expect(limitState('5', band)).toBe('off');
    expect(limitState('26', band)).toBe('breach');
    expect(limitState('41', band)).toBe('critical');
  });
  it('an IOW band that equals the normal band makes leaving it a breach', () => {
    expect(limitState('31.5', L({ normalLo: 22, normalHi: 31, iowStd: '22–31' }))).toBe('breach');
  });
  it('IOW only: below it is normal', () => {
    expect(limitState('700', L({ iowStd: '750', iowCrit: '900' }))).toBe('normal');
  });
  it('no colour without a number or a numeric limit; retired limits ignored; scale applied', () => {
    expect(limitState('no activity', band)).toBeNull();
    expect(limitState('5', L({ target: '100' }))).toBeNull();
    expect(limitState('30', L({ ...band, status: 'retired' }))).toBeNull();
    expect(limitState('8.5', L({ normalHi: 9100 }), 1000)).toBe('normal');
    expect(limitState('9.2', L({ normalHi: 9100 }), 1000)).toBe('off');
  });
  it('shows the band', () => {
    expect(limitBand(L({ normalHi: 77 }))).toBe('≤ 77');
    expect(limitBand(L({ normalLo: 22, normalHi: 31, iowStd: '22–31' }))).toBe('22–31');
    expect(limitBand(L({ iowStd: '750' }))).toBe('IOW 750');
    expect(limitBand(L({ target: '55' }))).toBe('target 55');
    expect(worse('off', 'breach')).toBe('breach');
    expect(worse(null, 'normal')).toBe('normal');
  });
});

describe('matching', () => {
  const limits = new Map([['A', L({ paramId: 'A', normalHi: 1 })], ['B', L({ paramId: 'B', normalHi: 2 })]]);
  const matches: LimitMatch[] = [{ paramId: 'A', kind: 'reading', key: '/^PASS\\dSKIN/' }, { paramId: 'B', kind: 'reading', key: 'SPEED', scale: 1000 },
    { paramId: 'A', kind: 'lab', material: 'Water', component: 'pH' }];
  it('finds the limit for a reading or a lab result', () => {
    expect(limitForReading('PASS3SKINTEMP', matches, limits)?.limit.paramId).toBe('A');
    expect(limitForReading('SPEED', matches, limits)?.scale).toBe(1000);
    expect(limitForReading('OTHER', matches, limits)).toBeNull();
    expect(limitForLab('WATER', 'V-1', 'PH', matches, limits)?.paramId).toBe('A');
    expect(limitForLab('OIL', 'V-1', 'pH', matches, limits)).toBeNull();
  });
});
