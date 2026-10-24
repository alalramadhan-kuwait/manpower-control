import { describe, expect, it } from 'vitest';
import { drawingProblem, loopDrawings, type TrkDrawing } from '../drawings';

const d = (id: string, v: Partial<TrkDrawing>): TrkDrawing => ({ id, trackerId: 't', pointId: null, items: [], sheet: '1-R-12-0-206', rev: '1', source: 'Approved P&ID', title: null,
  path: `t/${id}.png`, mime: 'image/png', note: null, status: 'current', uploadedBy: null, uploadedAt: '2026-10-24T10:00:00Z', closedAt: null, closedBy: null, closedReason: null, ...v });

describe('loop diagrams', () => {
  const loop = { id: 'L1', items: ['H-12-201'] };
  it('no drawing attached: nothing to show (the screen says "Drawing not available")', () => {
    expect(loopDrawings([], loop)).toEqual({ current: [], equipment: [], history: [] });
  });
  it('the loop\'s own current drawing, its earlier revisions kept apart, newest first', () => {
    const r = loopDrawings([d('a', { pointId: 'L1', rev: '2', status: 'superseded', uploadedAt: '2026-10-23T10:00:00Z' }), d('b', { pointId: 'L1', rev: '3' }),
      d('w', { pointId: 'L1', status: 'withdrawn', uploadedAt: '2026-10-24T09:00:00Z' }), d('x', { pointId: 'L2' })], loop);
    expect(r.current.map((x) => x.id)).toEqual(['b']);
    expect(r.history.map((x) => x.id)).toEqual(['w', 'a']);
  });
  it('equipment drawings (no loop) of the loop\'s items are offered separately, short tags match', () => {
    const r = loopDrawings([d('e', { items: ['H-201'] }), d('o', { items: ['V-12-212'] }), d('s', { items: ['H-12-201'], status: 'superseded' })], loop);
    expect(r.equipment.map((x) => x.id)).toEqual(['e']);
    expect(r.current).toEqual([]);
  });
  it('an upload needs a sheet, a revision, an approved source and a PNG/JPG/PDF up to 15 MB', () => {
    const ok = { sheet: '1-R-12-0-206', rev: '3', source: 'Approved P&ID', type: 'application/pdf', sizeBytes: 1e6 };
    expect(drawingProblem(ok)).toBeNull();
    expect(drawingProblem({ ...ok, rev: ' ' })).toMatch(/revision/);
    expect(drawingProblem({ ...ok, source: '' })).toMatch(/source/);
    expect(drawingProblem({ ...ok, type: 'image/gif' })).toMatch(/PNG/);
    expect(drawingProblem({ ...ok, sizeBytes: 16 * 1024 * 1024 })).toMatch(/15 MB/);
  });
});
