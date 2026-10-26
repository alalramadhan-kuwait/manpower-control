import { describe, expect, it } from 'vitest';
import type { Crew } from '../../roster';
import { A3, MARK, bitBoxes, cellBoxes, evaluateAllocation, homography, apply, initialAllocation, marks, readPage, yearForms, type Gray, type PlanPerson } from '..';

let seq = 0;
const person = (crew: Crew | null, position: PlanPerson['position']): PlanPerson => ({ id: `p${++seq}`, name: `Name ${seq}`, number: String(20000 + seq),
  grade: position === 'panel_operator' ? 14 : position === 'field_operator' ? 12 : 16, position, employmentType: 'knpc', takeCharge: position === 'field_operator' ? 'yes' : null,
  panelQualified: position === 'panel_operator' ? 'yes' : null, actingController: null, dirCrew: crew, crew, dayDuty: false, placement: crew ? null : 'B', sick: null });
const shift = (c: Crew) => [person(c, 'controller'), ...[1, 2, 3, 4].map(() => person(c, 'panel_operator')), ...Array.from({ length: 9 }, () => person(c, 'field_operator'))];
const people = [...shift('A'), ...shift('B'), ...shift('C'), ...shift('D'), person(null, 'vr_controller')];
const forms = yearForms({ year: 2027, version: 2, approvedOn: null, people, ev: evaluateAllocation(people, initialAllocation(people)) });

type Shape = { kind: 'fill'; x: number; y: number; w: number; h: number } | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; t: number };
/** Paints the shapes (page points) into a picture seen through a perspective (as a phone photo would). */
function render(shapes: Shape[], quad: { x: number; y: number }[], w: number, h: number): Gray {
  const pageCorners = [{ x: 0, y: 0 }, { x: A3.w, y: 0 }, { x: 0, y: A3.h }, { x: A3.w, y: A3.h }];
  const fwd = homography(pageCorners, quad), inv = homography(quad, pageCorners);
  const data = new Uint8Array(w * h).fill(90);   // the table under the page
  const paint = (x0: number, y0: number, x1: number, y1: number, hit: (px: number, py: number) => boolean, v: number) => {
    const cs = [apply(fwd, x0, y0), apply(fwd, x1, y0), apply(fwd, x0, y1), apply(fwd, x1, y1)];
    const ax = Math.max(0, Math.floor(Math.min(...cs.map((c) => c.x))) - 1), bx = Math.min(w - 1, Math.ceil(Math.max(...cs.map((c) => c.x))) + 1);
    const ay = Math.max(0, Math.floor(Math.min(...cs.map((c) => c.y))) - 1), by = Math.min(h - 1, Math.ceil(Math.max(...cs.map((c) => c.y))) + 1);
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) { const p = apply(inv, x, y); if (hit(p.x, p.y)) data[y * w + x] = v; }
  };
  paint(0, 0, A3.w, A3.h, (px, py) => px >= 0 && py >= 0 && px <= A3.w && py <= A3.h, 235);
  for (const s of shapes) {
    if (s.kind === 'fill') paint(s.x, s.y, s.x + s.w, s.y + s.h, (px, py) => px >= s.x && px <= s.x + s.w && py >= s.y && py <= s.y + s.h, 25);
    else {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L2 = dx * dx + dy * dy, r = s.t / 2;
      paint(Math.min(s.x1, s.x2) - r, Math.min(s.y1, s.y2) - r, Math.max(s.x1, s.x2) + r, Math.max(s.y1, s.y2) + r, (px, py) => {
        const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / L2));
        return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy)) <= r; }, 25);
    }
  }
  return { w, h, data };
}
const border = (b: { x: number; y: number; w: number; h: number }): Shape[] => [
  { kind: 'line', x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y, t: 0.8 }, { kind: 'line', x1: b.x, y1: b.y + b.h, x2: b.x + b.w, y2: b.y + b.h, t: 0.8 },
  { kind: 'line', x1: b.x, y1: b.y, x2: b.x, y2: b.y + b.h, t: 0.8 }, { kind: 'line', x1: b.x + b.w, y1: b.y, x2: b.x + b.w, y2: b.y + b.h, t: 0.8 }];
const cross = (b: { x: number; y: number; w: number; h: number }): Shape[] => [
  { kind: 'line', x1: b.x + 3, y1: b.y + 2, x2: b.x + b.w - 3, y2: b.y + b.h - 2, t: 2.2 }, { kind: 'line', x1: b.x + b.w - 3, y1: b.y + 2, x2: b.x + 3, y2: b.y + b.h - 2, t: 2.2 }];

describe('reading a returned form', () => {
  const doc = forms.find((f) => f.kind === 'field' && f.crew === 'C')!;
  const page = doc.pages[0];
  const boxes = cellBoxes(doc).filter((b) => b.page === 1);
  const chosen = [boxes[0], boxes[30], boxes[77]];
  const faint = boxes[100];
  const shapes: Shape[] = [
    ...marks().map((m) => ({ kind: 'fill' as const, x: m.x, y: m.y, w: MARK, h: MARK })),
    ...bitBoxes().flatMap((b, i) => (page.bits[i] ? [{ kind: 'fill' as const, ...b }] : [])),
    ...boxes.flatMap(border), ...chosen.flatMap(cross),
    { kind: 'fill', x: faint.x + faint.w / 2 - 1.6, y: faint.y + faint.h / 2 - 1.6, w: 3.2, h: 3.2 }];
  it('a skewed photo: finds the form and page, the crosses, the empty boxes, and leaves a faint dot unclear', () => {
    const g = render(shapes, [{ x: 60, y: 40 }, { x: 1330, y: 70 }, { x: 40, y: 935 }, { x: 1350, y: 960 }], 1400, 1000);
    const r = readPage(g, forms);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.doc.kind, r.doc.crew, r.page]).toEqual(['field', 'C', 1]);
    const marked = r.cells.filter((c) => c.state === 'marked').map((c) => `${c.employeeId}|${c.cycle}`);
    expect(marked.sort()).toEqual(chosen.map((b) => `${b.employeeId}|${b.cycle}`).sort());
    expect(r.cells.find((c) => c.employeeId === faint.employeeId && c.cycle === faint.cycle)?.state).toBe('unclear');
    expect(r.cells.filter((c) => c.state === 'empty').length).toBe(boxes.length - 4);
  });
  it('a page printed from an older manpower version is refused', () => {
    const old = yearForms({ year: 2027, version: 1, approvedOn: null, people, ev: evaluateAllocation(people, initialAllocation(people)) });
    const g = render(shapes, [{ x: 20, y: 20 }, { x: 1380, y: 20 }, { x: 20, y: 980 }, { x: 1380, y: 980 }], 1400, 1000);
    const r = readPage(g, old);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/version 2/);
  });
  it('no corner squares (cut off): refused with a clear reason, nothing guessed', () => {
    const g = render(shapes.slice(4), [{ x: 20, y: 20 }, { x: 1380, y: 20 }, { x: 20, y: 980 }, { x: 1380, y: 980 }], 1400, 1000);
    const r = readPage(g, forms);
    expect(r.ok).toBe(false);
  });
});
