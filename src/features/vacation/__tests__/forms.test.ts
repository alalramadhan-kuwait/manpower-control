import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { cyclesOf } from '@/core/pv';
import type { Crew } from '@/core/roster';
import { A3, cellBoxes, decodeId, encodeId, evaluateAllocation, initialAllocation, yearForms, type PlanPerson } from '@/core/vacation';
import { finalPdf, formPdf, mergePdfs } from '../pdf';

let seq = 0;
const person = (crew: Crew | null, position: PlanPerson['position'], o: Partial<PlanPerson> = {}): PlanPerson => {
  seq++;
  return { id: `p${seq}`, name: `Person Number ${seq} Long Family Name`, number: String(20000 + seq), grade: position === 'controller' || position === 'vr_controller' ? 16 : position === 'panel_operator' ? 14 : 12,
    position, employmentType: 'knpc', takeCharge: position === 'field_operator' ? 'yes' : null, panelQualified: position === 'panel_operator' ? 'yes' : null,
    actingController: null, dirCrew: crew, crew, dayDuty: false, placement: null, sick: null, ...o };
};
const shift = (c: Crew, field: number) => [person(c, 'controller'), ...[14, 14, 13, 13].map((g) => person(c, 'panel_operator', { grade: g })), ...Array.from({ length: field }, () => person(c, 'field_operator'))];
const people = [...shift('A', 9), ...shift('B', 9), ...shift('C', 11), ...shift('D', 12), person(null, 'vr_controller', { placement: 'A' }), person(null, 'vr_controller', { placement: 'C' })];
const ev = evaluateAllocation(people, initialAllocation(people));
const forms = yearForms({ year: 2027, version: 1, approvedOn: '27 Oct 2026', people, ev });

describe('A3 vacation forms', () => {
  it('six forms: Controllers (6 people), Panel (16), Field A–D; everyone once per half-year', () => {
    expect(forms.map((f) => f.file)).toEqual(['PV27-C-v1.pdf', 'PV27-P-v1.pdf', 'PV27-FA-v1.pdf', 'PV27-FB-v1.pdf', 'PV27-FC-v1.pdf', 'PV27-FD-v1.pdf']);
    const ids = (i: number, half: 1 | 2) => forms[i].pages.filter((p) => p.half === half).flatMap((p) => p.sections.flatMap((s) => s.rows.map((r) => r.employeeId)));
    expect(new Set(ids(0, 1)).size).toBe(6); expect(ids(0, 1)).toHaveLength(6); expect(ids(0, 2)).toHaveLength(6);
    expect(ids(1, 1)).toHaveLength(16); expect(new Set(ids(1, 2)).size).toBe(16);
    expect(ids(5, 1)).toHaveLength(12);
  });
  it('every cycle of the year once per person, on the rota dates (not reset on 1 January)', () => {
    const boxes = cellBoxes(forms[2]);
    const f = people.find((p) => p.crew === 'A' && p.position === 'field_operator')!;
    const mine = boxes.filter((b) => b.employeeId === f.id).map((b) => b.cycle);
    expect(mine).toEqual(cyclesOf('A', 2027).map((c) => c.index));
    expect(cyclesOf('A', 2027)[0].start).toBe('2027-01-04');
  });
  it('boxes are large enough to mark by hand (≥ 10 mm wide, ≥ 6 mm high) and stay inside the page', () => {
    const mm = (pt: number) => (pt * 25.4) / 72;
    for (const f of forms) for (const b of cellBoxes(f)) {
      expect(mm(b.w)).toBeGreaterThanOrEqual(10); expect(mm(b.h)).toBeGreaterThanOrEqual(6);
      expect(b.x + b.w).toBeLessThan(A3.w - 28); expect(b.y + b.h).toBeLessThan(A3.h - 28);
    }
  });
  it('the identity strip round-trips and refuses a damaged read', () => {
    const bits = encodeId({ year: 2027, kind: 'field', crew: 'C', page: 2, version: 3 });
    expect(decodeId(bits)).toEqual({ year: 2027, kind: 'field', crew: 'C', page: 2, version: 3 });
    const bad = [...bits]; bad[3] ^= 1;
    expect(decodeId(bad)).toBeNull();
  });
  it('the PDFs are true A3 landscape (420 × 297 mm), every page', async () => {
    const all = await mergePdfs(await Promise.all(forms.map(formPdf)));
    const doc = await PDFDocument.load(all);
    expect(doc.getPageCount()).toBe(forms.reduce((n, f) => n + f.pages.length, 0));
    for (const p of doc.getPages()) { const { width, height } = p.getSize(); expect(Math.round((width * 25.4) / 72)).toBe(420); expect(Math.round((height * 25.4) / 72)).toBe(297); }
    const fin = await PDFDocument.load(await finalPdf({ title: 'Vacation Plan 2027 · Field A', year: 2027, version: 'Plan v1', approved: '1 Dec 2026',
      groups: [{ title: 'A Shift · Field', crew: 'A', people: [{ employeeId: 'x', name: 'Someone', number: '20001', detail: 'G12', crew: 'A', periods: [{ start: '2027-01-04', end: '2027-01-11', system: false, changed: false }] }] }] }));
    expect(Math.round((fin.getPage(0).getSize().width * 25.4) / 72)).toBe(420);
  });
});
