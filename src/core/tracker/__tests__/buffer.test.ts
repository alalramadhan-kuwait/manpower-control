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
