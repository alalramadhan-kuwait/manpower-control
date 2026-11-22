import { describe, expect, it } from 'vitest';
import { shiftAfterHold } from '../stages';

const T = (s: string) => `2026-11-${s}:00+03:00`;
const ms = (s: string) => Date.parse(T(s));
const done = (id: string, a: string, b: string) => ({ id, startedAt: new Date(ms(a)).toISOString(), doneAt: new Date(ms(b)).toISOString(), status: 'done' as const });
const NOW = ms('22T21:10');

describe('a hold moves the steps after it (Train-2, 22 Nov 2026)', () => {
  const after = [done('flush', '17T18:02', '17T20:02'), done('prewet', '17T20:02', '18T04:02'), done('sulf1', '18T04:02', '19T04:02'),
    { id: 'sulf2', startedAt: null, doneAt: null, status: 'not_started' as const }];
  it('the steps inside the hold E-216 leaked (17 Nov 18:02 → 19 Nov 18:02) move 48 h, keeping their lengths', () => {
    const r = shiftAfterHold(after, ms('19T18:02'), NOW);
    if (r === 'future') throw new Error('future');
    expect(r.by / 3_600_000).toBe(48);
    expect(r.moves.map((m) => m.id)).toEqual(['flush', 'prewet', 'sulf1']);
    expect(r.moves[0].startedAt).toBe(new Date(ms('19T18:02')).toISOString());
    expect(r.moves[2].doneAt).toBe(new Date(ms('21T04:02')).toISOString());
  });
  it('never earlier, and nothing to move when the next step already starts after the hold', () => {
    expect(shiftAfterHold(after, ms('17T12:00'), NOW)).toEqual({ by: 0, moves: [] });
    expect(shiftAfterHold([{ id: 'x', startedAt: null, doneAt: null, status: 'not_started' }], ms('19T18:02'), NOW)).toEqual({ by: 0, moves: [] });
  });
  it('refused when a moved time would be after now', () => {
    expect(shiftAfterHold(after, ms('22T18:00'), NOW)).toBe('future');
  });
});
