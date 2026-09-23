import { addDays, eachDay } from './sheet';
import { displayNameFor } from '../names';
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
  return { read: 0, employeesNew: 0, employeesChanged: 0, employeesUnchanged: 0, unmatched: 0, ignored: 0, review: 0, errors: 0, leaveNew: 0, leaveChanged: 0, leaveUnchanged: 0, pvAdded: 0, pvRescheduled: 0, pvCancelled: 0, unresolvedNew: 0, qualificationsNew: 0, roleAssignmentsNew: 0 };
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
      const kind = (r.payload as { change_kind?: string } | null)?.change_kind;
      if (r.outcome === 'new' || r.outcome === 'review') {
        if (r.payload) { s.leaveNew++; if (kind === 'added' || kind === 'baseline_added') s.pvAdded++; if ((r.payload as { status?: string }).status === 'unresolved') s.unresolvedNew++; }
      } else if (r.outcome === 'changed') {
        s.leaveChanged++; if (kind === 'rescheduled') s.pvRescheduled++; if (kind === 'cancelled') s.pvCancelled++;
      } else if (r.outcome === 'unchanged') s.leaveUnchanged++;
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
  const label = (emp: string, fallback: string) => byNumber.get(emp)?.display_name || fallback;
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
        b.add({ sheet: sheetOf(g.sourceRef), row_ref: cellOf(g.sourceRef), entity_kind: 'note', employee_number: key, matched_employee_id: byNumber.get(key)?.id ?? null, outcome: 'review', needs_review: true, raw: { pvCrew: existingP.crew, gridCrew: g.crew }, payload: null, diff: null, message: `${label(key, g.shortName)}: PV sheet says crew ${existingP.crew} but ${sheetOf(g.sourceRef)} lists them under ${g.crew} Shift` });
      }
      if (g.role !== existingP.role && !(existingP.role.endsWith('controller') && g.role === 'controller') && !gridSeen.has(key + g.role)) {
        gridSeen.add(key + g.role);
        b.add({ sheet: sheetOf(g.sourceRef), row_ref: cellOf(g.sourceRef), entity_kind: 'note', employee_number: key, matched_employee_id: byNumber.get(key)?.id ?? null, outcome: 'review', needs_review: true, raw: { pvRole: existingP.role, gridRole: g.role }, payload: null, diff: null, message: `${label(key, g.shortName)}: PV sheet role ${ROLE_LABEL[existingP.role]} differs from block "${g.role}" on ${sheetOf(g.sourceRef)}` });
      }
    } else if (!gridSeen.has(key)) {
      gridSeen.add(key);
      people.set(key, { ...g });
      warnings.push(`${g.shortName} (${key}) is on the monthly grid but not on the PV sheet; crew taken from the grid block.`);
    }
  }

  const yearStart = `${parsed.year}-01-01`;
  // Employees currently in scope but absent from this workbook: never removed automatically, flagged for review.
  const inWorkbook = new Set(people.keys());
  for (const ex of existing) {
    if (!ex.in_unit12_scope || inWorkbook.has(ex.employee_number)) continue;
    b.add({ sheet: null, row_ref: null, entity_kind: 'note', employee_number: ex.employee_number, matched_employee_id: ex.id, outcome: 'review', needs_review: true, raw: { name: ex.short_name ?? ex.official_name },
      payload: null, diff: null, message: `${ex.short_name ?? ex.official_name} (${ex.employee_number}) is in Unit-12 scope but does not appear in this workbook. Left unchanged; decide whether they have left the section.` });
  }
  for (const p of people.values()) {
    const ex = byNumber.get(p.employeeNumber) ?? null;
    const sheet = sheetOf(p.sourceRef); const cell = cellOf(p.sourceRef);
    const raw = { employee_number: p.employeeNumber, name: p.shortName, role: p.role, crew: p.crew, source: p.sourceRef };
    if (!ex) {
      const employment = inferEmploymentType(p.employeeNumber);
      b.add({ sheet, row_ref: cell, entity_kind: 'employee', employee_number: p.employeeNumber, matched_employee_id: null, outcome: 'new', needs_review: false, raw, diff: null,
        payload: { employee_number: p.employeeNumber, short_name: p.shortName, official_name: p.shortName, display_name: p.shortName, employment_type: employment, employment_type_source: 'inferred', in_unit12_scope: true, section_code: 'A4-S1-U12', notes: `Created from ${p.sourceRef}` },
        message: `New ${ROLE_LABEL[p.role]}${p.crew ? ` (${p.crew} Shift)` : ''}; employment type ${employment} inferred from the ${p.employeeNumber.length}-digit number` });
    } else {
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      if (!ex.short_name || ex.short_name !== p.shortName) diff.short_name = { from: ex.short_name, to: p.shortName };
      const display = displayNameFor({ officialName: ex.official_name, shortName: p.shortName, employmentType: ex.employment_type, employmentTypeSource: ex.employment_type_source });
      if (display && display !== (ex.display_name ?? '')) diff.display_name = { from: ex.display_name, to: display };
      if (!ex.in_unit12_scope) diff.in_unit12_scope = { from: false, to: true };
      const changed = Object.keys(diff).length > 0;
      b.add({ sheet, row_ref: cell, entity_kind: 'employee', employee_number: p.employeeNumber, matched_employee_id: ex.id, outcome: changed ? 'changed' : 'unchanged', needs_review: false, raw,
        payload: changed ? Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.to])) : null, diff: changed ? diff : null, message: changed ? `Matched by employee number; ${Object.keys(diff).join(', ').replace(/_/g, ' ')} updated` : 'Matched by employee number; no change' });
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

  // ------------------------------------------------------------ leave plans
  // "PV Scheduled" = ORIGINAL plan (baseline, historical). "PV Scheduled Updated" = CURRENT approved plan.
  // The baseline recorded in the register is never rewritten from a later workbook: differences are flagged.
  // The current plan follows the updated sheet: a block that moved is a reschedule (original kept in history,
  // linked to the new dates), a block that vanished is cancelled, a block that appeared is added.
  const crewOf = new Map<string, Crew | null>();
  for (const p of people.values()) crewOf.set(p.employeeNumber, p.crew);
  const days = (a: string, b: string) => eachDay(a, b).length;
  const rk = (start: string, end: string) => `${start}|${end}`;
  const lref = (l: ExistingLeave) => `${l.start_date} → ${l.end_date}`;
  const remarksByEmp = new Map<string, string[]>();
  for (const m of parsed.gridRemarks) { if (!/resched|cancel/i.test(m.text)) continue; const arr = remarksByEmp.get(m.employeeNumber) ?? []; arr.push(`${m.sheet}!${m.cell}${m.date ? ` (${m.date})` : ''}: "${m.text.trim()}"`); remarksByEmp.set(m.employeeNumber, arr); }
  const origByEmp = new Map<string, typeof parsed.pvRanges>(); const curByEmp = new Map<string, typeof parsed.pvRanges>();
  const dupCheck = (list: typeof parsed.pvRanges, into: Map<string, typeof parsed.pvRanges>, label: string) => {
    const seen = new Set<string>();
    for (const rg of list) {
      const key = `${rg.employeeNumber}|${rg.start}|${rg.end}`;
      if (seen.has(key)) { b.add({ sheet: sheetOf(rg.sourceRef), row_ref: cellOf(rg.sourceRef), entity_kind: 'leave_record', employee_number: rg.employeeNumber, matched_employee_id: byNumber.get(rg.employeeNumber)?.id ?? null, outcome: 'error', needs_review: true, raw: { start: rg.start, end: rg.end }, payload: null, diff: null, message: `Duplicate range on the ${label} sheet` }); continue; }
      seen.add(key);
      const arr = into.get(rg.employeeNumber) ?? []; arr.push(rg); into.set(rg.employeeNumber, arr);
    }
  };
  dupCheck(parsed.pvRanges, origByEmp, 'original PV'); dupCheck(parsed.pvCurrentRanges, curByEmp, 'updated PV');
  const hasUpdatedSheet = parsed.pvCurrentSheet !== null;

  // Days covered by the CURRENT plan (plus the roster Off days directly after each block), and by absences
  // someone has already classified. A monthly-sheet mark on one of these days needs no new record.
  const coveredDays = new Map<string, Set<string>>();
  const cover = (emp: string, start: string, end: string, walkOff: boolean) => {
    const set = coveredDays.get(emp) ?? new Set<string>();
    for (const d of eachDay(start, end)) set.add(d);
    const crew = crewOf.get(emp) ?? null;
    if (walkOff && crew) { let d = addDays(end, 1); while (isOff(d, crew)) { set.add(d); d = addDays(d, 1); } }
    coveredDays.set(emp, set);
  };

  for (const p of people.values()) {
    const emp = p.employeeNumber; const ex = byNumber.get(emp) ?? null;
    const dbLeaves = ex ? (leavesByEmp.get(ex.id) ?? []) : [];
    const dbOrig = dbLeaves.filter((l) => l.source_kind === 'pv_schedule' && l.in_original_plan);
    const dbCur = dbLeaves.filter((l) => l.source_kind === 'pv_schedule' && (l.in_current_plan ?? true) && l.status !== 'cancelled' && l.status !== 'rescheduled');
    const sheetOrig = origByEmp.get(emp) ?? []; const sheetCur = curByEmp.get(emp) ?? [];
    const origKeys = new Set(sheetOrig.map((r) => rk(r.start, r.end)));
    const dbOrigKeys = new Set(dbOrig.map((l) => rk(l.start_date, l.end_date)));
    const dbCurKeys = new Map(dbCur.map((l) => [rk(l.start_date, l.end_date), l]));
    const evidence = remarksByEmp.get(emp)?.join('; ') ?? null;
    for (const r of sheetCur) cover(emp, r.start, r.end, true);

    // A. original sheet vs recorded baseline (flag only; baseline is history)
    const bothSheetsNew = new Set<string>();
    for (const rg of sheetOrig) {
      const key = rk(rg.start, rg.end);
      if (dbOrigKeys.has(key)) continue;
      const alsoCurrent = sheetCur.some((c) => rk(c.start, c.end) === key);
      if (alsoCurrent && !dbCurKeys.has(key)) { if (ex) bothSheetsNew.add(key); continue; } // created below as a block of both plans
      if (!ex) {
        // new employee: an original-only block is history from day one (rescheduled when a same-length current-only block exists, else cancelled)
        const curOnly = sheetCur.filter((c) => !origKeys.has(rk(c.start, c.end)));
        const twin = curOnly.find((c) => days(c.start, c.end) === days(rg.start, rg.end) || (c.start <= rg.end && c.end >= rg.start));
        b.add({ sheet: sheetOf(rg.sourceRef), row_ref: cellOf(rg.sourceRef), entity_kind: 'leave_record', employee_number: emp, matched_employee_id: null, outcome: 'new', needs_review: false, raw: { employee_number: emp, name: p.shortName, start: rg.start, end: rg.end, source: rg.sourceRef, plan: 'original' },
          payload: { absence_type_code: 'annual_leave_planned', status: twin ? 'rescheduled' : 'cancelled', start_date: rg.start, end_date: rg.end, source_kind: 'pv_schedule', source_ref: rg.sourceRef, review_status: 'none', in_original_plan: true, in_current_plan: false, note: twin ? `Original plan block; current plan shows ${twin.start} → ${twin.end} instead` : 'Original plan block; not on the current plan sheet' },
          diff: null, message: `${label(p.employeeNumber, p.shortName)}: original plan ${rg.start} → ${rg.end} (${twin ? `rescheduled to ${twin.start} → ${twin.end}` : 'not on the current plan'}); history only` });
        continue;
      }
      b.add({ sheet: sheetOf(rg.sourceRef), row_ref: cellOf(rg.sourceRef), entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex.id, outcome: 'review', needs_review: true, raw: { start: rg.start, end: rg.end, plan: 'original' }, payload: null, diff: null,
        message: `${label(p.employeeNumber, p.shortName)}: the original PV sheet now shows ${rg.start} → ${rg.end}, which is not in the recorded baseline. Baseline kept unchanged (source changed between workbook versions); review.` });
    }
    for (const l of dbOrig) {
      if (origKeys.has(rk(l.start_date, l.end_date)) || !hasUpdatedSheet && sheetOrig.length === 0) continue;
      if (!origKeys.has(rk(l.start_date, l.end_date))) b.add({ sheet: parsed.pvOriginalSheet, row_ref: null, entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex!.id, outcome: 'review', needs_review: true, raw: { start: l.start_date, end: l.end_date, plan: 'original' }, payload: null, diff: null,
        message: `${label(p.employeeNumber, p.shortName)}: baseline block ${lref(l)} is no longer on the original PV sheet. Baseline kept unchanged (source changed between workbook versions); review.` });
    }

    // B. current plan vs updated sheet
    const remainingSheet: typeof sheetCur = []; const usedDb = new Set<ExistingLeave>();
    for (const rg of sheetCur) {
      const key = rk(rg.start, rg.end); const sheet = sheetOf(rg.sourceRef); const cell = cellOf(rg.sourceRef);
      const raw = { employee_number: emp, name: p.shortName, start: rg.start, end: rg.end, source: rg.sourceRef, plan: 'current' };
      const same = dbCurKeys.get(key);
      if (same) { usedDb.add(same); b.add({ sheet, row_ref: cell, entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex?.id ?? null, outcome: 'unchanged', needs_review: false, raw, payload: null, diff: null, message: 'Already in the current plan' }); continue; }
      if (!ex || bothSheetsNew.has(key) || (!hasUpdatedSheet)) {
        const inOriginal = origKeys.has(key);
        const kind = !ex ? undefined : inOriginal ? 'baseline_added' : 'added';
        b.add({ sheet, row_ref: cell, entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex?.id ?? null, outcome: 'new', needs_review: kind === 'baseline_added', raw,
          payload: { absence_type_code: 'annual_leave_planned', status: 'approved', start_date: rg.start, end_date: rg.end, source_kind: 'pv_schedule', source_ref: rg.sourceRef, review_status: 'none', in_original_plan: inOriginal, in_current_plan: true, ...(kind ? { change_kind: kind, change_note: kind === 'baseline_added' ? 'On both PV sheets but not in the recorded baseline; source changed between workbook versions' : 'Added to the current plan', evidence } : {}) },
          diff: null, message: kind === 'baseline_added' ? `${label(p.employeeNumber, p.shortName)}: ${rg.start} → ${rg.end} is on both PV sheets but was not in the recorded baseline; added to both plans` : `Planned leave ${rg.start} → ${rg.end}${inOriginal ? ' (original and current plan)' : ' (current plan)'}` });
        continue;
      }
      remainingSheet.push(rg);
    }
    const remainingDb = dbCur.filter((l) => !usedDb.has(l));
    // pair by overlap first (dates adjusted), then by equal length (moved), in date order
    const pairs: { rg: (typeof sheetCur)[number]; l: ExistingLeave; how: 'dates adjusted' | 'moved' }[] = [];
    const takeDb = new Set<ExistingLeave>(); const takeSheet = new Set<(typeof sheetCur)[number]>();
    for (const rg of remainingSheet) {
      const l = remainingDb.find((x) => !takeDb.has(x) && x.start_date <= rg.end && x.end_date >= rg.start);
      if (l) { pairs.push({ rg, l, how: 'dates adjusted' }); takeDb.add(l); takeSheet.add(rg); }
    }
    for (const rg of remainingSheet) {
      if (takeSheet.has(rg)) continue;
      const len = days(rg.start, rg.end);
      const l = remainingDb.filter((x) => !takeDb.has(x) && days(x.start_date, x.end_date) === len).sort((a, c) => Math.abs(days(a.start_date, rg.start)) - Math.abs(days(c.start_date, rg.start)))[0];
      if (l) { pairs.push({ rg, l, how: 'moved' }); takeDb.add(l); takeSheet.add(rg); }
    }
    for (const { rg, l, how } of pairs) {
      b.add({ sheet: sheetOf(rg.sourceRef), row_ref: cellOf(rg.sourceRef), entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex!.id, outcome: 'changed', needs_review: true,
        raw: { employee_number: emp, name: p.shortName, start: rg.start, end: rg.end, source: rg.sourceRef, plan: 'current', original: lref(l) },
        payload: { rescheduled_from_id: l.id, change_kind: 'rescheduled', start_date: rg.start, end_date: rg.end, status: 'approved', source_ref: rg.sourceRef, note: `Rescheduled from ${lref(l)} (${how})`, change_note: `Rescheduled (${how}); same employee, ${how === 'moved' ? `same length ${days(rg.start, rg.end)} days` : 'overlapping dates'}`, evidence },
        diff: { dates: { from: lref(l), to: `${rg.start} → ${rg.end}` } },
        message: `${label(p.employeeNumber, p.shortName)}: leave ${lref(l)} rescheduled to ${rg.start} → ${rg.end} (${how}). Original kept in history and no longer reduces manpower.${evidence ? ` Evidence: ${evidence}` : ''}` });
    }
    for (const rg of remainingSheet) {
      if (takeSheet.has(rg)) continue;
      b.add({ sheet: sheetOf(rg.sourceRef), row_ref: cellOf(rg.sourceRef), entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex!.id, outcome: 'new', needs_review: false,
        raw: { employee_number: emp, name: p.shortName, start: rg.start, end: rg.end, source: rg.sourceRef, plan: 'current' },
        payload: { absence_type_code: 'annual_leave_planned', status: 'approved', start_date: rg.start, end_date: rg.end, source_kind: 'pv_schedule', source_ref: rg.sourceRef, review_status: 'none', in_original_plan: false, in_current_plan: true, change_kind: 'added', change_note: 'Added to the current plan', evidence },
        diff: null, message: `${label(p.employeeNumber, p.shortName)}: ${rg.start} → ${rg.end} added to the current plan` });
    }
    for (const l of remainingDb) {
      if (takeDb.has(l)) continue;
      b.add({ sheet: parsed.pvCurrentSheet ?? parsed.pvOriginalSheet, row_ref: null, entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex!.id, outcome: 'changed', needs_review: true,
        raw: { employee_number: emp, name: p.shortName, start: l.start_date, end: l.end_date, plan: 'current' },
        payload: { leave_record_id: l.id, change_kind: 'cancelled', change_note: 'No longer on the current approved plan sheet', evidence },
        diff: { status: { from: l.status, to: 'cancelled' } },
        message: `${label(p.employeeNumber, p.shortName)}: leave ${lref(l)} is not on the current plan sheet and pairs with nothing; cancelled (kept in history).` });
    }
    // absences already classified by a person count as explained
    for (const l of dbLeaves) if (l.source_kind !== 'pv_schedule' && l.absence_type_code && (l.status === 'approved' || l.status === 'planned') && (l.in_current_plan ?? true)) cover(emp, l.start_date, l.end_date, false);
  }

  // Monthly grid runs: merge runs that continue across month sheets, then compare with the CURRENT plan by
  // calendar date. Covered → nothing new; otherwise an unresolved absence. An unresolved record already in the
  // register is matched by exact dates first, then by overlap: an import-owned record (still unresolved, pending
  // review, no type) follows the source's new dates; a record someone has classified is never touched.
  const mergedRuns = mergeGridRuns(parsed.gridRuns);
  let covered = 0;
  const seenGrid = new Set<string>();
  const usedExisting = new Set<ExistingLeave>();
  const importOwned = (l: ExistingLeave) => l.status === 'unresolved' && (l.review_status ?? 'pending_review') === 'pending_review' && !l.absence_type_code;
  for (const run of mergedRuns) {
    const ex = byNumber.get(run.employeeNumber) ?? null;
    const pvDays = coveredDays.get(run.employeeNumber) ?? new Set<string>();
    const uncovered = eachDay(run.start, run.end).filter((d) => !pvDays.has(d));
    if (uncovered.length === 0) { covered++; continue; }
    const groups: string[][] = [];
    for (const d of uncovered) { const g = groups[groups.length - 1]; if (g && addDays(g[g.length - 1], 1) === d) g.push(d); else groups.push([d]); }
    for (const g of groups) {
      const start = g[0], end = g[g.length - 1];
      const key = `${run.employeeNumber}|${start}|${end}`;
      if (seenGrid.has(key)) continue; seenGrid.add(key);
      const gridRecs = ex ? (leavesByEmp.get(ex.id) ?? []).filter((l) => l.source_kind === 'monthly_grid' && l.status !== 'cancelled' && !usedExisting.has(l)) : [];
      const raw = { employee_number: run.employeeNumber, name: run.shortName, block: run.block, start, end, source: run.sourceRef };
      const dup = gridRecs.find((l) => l.start_date === start && l.end_date === end);
      if (dup) {
        usedExisting.add(dup);
        b.add({ sheet: sheetOf(run.sourceRef), row_ref: cellOf(run.sourceRef), entity_kind: 'leave_record', employee_number: run.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: 'unchanged', needs_review: false, raw, payload: null, diff: null, message: 'Unresolved absence already recorded' });
        continue;
      }
      const overlap = gridRecs.find((l) => l.start_date <= end && l.end_date >= start);
      if (overlap) {
        usedExisting.add(overlap);
        const diff = { dates: { from: lref(overlap), to: `${start} → ${end}` } };
        if (importOwned(overlap) && overlap.id) {
          b.add({ sheet: sheetOf(run.sourceRef), row_ref: cellOf(run.sourceRef), entity_kind: 'leave_record', employee_number: run.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: 'changed', needs_review: true, raw,
            payload: { leave_record_id: overlap.id, change_kind: 'dates_moved', start_date: start, end_date: end, source_ref: run.sourceRef, note: `Dates follow the monthly sheet; previously ${lref(overlap)}. Type still not provable from source; classify manually.`, change_note: 'Source data changed between workbook versions' },
            diff, message: `${label(run.employeeNumber, run.shortName)}: unresolved absence ${lref(overlap)} now marked ${start} → ${end} on ${sheetOf(run.sourceRef)}; dates updated, still unclassified (source data changed between workbook versions)` });
        } else {
          b.add({ sheet: sheetOf(run.sourceRef), row_ref: cellOf(run.sourceRef), entity_kind: 'leave_record', employee_number: run.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: 'review', needs_review: true, raw, payload: null,
            diff, message: `${label(run.employeeNumber, run.shortName)}: the sheet marks ${start} → ${end} but the register holds a classified record ${lref(overlap)} (${overlap.absence_type_code ?? overlap.status}). Left unchanged; review.` });
        }
        continue;
      }
      b.add({ sheet: sheetOf(run.sourceRef), row_ref: cellOf(run.sourceRef), entity_kind: 'leave_record', employee_number: run.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: 'review', needs_review: true, raw,
        payload: { absence_type_code: null, status: 'unresolved', start_date: start, end_date: end, source_kind: 'monthly_grid', source_ref: run.sourceRef, review_status: 'pending_review', in_original_plan: false, in_current_plan: true, note: 'Absent on the monthly sheet but not in the current approved plan; type not provable from source. Classify manually.' },
        diff: null, message: `${label(run.employeeNumber, run.shortName)}: absent ${start} → ${end} on ${sheetOf(run.sourceRef)} — not in the current plan, type unknown` });
    }
  }
  // Grid-sourced records in the register that this workbook no longer produces → review, never delete.
  const markedDays = new Map<string, Set<string>>();
  for (const run of mergedRuns) { const set = markedDays.get(run.employeeNumber) ?? new Set<string>(); for (const d of eachDay(run.start, run.end)) set.add(d); markedDays.set(run.employeeNumber, set); }
  for (const p of people.values()) {
    const ex = byNumber.get(p.employeeNumber); if (!ex) continue;
    const pvDays = coveredDays.get(p.employeeNumber) ?? new Set<string>();
    const marked = markedDays.get(p.employeeNumber) ?? new Set<string>();
    for (const l of leavesByEmp.get(ex.id) ?? []) {
      if (l.source_kind !== 'monthly_grid' || l.status === 'cancelled' || usedExisting.has(l)) continue;
      const stillMarked = eachDay(l.start_date, l.end_date).every((d) => marked.has(d));
      if (stillMarked && l.absence_type_code) { // a classified absence the sheet still shows: nothing to do
        b.add({ sheet: null, row_ref: null, entity_kind: 'leave_record', employee_number: p.employeeNumber, matched_employee_id: ex.id, outcome: 'unchanged', needs_review: false, raw: { start: l.start_date, end: l.end_date }, payload: null, diff: null, message: `${label(p.employeeNumber, p.shortName)}: classified absence ${lref(l)} (${l.absence_type_code}) still marked on the monthly sheets; unchanged` });
        continue;
      }
      const explained = eachDay(l.start_date, l.end_date).every((d) => pvDays.has(d));
      b.add({ sheet: null, row_ref: null, entity_kind: 'leave_record', employee_number: p.employeeNumber, matched_employee_id: ex.id, outcome: 'review', needs_review: true, raw: { start: l.start_date, end: l.end_date, explained_by_current_plan: explained }, payload: null, diff: null,
        message: explained
          ? `${label(p.employeeNumber, p.shortName)}: ${l.absence_type_code ? 'absence' : 'unresolved absence'} ${lref(l)} is now explained by the current approved plan. Left unchanged; resolve it manually.`
          : `${label(p.employeeNumber, p.shortName)}: ${l.absence_type_code ? 'absence' : 'unresolved absence'} ${lref(l)} is in the register but no longer marked on the monthly sheets. Left unchanged; review.` });
    }
  }
  if (covered) b.add({ sheet: null, row_ref: null, entity_kind: 'note', employee_number: null, matched_employee_id: null, outcome: 'unchanged', needs_review: false, raw: { covered }, payload: null, diff: null, message: `${covered} monthly-grid absence runs match the current approved plan (including roster Off days directly after a block) or an already classified absence, and add nothing new.` });

  const dates = parsed.pvRanges.concat(parsed.pvCurrentRanges).flatMap((r) => [r.start, r.end]).concat(parsed.gridRuns.flatMap((r) => [r.start, r.end])).sort();
  return {
    importType: 'u12_manpower_workbook', fileName, sourceAsOfDate: null,
    periodStart: dates[0] ?? `${parsed.year}-01-01`, periodEnd: dates[dates.length - 1] ?? `${parsed.year}-12-31`,
    rows: b.rows, summary: summarize(b.rows), warnings
  };
}

// ------------------------------------------------------------------ promotion master

const MASTER_FIELDS: { key: keyof ExistingEmployee; from: (r: ParsedPromotionMaster['records'][number]) => unknown }[] = [
  { key: 'official_name', from: (r) => r.fullName },
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
    const display = displayNameFor({ officialName: rec.fullName || ex.official_name, shortName: ex.short_name, employmentType: 'knpc', employmentTypeSource: 'confirmed' });
    if (display && display !== (ex.display_name ?? '')) { diff.display_name = { from: ex.display_name, to: display }; payload.display_name = display; }
    const changed = Object.keys(payload).length > 0;
    b.add({ sheet, row_ref: cell, entity_kind: 'employee', employee_number: rec.employeeNumber, matched_employee_id: ex.id, outcome: changed ? 'changed' : 'unchanged', needs_review: false, raw, payload: changed ? payload : null, diff: changed ? diff : null,
      message: changed ? `Matched; ${Object.keys(diff).length} field(s) change` : 'Matched; no change' });
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
    b.add({ sheet: null, row_ref: null, entity_kind: 'note', employee_number: ex.employee_number, matched_employee_id: ex.id, outcome: 'unmatched', needs_review: true, raw: null, payload: null, diff: null, message: `${ex.short_name ?? ex.official_name} (${ex.employee_number}) is in Unit-12 scope as KNPC but is not in this promotion master` });
  }
  return { importType: 'promotion_master', fileName, sourceAsOfDate: parsed.asOfDate, periodStart: null, periodEnd: null, rows: b.rows, summary: summarize(b.rows), warnings };
}
