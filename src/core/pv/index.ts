// PV (annual leave) planning by whole cycles. A crew's cycle is 8 days (2 Morning, 2 Afternoon, 2 Night, 2 Off: 6 duty days),
// and a leave starts on the crew's first Morning day (M1) and covers whole cycles, back to back when it is longer.
// Rules (Section Head): Controllers never off together (all shifts); Panel: one off at a time per shift; Field: two at most per
// shift; summer is peak time: one leave in summer, two cycles at the longest. Each shift keeps 4 Panel seats; a shortfall of
// Grade 14 Panel Operators is filled temporarily with Grade 13 Field Operators, longest in grade first, then the least sick leave.
// Pure functions, no I/O.
import { addDaysIso, dutyFor, type Crew } from '../roster';

export const PV_CYCLE_DAYS = 8;
export const PV_RULES = { panelSeats: 4, panelMaxOff: 1, panelMinOnDuty: 3, fieldMaxOff: 2, fieldMinOnDuty: 6, summerFromMonth: 6, summerToMonth: 9, summerMaxCycles: 2, controllerMaxLeaves: 4, actingGrade: 13 } as const;

export interface PvCycle { index: number; start: string; end: string; summer: boolean }
/** The cycles of one crew that start in `year`: M1 to Off2. */
export function cyclesOf(crew: Crew, year: number): PvCycle[] {
  const out: PvCycle[] = [];
  let d = `${year}-01-01`;
  while (d.startsWith(String(year))) {
    if (dutyFor(d, crew) === 'M1') {
      const m = Number(d.slice(5, 7));
      out.push({ index: out.length, start: d, end: addDaysIso(d, PV_CYCLE_DAYS - 1), summer: m >= PV_RULES.summerFromMonth && m <= PV_RULES.summerToMonth });
      d = addDaysIso(d, PV_CYCLE_DAYS);
    } else d = addDaysIso(d, 1);
  }
  return out;
}

export type PvRole = 'controller' | 'vr_controller' | 'morning_controller' | 'panel_operator' | 'field_operator';
export interface PvPerson { id: string; name: string; number: string; crew: Crew | null; role: PvRole | null; grade: number | null; /** When the person reached the current grade. */ gradeSince: string | null; /** Sick-leave days over the last two years. */ sick: number }

/** Runs of consecutive cycle indexes: [3,4,5,9] → [[3,5],[9,9]]. */
export function runsOf(cycles: Iterable<number>): [number, number][] {
  const sorted = [...cycles].sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (const c of sorted) { const last = out[out.length - 1]; if (last && c === last[1] + 1) last[1] = c; else out.push([c, c]); }
  return out;
}

export interface PanelFill { panel: PvPerson[]; acting: PvPerson[]; /** Seats still empty after the Grade 13 fill. */ short: number; /** Every Grade 13 Field Operator of the shift in the order they are chosen. */ ranked: PvPerson[] }
const byName = (a: PvPerson, b: PvPerson) => a.name.localeCompare(b.name);
/** Panel seats of one shift: its Panel Operators, then Grade 13 Field Operators to reach `seats`: longest in grade first, then least sick leave. */
export function panelFill(shift: PvPerson[], seats: number = PV_RULES.panelSeats): PanelFill {
  const panel = shift.filter((p) => p.role === 'panel_operator').sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0) || byName(a, b));
  const ranked = shift.filter((p) => p.role === 'field_operator' && p.grade === PV_RULES.actingGrade)
    .sort((a, b) => (a.gradeSince ?? '9999').localeCompare(b.gradeSince ?? '9999') || a.sick - b.sick || byName(a, b));
  const need = Math.max(0, seats - panel.length);
  return { panel, acting: ranked.slice(0, need), short: Math.max(0, need - ranked.length), ranked };
}

export interface PvShift { crew: Crew; cycles: PvCycle[]; controllers: string[]; panel: string[]; field: string[] }
export type PvIssueKind = 'controller_overlap' | 'panel_cap' | 'panel_min' | 'field_cap' | 'field_min' | 'summer' | 'leaves' | 'shutdown';
export interface PvIssue { kind: PvIssueKind; text: string; employeeIds: string[]; crew: Crew | null; cycle: number | null }
export interface PvInput {
  shifts: PvShift[];
  /** Picked cycles per person. */
  picks: Map<string, Set<number>>;
  /** Other leave on the plan that still counts for the Controller overlap (VR Controllers, leave not on whole cycles), by date. */
  controllerLeave?: { employeeId: string; start: string; end: string }[];
  /** Days a person is on a shutdown team (no leave then). */
  shutdowns?: { employeeId: string; start: string; end: string; title: string }[];
  names: Map<string, string>;
}
const overlap = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start <= b.end && b.start <= a.end;
const dm = (iso: string) => `${Number(iso.slice(8))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1]}`;

export function checkPv(input: PvInput): PvIssue[] {
  const { shifts, picks, names } = input;
  const nm = (id: string) => names.get(id) ?? 'Employee';
  const issues: PvIssue[] = [];
  // per shift and cycle: Panel and Field off together
  for (const s of shifts) {
    const panelSeatsOff = (c: number) => s.panel.filter((id) => picks.get(id)?.has(c));
    const fieldOff = (c: number) => s.field.filter((id) => picks.get(id)?.has(c));
    for (const c of s.cycles) {
      const po = panelSeatsOff(c.index), fo = fieldOff(c.index);
      if (po.length > PV_RULES.panelMaxOff) issues.push({ kind: 'panel_cap', crew: s.crew, cycle: c.index, employeeIds: po, text: `${s.crew} Shift ${dm(c.start)}: ${po.length} Panel Operators off (${po.map(nm).join(', ')}); only ${PV_RULES.panelMaxOff} at a time.` });
      else if (s.panel.length - po.length < PV_RULES.panelMinOnDuty && po.length > 0) issues.push({ kind: 'panel_min', crew: s.crew, cycle: c.index, employeeIds: po, text: `${s.crew} Shift ${dm(c.start)}: only ${s.panel.length - po.length} Panel Operators left on duty; ${PV_RULES.panelMinOnDuty} needed.` });
      if (fo.length > PV_RULES.fieldMaxOff) issues.push({ kind: 'field_cap', crew: s.crew, cycle: c.index, employeeIds: fo, text: `${s.crew} Shift ${dm(c.start)}: ${fo.length} Field Operators off (${fo.map(nm).join(', ')}); ${PV_RULES.fieldMaxOff} at most.` });
      else if (s.field.length - fo.length < PV_RULES.fieldMinOnDuty && fo.length > 0) issues.push({ kind: 'field_min', crew: s.crew, cycle: c.index, employeeIds: fo, text: `${s.crew} Shift ${dm(c.start)}: only ${s.field.length - fo.length} Field Operators left on duty; ${PV_RULES.fieldMinOnDuty} needed.` });
    }
    // summer: one leave, two cycles at the longest; Controllers also at most 4 leaves a year
    for (const id of [...s.controllers, ...s.panel, ...s.field]) {
      const mine = picks.get(id); if (!mine?.size) continue;
      const summer = [...mine].filter((i) => s.cycles[i]?.summer);
      const runs = runsOf(summer);
      if (summer.length > PV_RULES.summerMaxCycles || runs.length > 1) issues.push({ kind: 'summer', crew: s.crew, cycle: summer[0] ?? null, employeeIds: [id], text: `${nm(id)}: summer is peak time: one leave of ${PV_RULES.summerMaxCycles} cycles at the longest (has ${summer.length} cycles${runs.length > 1 ? ` in ${runs.length} leaves` : ''}).` });
      if (s.controllers.includes(id) && runsOf(mine).length > PV_RULES.controllerMaxLeaves) issues.push({ kind: 'leaves', crew: s.crew, cycle: null, employeeIds: [id], text: `${nm(id)}: ${runsOf(mine).length} leaves; a Controller has ${PV_RULES.controllerMaxLeaves} a year, a 5th needs approval.` });
      for (const sd of input.shutdowns ?? []) {
        if (sd.employeeId !== id) continue;
        const hit = [...mine].find((i) => s.cycles[i] && overlap(s.cycles[i], sd));
        if (hit != null) issues.push({ kind: 'shutdown', crew: s.crew, cycle: hit, employeeIds: [id], text: `${nm(id)}: ${dm(s.cycles[hit].start)} falls in ${sd.title}; a shutdown team member takes no leave then.` });
      }
    }
  }
  // Controllers: never two off on the same day, across all shifts (and other counted leave)
  const spans: { id: string; crew: Crew | null; cycle: number | null; start: string; end: string }[] = [];
  for (const s of shifts) for (const id of s.controllers) for (const i of picks.get(id) ?? []) spans.push({ id, crew: s.crew, cycle: i, start: s.cycles[i].start, end: s.cycles[i].end });
  for (const l of input.controllerLeave ?? []) spans.push({ id: l.employeeId, crew: null, cycle: null, start: l.start, end: l.end });
  const seen = new Set<string>();
  for (let a = 0; a < spans.length; a++) for (let b = a + 1; b < spans.length; b++) {
    const x = spans[a], y = spans[b];
    if (x.id === y.id || !overlap(x, y)) continue;
    const from = x.start > y.start ? x.start : y.start, to = x.end < y.end ? x.end : y.end;
    const key = `${[x.id, y.id].sort().join('|')}|${from}`; if (seen.has(key)) continue; seen.add(key);
    for (const z of [x, y]) if (z.crew && z.cycle != null) issues.push({ kind: 'controller_overlap', crew: z.crew, cycle: z.cycle, employeeIds: [x.id, y.id], text: `${nm(x.id)} and ${nm(y.id)} are both off ${from === to ? dm(from) : `${dm(from)} – ${dm(to)}`}; two Controllers are never off together.` });
    if (!(x.crew && x.cycle != null) && !(y.crew && y.cycle != null)) issues.push({ kind: 'controller_overlap', crew: null, cycle: null, employeeIds: [x.id, y.id], text: `${nm(x.id)} and ${nm(y.id)} are both off ${dm(from)} – ${dm(to)}.` });
  }
  return issues;
}

export type PvContext = Pick<PvInput, 'shifts' | 'picks' | 'controllerLeave' | 'shutdowns' | 'names'>;

/**
 * Why booking this cycle for this person would break a rule, or null when it is fine. Cheap enough to ask for every free cell
 * of the calendar, so the page can show what is taken before anyone taps.
 */
export function blockReason(ctx: PvContext, personId: string, index: number): string | null {
  const shift = ctx.shifts.find((s) => s.controllers.includes(personId) || s.panel.includes(personId) || s.field.includes(personId));
  const cycle = shift?.cycles[index];
  if (!shift || !cycle) return null;
  const nm = (id: string) => ctx.names.get(id) ?? 'Employee';
  const off = (ids: string[]) => ids.filter((id) => id !== personId && ctx.picks.get(id)?.has(index));
  const mine = ctx.picks.get(personId) ?? new Set<number>();
  if (cycle.summer) {
    const summer = [...mine].filter((i) => shift.cycles[i]?.summer);
    if (summer.length >= PV_RULES.summerMaxCycles) return `Summer is peak time: already ${summer.length} cycles (two at the longest).`;
    if (summer.length > 0 && !summer.some((i) => Math.abs(i - index) === 1)) return 'Summer is peak time: only one leave, and it must be one run of cycles.';
  }
  for (const sd of ctx.shutdowns ?? []) if (sd.employeeId === personId && overlap(cycle, sd)) return `In ${sd.title}: a shutdown team member takes no leave then.`;
  if (shift.panel.includes(personId)) { const o = off(shift.panel); if (o.length >= PV_RULES.panelMaxOff) return `${o.map(nm).join(', ')} (Panel) is off then; one Panel Operator at a time.`; }
  if (shift.field.includes(personId)) { const o = off(shift.field); if (o.length >= PV_RULES.fieldMaxOff) return `${o.map(nm).join(' and ')} (Field) are off then; ${PV_RULES.fieldMaxOff} at most.`; }
  if (shift.controllers.includes(personId)) {
    const clash: string[] = [];
    for (const s of ctx.shifts) for (const id of s.controllers) {
      if (id === personId) continue;
      if ([...(ctx.picks.get(id) ?? [])].some((i) => s.cycles[i] && overlap(s.cycles[i], cycle))) clash.push(nm(id));
    }
    for (const l of ctx.controllerLeave ?? []) if (l.employeeId !== personId && overlap(l, cycle)) clash.push(nm(l.employeeId));
    if (clash.length) return `${[...new Set(clash)].join(', ')} (Controller) is off then; two Controllers are never off together.`;
  }
  return null;
}
