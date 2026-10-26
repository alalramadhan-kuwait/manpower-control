// A3 landscape vacation forms and final plan: the page geometry in points (1 pt = 1/72 in; A3 = 420 × 297 mm =
// 1190.55 × 841.89 pt), measured from the top-left corner. The PDF writer draws it and the form reader (omr.ts) finds
// the same boxes on a scan, so both use this one layout. Four solid corner marks and a printed bit strip identify the
// page (year, form, shift, page, manpower version) for reading a returned form. Pure.
import { cyclesOf, type PvCycle } from '../pv';
import { CREWS, type Crew } from '../roster';
import { RELIEF_LABEL, cycleCrewOf, isControllerGroup, type AllocEval, type AllocRow, type PlanPerson } from './allocation';

export const A3 = { w: 1190.55, h: 841.89 } as const;
export const MARGIN = 28;
export const MARK = 18;
export const BIT = { size: 11, gap: 4, count: 24 } as const;

export type FormKind = 'controllers' | 'panel' | 'field';
export const FORM_LABEL: Record<FormKind, string> = { controllers: 'Controllers / Supervisors', panel: 'Panel Operators', field: 'Field Operators' };

export interface FormRow { employeeId: string; no: number; name: string; number: string; detail: string; y: number; h: number; note: string | null }
export interface FormCol { cycle: PvCycle; x: number; w: number }
export interface FormSection { title: string; crew: Crew; y: number; headerH: number; cols: FormCol[]; slots: string; rows: FormRow[]; restricted: Map<string, Map<number, string>> }
export interface FormPage { code: string; title: string; sub: string; page: number; pages: number; half: 1 | 2; bits: number[]; sections: FormSection[] }
export interface FormDoc { kind: FormKind; crew: Crew | null; year: number; version: number; title: string; file: string; pages: FormPage[] }
/** A marking box (one person, one cycle) on a page, in points from the top-left. */
export interface CellBox { page: number; employeeId: string; cycle: number; x: number; y: number; w: number; h: number }

export const COLS = { no: 22, name: 158, number: 50, detail: 58, initial: 44 } as const;
const HEAD = 66;          // title, sub-title, instructions
const FOOT = 64;          // supervisor review + bit strip
const COL_HEAD = 30;      // cycle number + dates
const SLOT_ROW = 12;
const SECTION_TITLE = 15;
export const ROW_H = 24;

/** Corner marks (top-left corners of the solid squares). */
export const marks = () => [
  { x: MARGIN, y: MARGIN }, { x: A3.w - MARGIN - MARK, y: MARGIN },
  { x: MARGIN, y: A3.h - MARGIN - MARK }, { x: A3.w - MARGIN - MARK, y: A3.h - MARGIN - MARK }];
/** Bit cells of the identity strip (bottom, centred between the lower marks). */
export function bitBoxes(): { x: number; y: number; w: number; h: number }[] {
  const total = BIT.count * BIT.size + (BIT.count - 1) * BIT.gap;
  const x0 = (A3.w - total) / 2, y = A3.h - MARGIN - MARK + (MARK - BIT.size) / 2;
  return Array.from({ length: BIT.count }, (_, i) => ({ x: x0 + i * (BIT.size + BIT.gap), y, w: BIT.size, h: BIT.size }));
}

const KIND_CODE: Record<FormKind, number> = { controllers: 0, panel: 1, field: 2 };
/** 20 data bits (year − 2000: 7, form: 2, shift: 3, page: 3, manpower version: 5) and a 4-bit check. */
export function encodeId(v: { year: number; kind: FormKind; crew: Crew | null; page: number; version: number }): number[] {
  const fields: [number, number][] = [[v.year - 2000, 7], [KIND_CODE[v.kind], 2], [v.crew ? CREWS.indexOf(v.crew) + 1 : 0, 3], [v.page, 3], [v.version % 32, 5]];
  const bits: number[] = [];
  for (const [val, n] of fields) for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1);
  const check = [0, 1, 2, 3, 4].reduce((s, k) => s + parseInt(bits.slice(k * 4, k * 4 + 4).join(''), 2), 0) % 16;
  for (let i = 3; i >= 0; i--) bits.push((check >> i) & 1);
  return bits;
}
export function decodeId(bits: number[]): { year: number; kind: FormKind; crew: Crew | null; page: number; version: number } | null {
  if (bits.length !== BIT.count) return null;
  const check = [0, 1, 2, 3, 4].reduce((s, k) => s + parseInt(bits.slice(k * 4, k * 4 + 4).join(''), 2), 0) % 16;
  if (check !== parseInt(bits.slice(20).join(''), 2)) return null;
  let i = 0; const take = (n: number) => { const v = parseInt(bits.slice(i, i + n).join(''), 2); i += n; return v; };
  const year = 2000 + take(7), kind = (['controllers', 'panel', 'field'] as FormKind[])[take(2)], c = take(3), page = take(3), version = take(5);
  if (!kind || c > 4) return null;
  return { year, kind, crew: c ? CREWS[c - 1] : null, page, version };
}
export const formCode = (year: number, kind: FormKind, crew: Crew | null, version: number) => `PV${String(year).slice(2)}-${kind === 'controllers' ? 'C' : kind === 'panel' ? 'P' : `F${crew}`}-v${version}`;

interface Who { person: PlanPerson; row: AllocRow; detail: string; note: string | null }
const gradeRole = (p: PlanPerson, label: string) => `G${p.grade ?? '—'} ${label}`;

/** The people of a form, grouped in sections by the rota whose cycles they follow. */
function formGroups(kind: FormKind, crew: Crew | null, people: PlanPerson[], ev: AllocEval): { crew: Crew; title: string; slots: string; who: Who[] }[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const placed = [...ev.placed.values()];
  const num = (a: Who, b: Who) => a.person.name.localeCompare(b.person.name);
  if (kind === 'controllers') {
    return CREWS.map((c) => ({
      crew: c, title: `${c} Shift rota`, slots: '1 unit',
      who: placed.filter(({ row }) => isControllerGroup(row) && cycleCrewOf(row) === c).map(({ row }) => ({ person: byId.get(row.employeeId)!, row,
        detail: gradeRole(byId.get(row.employeeId)!, row.group === 'relief' ? (row.relief === 'vr' ? 'VR' : 'Day Sup.') : 'Ctl'), note: row.group === 'relief' ? RELIEF_LABEL[row.relief!] : null })).sort(num)
    })).filter((g) => g.who.length);
  }
  if (kind === 'panel') {
    const out = CREWS.map((c) => {
      const a = ev.crews[c];
      const acting = new Set(a.acting.map((p) => p.id));
      return { crew: c, title: `${c} Shift · Panel group ${a.panelGroup}`, slots: String(a.panelSlots),
        who: [...a.panel, ...a.acting].map((p) => ({ person: p, row: ev.placed.get(p.id)!.row, detail: gradeRole(p, acting.has(p.id) ? 'Acting' : p.employmentType === 'contractor' ? 'Ctr' : 'Panel'), note: acting.has(p.id) ? 'Acting Panel' : null })) };
    });
    const floats = placed.filter(({ row }) => row.group === 'relief' && row.relief === 'float_panel' && row.cycleCrew);
    for (const c of CREWS) { const f = floats.filter(({ row }) => row.cycleCrew === c); if (f.length) out.push({ crew: c, title: `Floating Panel relief · ${c} rota`, slots: 'cover', who: f.map(({ row }) => ({ person: byId.get(row.employeeId)!, row, detail: gradeRole(byId.get(row.employeeId)!, 'Float'), note: 'Floating relief' })) }); }
    return out.filter((g) => g.who.length);
  }
  const c = crew!;
  const a = ev.crews[c];
  const dd = placed.filter(({ row }) => row.group === 'relief' && row.relief === 'day_duty' && row.cycleCrew === c && byId.get(row.employeeId)?.position === 'field_operator');
  return [{ crew: c, title: `${c} Shift · Field ${a.fieldEligible.length}`, slots: String(a.fieldSlots),
    who: [...a.field.map((p) => ({ person: p, row: ev.placed.get(p.id)!.row, detail: gradeRole(p, p.employmentType === 'contractor' ? 'Ctr' : 'Field'), note: p.takeCharge === 'yes' ? null : 'Not counted (Take-Charge)' })),
      ...dd.map(({ row }) => ({ person: byId.get(row.employeeId)!, row, detail: gradeRole(byId.get(row.employeeId)!, 'Day'), note: 'Day duty' }))] }];
}

/**
 * The form's pages: Jan–Jun then Jul–Dec (a cycle belongs to the half it starts in), sections stacked until the page
 * is full, then a new page with the same columns. `restricted`: cells that cannot be chosen (shutdown team, other
 * leave), with a short mark printed in the box.
 */
export function buildForm(opts: { kind: FormKind; crew: Crew | null; year: number; version: number; approvedOn: string | null; people: PlanPerson[]; ev: AllocEval;
  restricted?: (employeeId: string, cycle: PvCycle) => string | null }): FormDoc {
  const { kind, crew, year, version } = opts;
  const groups = formGroups(kind, crew, opts.people, opts.ev);
  const code = formCode(year, kind, crew, version);
  const title = `Vacation Plan ${year} · ${FORM_LABEL[kind]}${crew ? ` · ${crew} Shift` : ''}`;
  const xCells = MARGIN + COLS.no + COLS.name + COLS.number + COLS.detail;
  const cellsW = A3.w - 2 * MARGIN - COLS.no - COLS.name - COLS.number - COLS.detail - COLS.initial;
  const top = MARGIN + HEAD, bottom = A3.h - MARGIN - FOOT;
  const pages: FormPage[] = [];
  let no = 0; const numbers = new Map<string, number>();
  for (const g of groups) for (const w of g.who) if (!numbers.has(w.person.id)) numbers.set(w.person.id, ++no);
  for (const half of [1, 2] as const) {
    let page: FormPage | null = null; let y = top;
    const newPage = () => { page = { code, title, sub: '', page: pages.length + 1, pages: 0, half, bits: [], sections: [] }; pages.push(page); y = top; };
    newPage();
    for (const g of groups) {
      const cycles = cyclesOf(g.crew, year).filter((c) => (Number(c.start.slice(5, 7)) <= 6) === (half === 1));
      const cw = cellsW / Math.max(cycles.length, 23);
      const need = SECTION_TITLE + COL_HEAD + SLOT_ROW + g.who.length * ROW_H + 6;
      if (y + need > bottom && page!.sections.length) newPage();
      const sec: FormSection = { title: g.title, crew: g.crew, y, headerH: SECTION_TITLE + COL_HEAD + SLOT_ROW, cols: cycles.map((c, i) => ({ cycle: c, x: xCells + i * cw, w: cw })), slots: g.slots, rows: [], restricted: new Map() };
      let ry = y + sec.headerH;
      for (const w of g.who) {
        sec.rows.push({ employeeId: w.person.id, no: numbers.get(w.person.id)!, name: w.person.name, number: w.person.number, detail: w.detail, y: ry, h: ROW_H, note: w.note });
        const m = new Map<number, string>();
        for (const c of cycles) { const r = opts.restricted?.(w.person.id, c); if (r) m.set(c.index, r); }
        if (m.size) sec.restricted.set(w.person.id, m);
        ry += ROW_H;
      }
      page!.sections.push(sec);
      y = ry + 6;
    }
  }
  const total = pages.length;
  for (const p of pages) {
    p.pages = total;
    p.sub = `${code} · Manpower v${version}${opts.approvedOn ? ` approved ${opts.approvedOn}` : ''} · ${p.half === 1 ? 'Jan–Jun' : 'Jul–Dec'} · Page ${p.page} of ${total}`;
    p.bits = encodeId({ year, kind, crew, page: p.page, version });
  }
  return { kind, crew, year, version, title, file: `${code}.pdf`, pages };
}

/** Every marking box of a form (for reading a returned page). */
export function cellBoxes(doc: FormDoc): CellBox[] {
  const out: CellBox[] = [];
  for (const p of doc.pages) for (const s of p.sections) for (const r of s.rows) for (const c of s.cols)
    out.push({ page: p.page, employeeId: r.employeeId, cycle: c.cycle.index, x: c.x + 3, y: r.y + 3, w: c.w - 6, h: r.h - 6 });
  return out;
}

/** The forms of a year: Controllers (all six), Panel (all shifts), Field A, B, C, D. */
export function yearForms(opts: Omit<Parameters<typeof buildForm>[0], 'kind' | 'crew'>): FormDoc[] {
  return [buildForm({ ...opts, kind: 'controllers', crew: null }), buildForm({ ...opts, kind: 'panel', crew: null }),
    ...CREWS.map((c) => buildForm({ ...opts, kind: 'field', crew: c }))];
}
