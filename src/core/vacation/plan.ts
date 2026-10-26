// Annual vacation planning, steps 4–6: the vacation periods of every person, checked with one service everywhere
// (cycle grid, form import, the review, the server before approval). Capacity per shift and cycle (Panel / Field
// slots), Controllers one at a time across the unit, summer, confirmed shutdown teams, other leave, whole cycles,
// 4–5 periods a year, and the crews' minimums day by day with the manpower engine (floating Panel relief added where
// it is free). Pure functions, no I/O.
import { evaluateDay, type MpAbsence, type MpPerson, type RulesSource } from '../manpower';
import { cyclesOf, runsOf, type PvCycle } from '../pv';
import { CREWS, addDaysIso, type Crew } from '../roster';
import { cycleCrewOf, isControllerGroup, planningPeople, type AllocEval, type AllocRow, type IssueLevel, type PlanPerson } from './allocation';
import { VAC_RULES } from './rules';

export type BlockSource = 'manual' | 'form' | 'system';
export interface Block { id?: string; employeeId: string; start: string; end: string; source: BlockSource }
export interface PlanIssue { level: IssueLevel; code: string; employeeIds: string[]; crew: Crew | null; cycle: number | null; date?: string; text: string }

export interface PlanCtx {
  year: number;
  people: PlanPerson[];
  rows: AllocRow[];
  alloc: AllocEval;
  blocks: Block[];
  /** Other leave and task releases of the plan year (current plan): they stay, vacations go around them. */
  other: MpAbsence[];
  /** Confirmed shutdown team dates (active plans only): no vacation then. */
  shutdowns: { employeeId: string; start: string; end: string; title: string }[];
  rules: RulesSource;
}

export interface Prepared {
  ctx: PlanCtx;
  byId: Map<string, PlanPerson>;
  rowOf: Map<string, AllocRow>;
  cycles: Record<Crew, PvCycle[]>;
  /** Picked cycle indexes per person (whole cycles of their rota only). */
  picks: Map<string, Set<number>>;
  /** Blocks that are not whole cycles of the person's rota. */
  partial: Block[];
  mp: MpPerson[];
  floats: MpPerson[];
}

export function prepare(ctx: PlanCtx): Prepared {
  const byId = new Map(ctx.people.map((p) => [p.id, p]));
  const rowOf = new Map(ctx.rows.map((r) => [r.employeeId, r]));
  const cycles = Object.fromEntries(CREWS.map((c) => [c, cyclesOf(c, ctx.year)])) as Record<Crew, PvCycle[]>;
  const picks = new Map<string, Set<number>>(); const partial: Block[] = [];
  for (const b of ctx.blocks) {
    const row = rowOf.get(b.employeeId); const crew = row ? cycleCrewOf(row) : null;
    const list = crew ? cycles[crew] : [];
    const a = list.findIndex((c) => c.start === b.start), z = list.findIndex((c) => c.end === b.end);
    if (a < 0 || z < a) { partial.push(b); continue; }
    const s = picks.get(b.employeeId) ?? new Set<number>(); for (let i = a; i <= z; i++) s.add(i); picks.set(b.employeeId, s);
  }
  const mp = planningPeople(ctx.people, ctx.alloc);
  const floats = ctx.rows.filter((r) => r.group === 'relief' && r.relief === 'float_panel').flatMap((r) => {
    const p = byId.get(r.employeeId); if (!p) return [];
    return [{ id: p.id, employeeNumber: p.number, name: p.name, grade: p.grade, role: 'panel_operator' as const, crew: null, employmentType: p.employmentType,
      takeCharge: p.takeCharge, panelQualified: p.panelQualified, actingController: p.actingController, sick12: p.sick?.days ?? null }];
  });
  return { ctx, byId, rowOf, cycles, picks, partial, mp, floats };
}

/** The cycles a person's vacation is chosen from. */
export const cyclesFor = (pr: Prepared, id: string): PvCycle[] => { const r = pr.rowOf.get(id); const c = r ? cycleCrewOf(r) : null; return c ? pr.cycles[c] : []; };
const isSummer = (c: PvCycle) => c.summer;
const overlap = (a: { start: string; end: string }, b: { start: string; end: string }) => a.start <= b.end && b.start <= a.end;
const counted = (a: MpAbsence) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false;
const dm = (iso: string) => `${Number(iso.slice(8))} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1]}`;

/** Where a person's vacation counts: their shift and Panel / Field slot group (null: not in a slot group). */
export function slotGroup(pr: Prepared, id: string): { crew: Crew; kind: 'panel' | 'field' } | null {
  const pl = pr.ctx.alloc.placed.get(id); if (!pl) return null;
  const { row, acting } = pl;
  if (!row.crew) return null;
  if (row.group === 'panel' || (row.group === 'field' && acting)) return { crew: row.crew, kind: 'panel' };
  if (row.group === 'field') return { crew: row.crew, kind: 'field' };
  return null;
}
const slotsOf = (pr: Prepared, g: { crew: Crew; kind: 'panel' | 'field' }) => (g.kind === 'panel' ? pr.ctx.alloc.crews[g.crew].panelSlots : pr.ctx.alloc.crews[g.crew].fieldSlots);
/** Others of the same slot group off on that cycle. */
export function slotTaken(pr: Prepared, id: string, index: number): string[] {
  const g = slotGroup(pr, id); if (!g) return [];
  return [...pr.picks].filter(([o, s]) => o !== id && s.has(index) && (() => { const og = slotGroup(pr, o); return og?.crew === g.crew && og.kind === g.kind; })()).map(([o]) => o);
}

const asAbsence = (id: string, c: PvCycle, tag: string): MpAbsence =>
  ({ id: tag, employeeId: id, start: c.start, end: c.end, status: 'approved', typeCode: 'annual_leave_planned', typeLabel: 'Vacation', inCurrentPlan: true, oracle: 'approved' });
function vacationAbsences(pr: Prepared, extra?: { id: string; index: number }, without?: { id: string; index: number }): MpAbsence[] {
  const out: MpAbsence[] = [];
  for (const [id, s] of pr.picks) { const cyc = cyclesFor(pr, id); for (const i of s) if (!(without && without.id === id && without.index === i) && cyc[i]) out.push(asAbsence(id, cyc[i], `v-${id}-${i}`)); }
  if (extra) { const c = cyclesFor(pr, extra.id)[extra.index]; if (c) out.push(asAbsence(extra.id, c, `v-${extra.id}-${extra.index}`)); }
  return out;
}

/**
 * The crews' minimums on each date with the manpower engine: a crew short on Panel gets a free floating relief (one
 * shift per day, not on vacation); anything still short is a shortage. `onlyCrew`: check that crew only.
 */
export function coverageShortages(pr: Prepared, dates: string[], absences: MpAbsence[], onlyCrew?: Crew): { date: string; crew: Crew; what: string }[] {
  const out: { date: string; crew: Crew; what: string }[] = [];
  const all = [...absences, ...pr.ctx.other.filter(counted)];
  for (const date of dates) {
    const day = evaluateDay(date, pr.mp, all, pr.ctx.rules, []);
    const freeFloats = pr.floats.filter((f) => !all.some((a) => a.employeeId === f.id && a.start <= date && date <= a.end));
    for (const c of day.crews) {
      if (!c.working || !c.confirmedShortage) continue;
      // every short crew takes a free floating relief in turn (one shift per day), whichever crew is reported
      let fixed = false;
      if (c.panel.finding === 'shortage' && freeFloats.length) {
        const f = freeFloats.shift()!;
        const again = evaluateDay(date, [...pr.mp, { ...f, crew: c.crew }], all, pr.ctx.rules, []).crews.find((x) => x.crew === c.crew)!;
        fixed = !again.confirmedShortage;
      }
      if (onlyCrew && c.crew !== onlyCrew) continue;
      if (!fixed) out.push({ date, crew: c.crew, what: [c.controller, c.panel, c.field].filter((x) => x.finding === 'shortage').map((x) => `${x.label} ${x.count} of ${x.min}`).join(', ') || 'below minimum' });
    }
  }
  return out;
}
const datesOf = (c: PvCycle) => { const d: string[] = []; for (let x = c.start; x <= c.end; x = addDaysIso(x, 1)) d.push(x); return d; };

export type CellState = 'selected' | 'available' | 'full' | 'conflict' | 'restricted';
export interface CellInfo { state: CellState; reason: string | null }

/**
 * Can this person take this cycle now (with everything else as it is)? restricted: their own rules (summer, shutdown,
 * other leave, five periods) · full: the slot or the Controller turn is taken · conflict: a crew would fall short.
 * A selected cycle reports its own problem, if any, as conflict.
 */
export function cellInfo(pr: Prepared, id: string, index: number, opts: { coverage?: boolean } = {}): CellInfo {
  const cyc = cyclesFor(pr, id); const c = cyc[index];
  if (!c) return { state: 'restricted', reason: 'Not a cycle of this rota.' };
  const mine = pr.picks.get(id) ?? new Set<number>();
  const selected = mine.has(index);
  const others = new Set([...mine].filter((i) => i !== index));
  const name = (o: string) => pr.byId.get(o)?.name ?? 'Employee';
  const fail = (state: CellState, reason: string): CellInfo => ({ state: selected ? 'conflict' : state, reason });
  // own rules
  for (const sd of pr.ctx.shutdowns) if (sd.employeeId === id && overlap(c, sd)) return fail('restricted', `On the ${sd.title} team ${dm(sd.start)} – ${dm(sd.end)}.`);
  const clash = pr.ctx.other.find((a) => a.employeeId === id && counted(a) && overlap(c, a));
  if (clash) return fail('restricted', `Already off: ${clash.typeLabel ?? clash.typeShort ?? 'leave'} ${dm(clash.start)} – ${dm(clash.end)}.`);
  if (c.summer) {
    const summer = [...others].filter((i) => cyc[i]?.summer);
    const runs = runsOf([...summer, index]);
    if (summer.length + 1 > VAC_RULES.summerMaxCycles) return fail('restricted', `Summer: ${VAC_RULES.summerMaxCycles} cycles at the longest.`);
    if (runs.length > VAC_RULES.summerMaxPeriods) return fail('restricted', 'Summer: one vacation, in one run of cycles.');
  }
  if (!selected && runsOf([...others, index]).length > VAC_RULES.maxPeriods) return { state: 'restricted', reason: `${VAC_RULES.maxPeriods} vacation periods already.` };
  // slot and Controller turn
  const g = slotGroup(pr, id);
  if (g) {
    const taken = slotTaken(pr, id, index); const slots = slotsOf(pr, g);
    if (taken.length + 1 > slots) return fail('full', slots === 0 ? `${g.crew} Shift ${g.kind === 'panel' ? 'Panel' : 'Field'}: no vacation slot.` : `${g.crew} Shift ${g.kind === 'panel' ? 'Panel' : 'Field'} ${slots} slot${slots === 1 ? '' : 's'}: ${taken.map(name).join(', ')}.`);
  }
  const row = pr.rowOf.get(id);
  if (row && isControllerGroup(row)) {
    for (const [o, s] of pr.picks) {
      const or = pr.rowOf.get(o); if (o === id || !or || !isControllerGroup(or)) continue;
      const oc = cyclesFor(pr, o);
      for (const i of s) if (oc[i] && overlap(oc[i], c)) return fail('full', `Controller off then: ${name(o)} ${dm(oc[i].start)} – ${dm(oc[i].end)}.`);
    }
    for (const a of pr.ctx.other) { const ar = pr.rowOf.get(a.employeeId); if (a.employeeId !== id && ar && isControllerGroup(ar) && counted(a) && overlap(a, c)) return fail('full', `Controller off then: ${name(a.employeeId)} (${a.typeShort ?? 'leave'}).`); }
  }
  if (opts.coverage !== false) {
    const abs = selected ? vacationAbsences(pr) : vacationAbsences(pr, { id, index });
    const crew = row ? (row.group === 'relief' ? null : row.crew) : null;
    const short = coverageShortages(pr, datesOf(c), abs, crew ?? undefined);
    if (short.length) {
      const base = selected ? coverageShortages(pr, datesOf(c), vacationAbsences(pr, undefined, { id, index }), crew ?? undefined) : [];
      const caused = short.filter((s) => !base.some((b) => b.date === s.date && b.crew === s.crew));
      if (caused.length || !selected) return fail('conflict', `${short[0].crew} Shift short ${dm(short[0].date)}: ${short[0].what}.`);
    }
  }
  return { state: selected ? 'selected' : 'available', reason: null };
}

export interface PersonPlan { periods: [number, number][]; cycles: number; summerCycles: number; systemPeriods: number; status: 'ok' | 'missing' | 'over' | 'conflict' }
export interface PlanCheck {
  issues: PlanIssue[];
  persons: Map<string, PersonPlan>;
  /** Off per shift, slot group and cycle index. */
  usage: Record<Crew, { panel: number[]; field: number[] }>;
  summary: { people: number; complete: number; missing: number; over: number; system: number; conflicts: number; shortages: number; periods: number; freePanel: number; freeField: number; byCrew: Record<Crew, { freePanel: number; freeField: number }> };
}

/** Every check of the whole plan. `final`: fewer than four periods is an error (the plan cannot be approved). */
export function checkPlan(ctx: PlanCtx, opts: { final?: boolean; coverage?: boolean } = {}): PlanCheck {
  const pr = prepare(ctx);
  const issues: PlanIssue[] = [];
  const name = (id: string) => pr.byId.get(id)?.name ?? 'Employee';
  const crewOf = (id: string) => { const r = pr.rowOf.get(id); return r ? cycleCrewOf(r) : null; };
  for (const b of pr.partial) issues.push({ level: 'error', code: 'partial', employeeIds: [b.employeeId], crew: crewOf(b.employeeId), cycle: null, date: b.start,
    text: `${name(b.employeeId)}: ${dm(b.start)} – ${dm(b.end)} is not whole cycles of ${crewOf(b.employeeId) ?? 'their'} rota.` });
  for (const b of ctx.blocks) if (!ctx.alloc.placed.has(b.employeeId)) issues.push({ level: 'error', code: 'not_in_plan', employeeIds: [b.employeeId], crew: null, cycle: null, text: `${name(b.employeeId)}: not in the approved manpower plan.` });
  // overlapping blocks of one person
  const byPerson = new Map<string, Block[]>(); for (const b of ctx.blocks) byPerson.set(b.employeeId, [...(byPerson.get(b.employeeId) ?? []), b]);
  for (const [id, bs] of byPerson) { const s = [...bs].sort((a, b) => a.start.localeCompare(b.start)); for (let i = 1; i < s.length; i++) if (s[i].start <= s[i - 1].end)
    issues.push({ level: 'error', code: 'overlap_self', employeeIds: [id], crew: crewOf(id), cycle: null, text: `${name(id)}: two vacations overlap on ${dm(s[i].start)}.` }); }
  // per cycle cell
  const persons = new Map<string, PersonPlan>();
  const seen = new Set<string>();
  const planned = ctx.people.filter((p) => { const pl = ctx.alloc.placed.get(p.id); return !!pl && cycleCrewOf(pl.row) !== null; });
  for (const p of planned) {
    const s = pr.picks.get(p.id) ?? new Set<number>(); const cyc = cyclesFor(pr, p.id);
    const periods = runsOf(s); let conflict = false;
    for (const i of s) {
      const info = cellInfo(pr, p.id, i, { coverage: false });
      if (info.state === 'conflict') {
        conflict = true;
        const key = `${p.id}|${i}|${info.reason}`; if (seen.has(key)) continue; seen.add(key);
        issues.push({ level: 'error', code: 'cell', employeeIds: [p.id], crew: crewOf(p.id), cycle: i, date: cyc[i]?.start, text: `${p.name} · ${crewOf(p.id)} cycle ${i + 1} (${cyc[i] ? dm(cyc[i].start) : '?'}): ${info.reason}` });
      }
    }
    const blocksOf = byPerson.get(p.id) ?? [];
    const system = periods.filter(([a]) => blocksOf.some((b) => b.source === 'system' && b.start === cyc[a]?.start)).length;
    const status: PersonPlan['status'] = conflict ? 'conflict' : periods.length > VAC_RULES.maxPeriods ? 'over' : periods.length < VAC_RULES.minPeriods ? 'missing' : 'ok';
    if (periods.length > VAC_RULES.maxPeriods) issues.push({ level: 'error', code: 'over', employeeIds: [p.id], crew: crewOf(p.id), cycle: null, text: `${p.name}: ${periods.length} vacation periods; ${VAC_RULES.maxPeriods} at most.` });
    if (periods.length < VAC_RULES.minPeriods) issues.push({ level: opts.final ? 'error' : 'warning', code: 'missing', employeeIds: [p.id], crew: crewOf(p.id), cycle: null, text: `${p.name}: ${periods.length} of ${VAC_RULES.minPeriods} vacation periods.` });
    persons.set(p.id, { periods, cycles: s.size, summerCycles: [...s].filter((i) => cyc[i] && isSummer(cyc[i])).length, systemPeriods: system, status });
  }
  // coverage day by day (engine), once for the whole year
  let shortages = 0;
  if (opts.coverage !== false) {
    const abs = vacationAbsences(pr);
    const dates = new Set<string>(); for (const a of abs) for (let d = a.start; d <= a.end; d = addDaysIso(d, 1)) dates.add(d);
    const base = coverageShortages(pr, [...dates].sort(), []);
    const short = coverageShortages(pr, [...dates].sort(), abs).filter((s) => !base.some((b) => b.date === s.date && b.crew === s.crew));
    const done = new Set<string>();
    for (const s of short) {
      const idx = pr.cycles[s.crew].findIndex((c) => c.start <= s.date && s.date <= c.end);
      const key = `${s.crew}|${idx}`; if (done.has(key)) continue; done.add(key); shortages++;
      const off = abs.filter((a) => a.start <= s.date && s.date <= a.end).map((a) => a.employeeId).filter((id) => { const r = pr.rowOf.get(id); return r?.crew === s.crew || cycleCrewOf(r!) === s.crew; });
      issues.push({ level: 'error', code: 'coverage', employeeIds: off, crew: s.crew, cycle: idx, date: s.date, text: `${s.crew} Shift short ${dm(s.date)} (cycle ${idx + 1}): ${s.what}. Off: ${off.map(name).join(', ') || '—'}.` });
      for (const id of off) { const pp = persons.get(id); if (pp) pp.status = 'conflict'; }
    }
    for (const b of base) { const k = `base|${b.crew}`; if (done.has(k)) continue; done.add(k);
      issues.push({ level: 'warning', code: 'coverage_base', employeeIds: [], crew: b.crew, cycle: null, date: b.date, text: `${b.crew} Shift short ${dm(b.date)} even without vacations: ${b.what}.` }); }
  }
  const usage = {} as PlanCheck['usage'];
  const byCrew = {} as PlanCheck['summary']['byCrew'];
  let freePanel = 0, freeField = 0;
  for (const c of CREWS) {
    const n = pr.cycles[c].length;
    const u = { panel: Array(n).fill(0) as number[], field: Array(n).fill(0) as number[] };
    for (const [id, s] of pr.picks) { const g = slotGroup(pr, id); if (g?.crew !== c) continue; for (const i of s) if (i < n) u[g.kind][i]++; }
    usage[c] = u;
    const a = ctx.alloc.crews[c];
    const fp = u.panel.reduce((t, x) => t + Math.max(0, a.panelSlots - x), 0), ff = u.field.reduce((t, x) => t + Math.max(0, a.fieldSlots - x), 0);
    byCrew[c] = { freePanel: fp, freeField: ff }; freePanel += fp; freeField += ff;
  }
  const all = [...persons.values()];
  return {
    issues, persons, usage,
    summary: { people: all.length, complete: all.filter((p) => p.status === 'ok').length, missing: all.filter((p) => p.periods.length < VAC_RULES.minPeriods).length,
      over: all.filter((p) => p.status === 'over').length, system: all.reduce((t, p) => t + p.systemPeriods, 0),
      conflicts: issues.filter((i) => i.level === 'error' && i.code !== 'missing').length, shortages, periods: all.reduce((t, p) => t + p.periods.length, 0), freePanel, freeField, byCrew }
  };
}

export interface AutoResult { blocks: Block[]; exceptions: { employeeId: string; text: string }[] }

/**
 * Proposes the missing periods (up to four) for everyone short, one period per person per round so the free cycles are
 * shared fairly. A proposal is one free cycle that passes every check, not next to the person's own vacations (it must
 * be a new period); the emptiest cycle of their slot group first, then the farthest from their own vacations, then
 * the earliest. Nothing already chosen is moved. No valid cycle: an exception for the Section Head.
 */
export function autoAssign(ctx: PlanCtx, only?: Set<string>): AutoResult {
  let blocks = [...ctx.blocks];
  const added: Block[] = []; const exceptions: { employeeId: string; text: string }[] = [];
  const stuck = new Set<string>();
  const order = ctx.people.filter((p) => { const pl = ctx.alloc.placed.get(p.id); return !!pl && cycleCrewOf(pl.row) !== null; })
    .filter((p) => !only || only.has(p.id)).sort((a, b) => a.number.localeCompare(b.number));
  for (let round = 0; round < VAC_RULES.minPeriods; round++) {
    for (const p of order) {
      if (stuck.has(p.id)) continue;
      const pr = prepare({ ...ctx, blocks });
      const mine = pr.picks.get(p.id) ?? new Set<number>();
      if (runsOf(mine).length >= VAC_RULES.minPeriods) continue;
      const cyc = cyclesFor(pr, p.id);
      const g = slotGroup(pr, p.id);
      const candidates = cyc.filter((c) => c.start.startsWith(String(ctx.year)) && !mine.has(c.index) && !mine.has(c.index - 1) && !mine.has(c.index + 1))
        .map((c) => ({ c, load: g ? slotTaken(pr, p.id, c.index).length : 0, dist: mine.size ? Math.min(...[...mine].map((i) => Math.abs(i - c.index))) : 99 }))
        .sort((a, b) => a.load - b.load || b.dist - a.dist || a.c.index - b.c.index);
      const pick = candidates.find((x) => cellInfo(pr, p.id, x.c.index).state === 'available');
      if (!pick) { stuck.add(p.id); exceptions.push({ employeeId: p.id, text: `${p.name}: no free cycle for vacation period ${runsOf(mine).length + 1} (slots, Controller turns, summer or crew minimums).` }); continue; }
      const b: Block = { employeeId: p.id, start: pick.c.start, end: pick.c.end, source: 'system' };
      blocks = [...blocks, b]; added.push(b);
    }
  }
  return { blocks: added, exceptions };
}

/**
 * A person's chosen cycles as vacation blocks (one per run of neighbouring cycles). A run that matches a block already
 * saved keeps its source (system / form); anything else gets `source`.
 */
export function blocksFromPicks(cycles: PvCycle[], employeeId: string, picks: Iterable<number>, existing: Block[], source: BlockSource): Block[] {
  return runsOf(picks).flatMap(([a, z]) => {
    const start = cycles[a]?.start, end = cycles[z]?.end;
    if (!start || !end) return [];
    const same = existing.find((b) => b.employeeId === employeeId && b.start === start && b.end === end);
    return [{ employeeId, start, end, source: same?.source ?? source }];
  });
}
