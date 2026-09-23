import { addDays, eachDay } from './sheet';
import { isOff } from '../roster';
import type { Crew } from '../roster';
import type {
  ExistingEmployee, ExistingLeave, ImportPlan, ParsedGridRun, ParsedManpowerWorkbook, ParsedPerson, ParsedPromotionMaster,
  PlanSummary, RoleCode, StagedRow
} from './types';

/** KNPC employee numbers are 5 digits; contractor badge numbers are 6 digits. Recorded as "inferred". */
export function inferEmploymentType(employeeNumber: string): 'knpc' | 'contractor' {
  return employeeNumber.replace(/^0+/, '').length >= 6 ? 'contractor' : 'knpc';
}

const ROLE_LABEL: Record<RoleCode, string> = {
  controller: 'Controller', vr_controller: 'Vacation Relief Controller', morning_controller: 'Morning Controller',
  panel_operator: 'Panel Operator', field_operator: 'Field Operator'
};

class RowBuilder {
  rows: StagedRow[] = [];
  add(row: Omit<StagedRow, 'seq'>) { this.rows.push({ seq: this.rows.length + 1, ...row }); }
}

function emptySummary(): PlanSummary {
  return { read: 0, employeesNew: 0, employeesChanged: 0, employeesUnchanged: 0, unmatched: 0, ignored: 0, review: 0, errors: 0, leaveNew: 0, leaveUnchanged: 0, qualificationsNew: 0, roleAssignmentsNew: 0 };
}

export function summarize(rows: StagedRow[]): PlanSummary {
  const s = emptySummary();
  s.read = rows.length;
  for (const r of rows) {
    if (r.entity_kind === 'employee') {
      if (r.outcome === 'new') s.employeesNew++;
      else if (r.outcome === 'changed') s.employeesChanged++;
      else if (r.outcome === 'unchanged') s.employeesUnchanged++;
    }
    if (r.entity_kind === 'leave_record') {
      if (r.outcome === 'new' || r.outcome === 'review') { if (r.payload) s.leaveNew++; }
      else if (r.outcome === 'unchanged') s.leaveUnchanged++;
    }
    if (r.entity_kind === 'qualification' && r.outcome === 'new') s.qualificationsNew++;
    if (r.entity_kind === 'role_assignment' && (r.outcome === 'new' || r.outcome === 'changed')) s.roleAssignmentsNew++;
    if (r.outcome === 'unmatched') s.unmatched++;
    if (r.outcome === 'ignored_out_of_scope') s.ignored++;
    if (r.outcome === 'error') s.errors++;
    if (r.needs_review) s.review++;
  }
  return s;
}

function sheetOf(sourceRef: string): string | null {
  const parts = sourceRef.split(' / ');
  return parts.length >= 2 ? parts[1] : null;
}
function cellOf(sourceRef: string): string | null {
  const parts = sourceRef.split(' / ');
  return parts.length >= 3 ? parts.slice(2).join(' / ') : null;
}

// ------------------------------------------------------------------ manpower workbook

/** Runs are produced per month sheet; a leave that spans a month end arrives as two runs. */
export function mergeGridRuns(runs: ParsedGridRun[]): ParsedGridRun[] {
  const sorted = [...runs].sort((a, b) => a.employeeNumber.localeCompare(b.employeeNumber) || a.start.localeCompare(b.start));
  const out: ParsedGridRun[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.employeeNumber === r.employeeNumber && addDays(last.end, 1) >= r.start) {
      if (r.end > last.end) last.end = r.end;
      if (!last.sourceRef.includes(' + ')) last.sourceRef = `${last.sourceRef} + ${r.sourceRef.split(' / ').slice(1).join(' / ')}`;
    } else out.push({ ...r });
  }
  return out;
}

export function planManpowerImport(
  parsed: ParsedManpowerWorkbook,
  existing: ExistingEmployee[],
  existingLeaves: ExistingLeave[],
  fileName: string
): ImportPlan {
  const b = new RowBuilder();
  const warnings = [...parsed.warnings];
  const byNumber = new Map(existing.map((e) => [e.employee_number, e]));
  const leavesByEmp = new Map<string, ExistingLeave[]>();
  for (const l of existingLeaves) { const arr = leavesByEmp.get(l.employee_id) ?? []; arr.push(l); leavesByEmp.set(l.employee_id, arr); }

  // Merge people: PV first (has crews for everyone), then grid people not on the PV sheet.
  const people = new Map<string, ParsedPerson & { fromGrid?: ParsedPerson }>();
  for (const p of parsed.pvPeople) {
    if (people.has(p.employeeNumber)) { b.add({ sheet: sheetOf(p.sourceRef), row_ref: cellOf(p.sourceRef), entity_kind: 'note', employee_number: p.employeeNumber, matched_employee_id: null, outcome: 'error', needs_review: true, raw: { name: p.shortName }, payload: null, diff: null, message: `Employee number ${p.employeeNumber} appears twice on the PV sheet` }); continue; }
    people.set(p.employeeNumber, { ...p });
  }
  const gridSeen = new Set<string>();
  for (const g of parsed.gridPeople) {
    const key = g.employeeNumber;
    const existingP = people.get(key);
    if (existingP) {
      if (!existingP.fromGrid) existingP.fromGrid = g;
      // crew conflict between PV sheet and field block
      if (g.crew && existingP.crew && g.crew !== existingP.crew && !gridSeen.has(key + g.crew)) {
        gridSeen.add(key + g.crew);
        b.add({ sheet: sheetOf(g.sourceRef), row_ref: cellOf(g.sourceRef), entity_kind: 'note', employee_number: key, matched_employee_id: byNumber.get(key)?.id ?? null, outcome: 'review', needs_review: true, raw: { pvCrew: existingP.crew, gridCrew: g.crew }, payload: null, diff: null, message: `${g.shortName}: PV sheet says crew ${existingP.crew} but ${sheetOf(g.sourceRef)} lists them under ${g.crew} Shift` });
      }
      if (g.role !== existingP.role && !(existingP.role.endsWith('controller') && g.role === 'controller') && !gridSeen.has(key + g.role)) {
        gridSeen.add(key + g.role);
        b.add({ sheet: sheetOf(g.sourceRef), row_ref: cellOf(g.sourceRef), entity_kind: 'note', employee_number: key, matched_employee_id: byNumber.get(key)?.id ?? null, outcome: 'review', needs_review: true, raw: { pvRole: existingP.role, gridRole: g.role }, payload: null, diff: null, message: `${g.shortName}: PV sheet role ${ROLE_LABEL[existingP.role]} differs from block "${g.role}" on ${sheetOf(g.sourceRef)}` });
      }
    } else if (!gridSeen.has(key)) {
      gridSeen.add(key);
      people.set(key, { ...g });
      warnings.push(`${g.shortName} (${key}) is on the monthly grid but not on the PV sheet; crew taken from the grid block.`);
    }
  }

  const yearStart = `${parsed.year}-01-01`;
  for (const p of people.values()) {
    const ex = byNumber.get(p.employeeNumber) ?? null;
    const sheet = sheetOf(p.sourceRef); const cell = cellOf(p.sourceRef);
    const raw = { employee_number: p.employeeNumber, name: p.shortName, role: p.role, crew: p.crew, source: p.sourceRef };
    if (!ex) {
      const employment = inferEmploymentType(p.employeeNumber);
      b.add({ sheet, row_ref: cell, entity_kind: 'employee', employee_number: p.employeeNumber, matched_employee_id: null, outcome: 'new', needs_review: false, raw, diff: null,
        payload: { employee_number: p.employeeNumber, short_name: p.shortName, full_name: p.shortName, employment_type: employment, employment_type_source: 'inferred', in_unit12_scope: true, section_code: 'A4-S1-U12', notes: `Created from ${p.sourceRef}` },
        message: `New ${ROLE_LABEL[p.role]}${p.crew ? ` (${p.crew} Shift)` : ''}; employment type ${employment} inferred from the ${p.employeeNumber.length}-digit number` });
    } else {
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      if (!ex.short_name || ex.short_name !== p.shortName) diff.short_name = { from: ex.short_name, to: p.shortName };
      if (!ex.in_unit12_scope) diff.in_unit12_scope = { from: false, to: true };
      const changed = Object.keys(diff).length > 0;
      b.add({ sheet, row_ref: cell, entity_kind: 'employee', employee_number: p.employeeNumber, matched_employee_id: ex.id, outcome: changed ? 'changed' : 'unchanged', needs_review: false, raw,
        payload: changed ? Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.to])) : null, diff: changed ? diff : null, message: changed ? 'Matched by employee number; short name / scope updated' : 'Matched by employee number; no change' });
    }
    // role assignment
    const cur = ex?.current_role ?? null;
    const same = cur && cur.position_code === p.role && (cur.crew_code ?? null) === (p.crew ?? null);
    b.add({ sheet, row_ref: cell, entity_kind: 'role_assignment', employee_number: p.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: same ? 'unchanged' : (cur ? 'changed' : 'new'), needs_review: false, raw,
      payload: same ? null : { position_code: p.role, crew_code: p.crew, effective_from: yearStart, source_ref: p.sourceRef },
      diff: same || !cur ? null : { role: { from: `${cur.position_code}/${cur.crew_code ?? '-'}`, to: `${p.role}/${p.crew ?? '-'}` } },
      message: same ? `Role ${ROLE_LABEL[p.role]}${p.crew ? ` ${p.crew}` : ''} unchanged` : `${ROLE_LABEL[p.role]}${p.crew ? `, ${p.crew} Shift` : ''}${cur ? ' (replaces current assignment)' : ''}` });
    // qualification evidence
    const quals: { q: 'take_charge' | 'panel_operator' | 'controller'; status: 'yes' | 'not_yet_confirmed'; evidence: string }[] = [];
    if (p.role === 'panel_operator') quals.push({ q: 'panel_operator', status: 'yes', evidence: `Listed in the Panel operators section (${sheet ?? 'workbook'}). Initial evidence; confirm in the profile.` });
    if (p.role === 'controller' || p.role === 'vr_controller' || p.role === 'morning_controller') quals.push({ q: 'controller', status: 'yes', evidence: `Listed in the Controller section (${sheet ?? 'workbook'}). Initial evidence.` });
    if (p.role === 'field_operator') quals.push({ q: 'take_charge', status: 'not_yet_confirmed', evidence: 'Not in any source workbook; awaiting Section Head confirmation.' });
    for (const q of quals) {
      const has = ex?.qualifications?.[q.q];
      b.add({ sheet, row_ref: cell, entity_kind: 'qualification', employee_number: p.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: has ? 'unchanged' : 'new', needs_review: false, raw: { qualification: q.q },
        payload: has ? null : { qualification: q.q, status: q.status, source: 'import_inference', evidence: q.evidence, effective_from: yearStart },
        diff: null, message: has ? `${q.q} already recorded (${has}); import does not override` : `${q.q}: ${q.status.replace(/_/g, ' ')}` });
    }
  }

  // PV leave ranges. A monthly-grid mark is covered by a PV block on its actual calendar dates, plus any days
  // immediately after the block that the ROSTER ENGINE says are Off for the employee's crew (a block that ends
  // on N2 is followed by Off1/Off2; a block ending on a working day gets no extension). Never "end + 2".
  const crewOf = new Map<string, Crew | null>();
  for (const p of people.values()) crewOf.set(p.employeeNumber, p.crew);
  const pvDaysByEmp = new Map<string, Set<string>>();
  const addPvDays = (emp: string, start: string, end: string) => {
    const set = pvDaysByEmp.get(emp) ?? new Set<string>();
    for (const d of eachDay(start, end)) set.add(d);
    const crew = crewOf.get(emp) ?? null;
    if (crew) {
      let d = addDays(end, 1);
      while (isOff(d, crew)) { set.add(d); d = addDays(d, 1); }
    }
    pvDaysByEmp.set(emp, set);
  };
  const seenPv = new Set<string>();
  for (const rg of parsed.pvRanges) {
    const ex = byNumber.get(rg.employeeNumber) ?? null;
    const key = `${rg.employeeNumber}|${rg.start}|${rg.end}`;
    addPvDays(rg.employeeNumber, rg.start, rg.end);
    const sheet = sheetOf(rg.sourceRef); const cell = cellOf(rg.sourceRef);
    const raw = { employee_number: rg.employeeNumber, name: rg.shortName, start: rg.start, end: rg.end, source: rg.sourceRef };
    if (seenPv.has(key)) { b.add({ sheet, row_ref: cell, entity_kind: 'leave_record', employee_number: rg.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: 'error', needs_review: true, raw, payload: null, diff: null, message: 'Duplicate PV range in the sheet' }); continue; }
    seenPv.add(key);
    const dup = ex ? (leavesByEmp.get(ex.id) ?? []).find((l) => l.source_kind === 'pv_schedule' && l.start_date === rg.start && l.end_date === rg.end && l.status !== 'cancelled') : undefined;
    b.add({ sheet, row_ref: cell, entity_kind: 'leave_record', employee_number: rg.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: dup ? 'unchanged' : 'new', needs_review: false, raw,
      payload: dup ? null : { absence_type_code: 'annual_leave_planned', status: 'approved', start_date: rg.start, end_date: rg.end, source_kind: 'pv_schedule', source_ref: rg.sourceRef, review_status: 'none' },
      diff: null, message: dup ? 'Already in the leave register' : null });
  }
  // PV records in the database that are no longer in the sheet → review, never delete
  for (const p of people.values()) {
    const ex = byNumber.get(p.employeeNumber); if (!ex) continue;
    for (const l of leavesByEmp.get(ex.id) ?? []) {
      if (l.source_kind !== 'pv_schedule' || l.status === 'cancelled') continue;
      if (!seenPv.has(`${p.employeeNumber}|${l.start_date}|${l.end_date}`)) {
        addPvDays(p.employeeNumber, l.start_date, l.end_date);
        b.add({ sheet: 'PV Scheduled', row_ref: null, entity_kind: 'leave_record', employee_number: p.employeeNumber, matched_employee_id: ex.id, outcome: 'review', needs_review: true, raw: { start: l.start_date, end: l.end_date }, payload: null, diff: null, message: `${p.shortName}: leave ${l.start_date} → ${l.end_date} is in the register but not on this PV sheet. Left unchanged; review.` });
      }
    }
  }

  // Monthly grid runs: merge runs that continue across month sheets, then compare with the PV plan by calendar date.
  // Covered by PV (plus roster Off days directly after the block) → nothing new; otherwise an unresolved absence.
  const mergedRuns = mergeGridRuns(parsed.gridRuns);
  let covered = 0;
  const seenGrid = new Set<string>();
  for (const run of mergedRuns) {
    const ex = byNumber.get(run.employeeNumber) ?? null;
    const pvDays = pvDaysByEmp.get(run.employeeNumber) ?? new Set<string>();
    const uncovered = eachDay(run.start, run.end).filter((d) => !pvDays.has(d));
    if (uncovered.length === 0) { covered++; continue; }
    // group uncovered days into contiguous runs
    const groups: string[][] = [];
    for (const d of uncovered) { const g = groups[groups.length - 1]; if (g && addDays(g[g.length - 1], 1) === d) g.push(d); else groups.push([d]); }
    for (const g of groups) {
      const start = g[0], end = g[g.length - 1];
      const key = `${run.employeeNumber}|${start}|${end}`;
      if (seenGrid.has(key)) continue; seenGrid.add(key);
      const dup = ex ? (leavesByEmp.get(ex.id) ?? []).find((l) => l.source_kind === 'monthly_grid' && l.start_date === start && l.end_date === end) : undefined;
      b.add({ sheet: sheetOf(run.sourceRef), row_ref: cellOf(run.sourceRef), entity_kind: 'leave_record', employee_number: run.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: dup ? 'unchanged' : 'review', needs_review: !dup,
        raw: { employee_number: run.employeeNumber, name: run.shortName, block: run.block, start, end, source: run.sourceRef },
        payload: dup ? null : { absence_type_code: null, status: 'unresolved', start_date: start, end_date: end, source_kind: 'monthly_grid', source_ref: run.sourceRef, review_status: 'pending_review', note: 'Absent on the monthly sheet but not in the PV plan; type not provable from source. Classify manually.' },
        diff: null, message: dup ? 'Unresolved absence already recorded' : `${run.shortName}: absent ${start} → ${end} on ${sheetOf(run.sourceRef)} — not in PV plan, type unknown` });
    }
  }
  if (covered) b.add({ sheet: null, row_ref: null, entity_kind: 'note', employee_number: null, matched_employee_id: null, outcome: 'unchanged', needs_review: false, raw: { covered }, payload: null, diff: null, message: `${covered} monthly-grid absence runs match the PV plan (including roster Off days directly after a block) and add nothing new.` });

  const dates = parsed.pvRanges.flatMap((r) => [r.start, r.end]).concat(parsed.gridRuns.flatMap((r) => [r.start, r.end])).sort();
  return {
    importType: 'u12_manpower_workbook', fileName, sourceAsOfDate: null,
    periodStart: dates[0] ?? `${parsed.year}-01-01`, periodEnd: dates[dates.length - 1] ?? `${parsed.year}-12-31`,
    rows: b.rows, summary: summarize(b.rows), warnings
  };
}

// ------------------------------------------------------------------ promotion master

const MASTER_FIELDS: { key: keyof ExistingEmployee; from: (r: ParsedPromotionMaster['records'][number]) => unknown }[] = [
  { key: 'full_name', from: (r) => r.fullName },
  { key: 'grade', from: (r) => r.grade },
  { key: 'master_position', from: (r) => r.position },
  { key: 'cost_center', from: (r) => r.costCenter },
  { key: 'join_date', from: (r) => r.joinDate },
  { key: 'normalization_date', from: (r) => r.normalizationDate },
  { key: 'last_promotion_date', from: (r) => r.lastPromotion },
  { key: 'position_start_date', from: (r) => r.positionStart },
  { key: 'education', from: (r) => r.education },
  { key: 'service_years', from: (r) => r.serviceYears },
  { key: 'years_in_grade', from: (r) => r.yearsInGrade }
];

function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
}

export function planPromotionImport(parsed: ParsedPromotionMaster, existing: ExistingEmployee[], fileName: string): ImportPlan {
  const b = new RowBuilder();
  const warnings = [...parsed.warnings];
  const byNumber = new Map(existing.map((e) => [e.employee_number, e]));
  const asOf = parsed.asOfDate ?? new Date().toISOString().slice(0, 10);
  const curYear = Number(asOf.slice(0, 4));
  const seen = new Set<string>();
  for (const rec of parsed.records) {
    const sheet = sheetOf(rec.sourceRef); const cell = cellOf(rec.sourceRef);
    const raw: Record<string, unknown> = { ...rec };
    if (seen.has(rec.employeeNumber)) { b.add({ sheet, row_ref: cell, entity_kind: 'employee', employee_number: rec.employeeNumber, matched_employee_id: null, outcome: 'error', needs_review: true, raw, payload: null, diff: null, message: `Employee number ${rec.employeeNumber} appears more than once in the master file` }); continue; }
    seen.add(rec.employeeNumber);
    const ex = byNumber.get(rec.employeeNumber);
    if (!ex || !ex.in_unit12_scope) {
      b.add({ sheet, row_ref: cell, entity_kind: 'employee', employee_number: rec.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: 'ignored_out_of_scope', needs_review: false, raw, payload: null, diff: null, message: `${rec.fullName} (grade ${rec.grade ?? '?'}, ${rec.position ?? ''}) is not in the Unit-12 Section 1 population; ignored` });
      continue;
    }
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    const payload: Record<string, unknown> = {};
    for (const f of MASTER_FIELDS) {
      const to = f.from(rec); const from = ex[f.key];
      if (!sameValue(from, to)) { diff[f.key] = { from, to }; payload[f.key] = to; }
    }
    if (ex.employment_type !== 'knpc' || ex.employment_type_source !== 'confirmed') {
      diff.employment_type = { from: `${ex.employment_type} (${ex.employment_type_source})`, to: 'knpc (confirmed: present in KNPC promotion master)' };
      payload.employment_type = 'knpc'; payload.employment_type_source = 'confirmed';
    }
    const changed = Object.keys(payload).length > 0;
    b.add({ sheet, row_ref: cell, entity_kind: 'employee', employee_number: rec.employeeNumber, matched_employee_id: ex.id, outcome: changed ? 'changed' : 'unchanged', needs_review: false, raw, payload: changed ? payload : null, diff: changed ? diff : null,
      message: changed ? `Matched; ${Object.keys(diff).length} field(s) change` : 'Matched; no change' });
    if (ex.short_name && ex.full_name === ex.short_name && rec.fullName) { /* full name now comes from master via payload.full_name */ }
    // performance and sick totals: current and previous year
    const years: [number, 'cur' | 'prev'][] = [[curYear, 'cur'], [curYear - 1, 'prev']];
    for (const [year, which] of years) {
      const perf = which === 'cur' ? rec.perfCurYear : rec.perfPrevYear;
      const inc = which === 'cur' ? rec.incrementCurYear : rec.incrementPrevYear;
      if (perf !== null || inc !== null) {
        b.add({ sheet, row_ref: cell, entity_kind: 'performance', employee_number: rec.employeeNumber, matched_employee_id: ex.id, outcome: 'new', needs_review: false, raw: { year, perf, inc },
          payload: { year, perf_level: perf, increment_pct: inc, warnings: which === 'cur' ? rec.warnings : null, appreciation_letters: which === 'cur' ? rec.appreciationLetters : null, screening_eligibility: which === 'cur' ? rec.eligibleForScreening : null, reported_as_of: asOf },
          diff: null, message: `Performance ${year}: level ${perf ?? '-'} (replaces any earlier value for ${year})` });
      }
      const sick = which === 'cur' ? rec.sickCurYear : rec.sickPrevYear;
      if (sick !== null) {
        b.add({ sheet, row_ref: cell, entity_kind: 'sick_total', employee_number: rec.employeeNumber, matched_employee_id: ex.id, outcome: 'new', needs_review: false, raw: { year, sick },
          payload: { year, days: sick, reported_as_of: asOf }, diff: null, message: `Sick leave ${year}: ${sick} days as of ${asOf} (replaces, never adds)` });
      }
    }
  }
  // scope employees missing from the master (KNPC only)
  for (const ex of existing) {
    if (!ex.in_unit12_scope || seen.has(ex.employee_number)) continue;
    if (ex.employment_type === 'contractor') continue;
    b.add({ sheet: null, row_ref: null, entity_kind: 'note', employee_number: ex.employee_number, matched_employee_id: ex.id, outcome: 'unmatched', needs_review: true, raw: null, payload: null, diff: null, message: `${ex.short_name ?? ex.full_name} (${ex.employee_number}) is in Unit-12 scope as KNPC but is not in this promotion master` });
  }
  return { importType: 'promotion_master', fileName, sourceAsOfDate: parsed.asOfDate, periodStart: null, periodEnd: null, rows: b.rows, summary: summarize(b.rows), warnings };
}
