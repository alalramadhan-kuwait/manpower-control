import { describe, expect, it } from 'vitest';
import { bufferCatchUp, isBufferStep } from '..';
import { data } from '../intel/__tests__/fixture';

describe('buffer steps', () => {
  it('conditional work and scaffolding are buffers; a real step with a scaffolding note is not', () => {
    for (const t of ['Repair (if required)', 'Painting (If required)', 'Possible welding of the bolts to fix the bubble cap trays', 'Remove scaffolding', 'Erect Internal Scaffold',
      'Re-install insulation if Required', 'Steaming/diesel flushing as required', 'Shell internal grit blasting if needed', 'Repair of Johnson screen (If required)']) expect(isBufferStep(t)).toBe(true);
    for (const t of ['Shell pull out(scaffolding modification as required', 'Shell push back(scaffolding modification as required)', 'Load catalyst', 'Deblind', 'Cleaning all internal by Hydrojetting', 'Process Inspection'])
      expect(isBufferStep(t)).toBe(false);
  });
  it('skipping the open buffer steps never moves the forecast later', () => {
    const d = data(); const now = Date.parse('2026-10-26T16:00:00Z');
    const keys = [...new Set(d.activities.map((a) => a.key))];
    const found = keys.map((k) => bufferCatchUp(d, now, k)).filter((x) => x && x.forecast != null && x.forecastIfSkipped != null);
    for (const b of found) expect(b!.forecastIfSkipped!).toBeLessThanOrEqual(b!.forecast!);
    expect(found.every((b) => b!.steps.every((a) => !a.actualStart && isBufferStep(a.activity)))).toBe(true);
  });
});

import { runTogether } from '..';
describe('steps that run together', () => {
  const st = (id: string, s: string | null, f: string | null) => ({ id, start: s, finish: f } as unknown as Parameters<typeof runTogether>[0][number]);
  it('groups overlapping plan windows in order; touching windows and unplanned steps do not break or join', () => {
    const g = runTogether([st('insp', '2026-10-27T00:00Z', '2026-10-27T12:00Z'), st('weld', '2026-10-27T12:00Z', '2026-10-29T00:00Z'), st('rtj', '2026-10-27T12:00Z', '2026-10-29T00:00Z'),
      st('ring', null, null), st('tw', '2026-10-27T12:00Z', '2026-10-29T00:00Z'), st('scaff', '2026-10-29T00:00Z', '2026-10-29T06:00Z'),
      st('box', '2026-10-31T00:00Z', '2026-10-31T12:00Z'), st('ins', '2026-10-31T00:00Z', '2026-11-02T00:00Z'), st('deb', '2026-10-31T12:00Z', '2026-11-01T00:00Z')]);
    expect(['weld', 'rtj', 'tw'].map((k) => g.get(k)?.letter)).toEqual(['a', 'b', 'c']);
    expect(g.get('weld')!.id).toBe(g.get('tw')!.id);
    expect(g.has('insp') || g.has('scaff') || g.has('ring')).toBe(false);
    expect(['box', 'ins', 'deb'].map((k) => g.get(k)?.letter)).toEqual(['a', 'b', 'c']);
    expect(g.get('box')!.id).not.toBe(g.get('weld')!.id);
  });
});
