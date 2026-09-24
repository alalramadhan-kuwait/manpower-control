import { addDays, eachDay } from './sheet';
import { colourMeaning, majorityFill } from './colourKey';
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
  return { read: 0, employeesNew: 0, employeesChanged: 0, employeesUnchanged: 0, unmatched: 0, ignored: 0, review: 0, errors: 0, leaveNew: 0, leaveChanged: 0, leaveUnchanged: 0, pvAdded: 0, pvRescheduled: 0, pvCancelled: 0, pvNotTaken: 0, unresolvedNew: 0, qualificationsNew: 0, roleAssignmentsNew: 0 };
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
        s.leaveChanged++; if (kind === 'rescheduled') s.pvRescheduled++; if (kind === 'cancelled') s.pvCancelled++; if (kind === 'not_taken') s.pvNotTaken++;
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
      last.fills = { ...(last.fills ?? {}), ...(r.fills ?? {}) };
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
    if (cur && !same && cur.source === 'manual') {
      // set by hand (profile correction or Section Head decision): the workbook never replaces it
      b.add({ sheet, row_ref: cell, entity_kind: 'role_assignment', employee_number: p.employeeNumber, matched_employee_id: ex!.id, outcome: 'review', needs_review: true, raw, payload: null,
        diff: { role: { from: `${cur.position_code}/${cur.crew_code ?? '-'}`, to: `${p.role}/${p.crew ?? '-'}` } },
        message: `Workbook lists ${ROLE_LABEL[p.role]}${p.crew ? `, ${p.crew} Shift` : ''}; kept the role set by hand (${ROLE_LABEL[cur.position_code as RoleCode] ?? cur.position_code}${cur.crew_code ? `, ${cur.crew_code} Shift` : ''}${cur.effective_from ? ` since ${cur.effective_from}` : ''})` });
    } else b.add({ sheet, row_ref: cell, entity_kind: 'role_assignment', employee_number: p.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: same ? 'unchanged' : (cur ? 'changed' : 'new'), needs_review: false, raw,
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

  // ------------------------------------------------------------ leave
  // Agreed model (Section Head, 23 Sep 2026):
  // - "PV Scheduled" = ORIGINAL plan (baseline, frozen): differences with the register are flagged, never rewritten.
  // - The MONTHLY SHEETS are the real leave: for every month a person is listed on a monthly sheet, their current
  //   leave is exactly what is marked there (on working days of their crew). A plan block that is not marked is
  //   "not taken" (kept in history, no longer counted), a partly marked block keeps only its marked days, and a
  //   marked period with no record becomes approved leave typed from the sheet colour. No unresolved absences are
  //   created from the sheets.
  // - "PV Scheduled Updated" is used only for months that have no monthly sheet for that person.
  // - Records a person entered or classified by hand (source "manual") are never changed by an import.
  const crewOf = new Map<string, Crew | null>();
  for (const p of people.values()) crewOf.set(p.employeeNumber, p.crew);
  const days = (a: string, b: string) => eachDay(a, b).length;
  const rk = (start: string, end: string) => `${start}|${end}`;
  const lref = (l: ExistingLeave) => `${l.start_date} → ${l.end_date}`;
  const remarksByEmp = new Map<string, string[]>();
  for (const m of parsed.gridRemarks) { if (!/resched|cancel/i.test(m.text)) continue; const arr = remarksByEmp.get(m.employeeNumber) ?? []; arr.push(`${m.sheet}!${m.cell}${m.date ? ` (${m.date})` : ''}: "${m.text.trim()}"`); remarksByEmp.set(m.employeeNumber, arr); }
  const byEmpRanges = (list: typeof parsed.pvRanges, label: string) => {
    const into = new Map<string, typeof parsed.pvRanges>(); const seen = new Set<string>();
    for (const rg of list) {
      const key = `${rg.employeeNumber}|${rg.start}|${rg.end}`;
      if (seen.has(key)) { b.add({ sheet: sheetOf(rg.sourceRef), row_ref: cellOf(rg.sourceRef), entity_kind: 'leave_record', employee_number: rg.employeeNumber, matched_employee_id: byNumber.get(rg.employeeNumber)?.id ?? null, outcome: 'error', needs_review: true, raw: { start: rg.start, end: rg.end }, payload: null, diff: null, message: `Duplicate range on the ${label} sheet` }); continue; }
      seen.add(key); const arr = into.get(rg.employeeNumber) ?? []; arr.push(rg); into.set(rg.employeeNumber, arr);
    }
    return into;
  };
  const origByEmp = byEmpRanges(parsed.pvRanges, 'original PV'); const curByEmp = byEmpRanges(parsed.pvCurrentRanges, 'updated PV');

  // Monthly-sheet evidence per person: which months they are listed on, and each marked day with its colour.
  const monthsOf = new Map<string, Set<string>>();
  for (const g of parsed.gridPeople) if (g.month) { const set = monthsOf.get(g.employeeNumber) ?? new Set<string>(); set.add(g.month); monthsOf.set(g.employeeNumber, set); }
  const marksOf = new Map<string, Map<string, string | null>>();
  const mergedRuns = mergeGridRuns(parsed.gridRuns);
  for (const run of mergedRuns) {
    const m = marksOf.get(run.employeeNumber) ?? new Map<string, string | null>();
    for (const d of eachDay(run.start, run.end)) m.set(d, run.fills?.[d] ?? null);
    marksOf.set(run.employeeNumber, m);
  }
  const counts = (l: ExistingLeave) => (l.status === 'approved' || l.status === 'planned') && (l.in_current_plan ?? true);
  let offOnly = 0; let takenAsMarked = 0;

  for (const p of people.values()) {
    const emp = p.employeeNumber; const ex = byNumber.get(emp) ?? null; const crew = crewOf.get(emp) ?? null;
    const who = label(emp, p.shortName);
    const inScope = (d: string) => monthsOf.get(emp)?.has(d.slice(0, 7)) ?? false;
    const working = (d: string) => (crew ? !isOff(d, crew) : true);
    const marks = marksOf.get(emp) ?? new Map<string, string | null>();
    const isMarked = (d: string) => marks.has(d) && colourMeaning(marks.get(d) ?? null)?.absence !== false;
    const evidence = remarksByEmp.get(emp)?.join('; ') ?? null;
    const dbLeaves = ex ? (leavesByEmp.get(ex.id) ?? []) : [];
    const sheetOrig = origByEmp.get(emp) ?? []; const sheetCur = curByEmp.get(emp) ?? [];
    const origKeys = new Set(sheetOrig.map((r) => rk(r.start, r.end)));

    // A. original plan sheet vs the recorded baseline: flag only, the baseline is history
    if (ex) {
      const dbOrig = dbLeaves.filter((l) => l.source_kind === 'pv_schedule' && l.in_original_plan);
      const dbOrigKeys = new Set(dbOrig.map((l) => rk(l.start_date, l.end_date)));
      for (const rg of sheetOrig) if (!dbOrigKeys.has(rk(rg.start, rg.end))) b.add({ sheet: sheetOf(rg.sourceRef), row_ref: cellOf(rg.sourceRef), entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex.id, outcome: 'review', needs_review: true, raw: { start: rg.start, end: rg.end, plan: 'original' }, payload: null, diff: null,
        message: `${who}: the original PV sheet now shows ${rg.start} → ${rg.end}, which is not in the recorded baseline. Baseline kept unchanged (source changed between workbook versions); review.` });
      if (sheetOrig.length) for (const l of dbOrig) if (!origKeys.has(rk(l.start_date, l.end_date))) b.add({ sheet: parsed.pvOriginalSheet, row_ref: null, entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex.id, outcome: 'review', needs_review: true, raw: { start: l.start_date, end: l.end_date, plan: 'original' }, payload: null, diff: null,
        message: `${who}: baseline block ${lref(l)} is no longer on the original PV sheet. Baseline kept unchanged (source changed between workbook versions); review.` });
    }

    // B. current leave records that the monthly sheets decide (import-owned: PV or monthly-sheet sources, never touched by hand)
    const covered = new Set<string>();          // marked days already accounted for
    const notTaken: ExistingLeave[] = [];
    const byHand = (l: ExistingLeave) => l.source_kind === 'manual' || l.hand_corrected === true;
    const current = dbLeaves.filter((l) => counts(l) && !byHand(l));
    // days entered, corrected or cancelled by hand are the Section Head's decision: never recreated or re-planned
    for (const l of dbLeaves) if ((counts(l) && l.source_kind === 'manual') || l.hand_corrected || l.status === 'unresolved') for (const d of eachDay(l.start_date, l.end_date)) covered.add(d);
    const markedRuns = (from: string, to: string) => {
      const out: { start: string; end: string }[] = [];
      for (const d of eachDay(from, to)) {
        if (!inScope(d) || !isMarked(d)) continue;
        const last = out[out.length - 1];
        if (last && addDays(last.end, 1) === d) last.end = d; else out.push({ start: d, end: d });
      }
      return out.filter((r) => eachDay(r.start, r.end).some(working));
    };
    for (const l of current) {
      const all = eachDay(l.start_date, l.end_date);
      const scoped = all.filter(inScope);
      if (scoped.length === 0) continue;                                  // no monthly sheet for these dates
      const work = scoped.filter(working);
      const markedWork = work.filter(isMarked);
      for (const d of all) if (isMarked(d)) covered.add(d);
      if (scoped.length < all.length && markedWork.length < work.length) {
        b.add({ sheet: null, row_ref: null, entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex!.id, outcome: 'review', needs_review: true, raw: { start: l.start_date, end: l.end_date }, payload: null, diff: null,
          message: `${who}: leave ${lref(l)} runs past the months on the monthly sheets and is not fully marked; left unchanged, review.` });
        continue;
      }
      if (markedWork.length === work.length) { takenAsMarked++; continue; }
      if (markedWork.length === 0) { notTaken.push(l); continue; }
      for (const r of markedRuns(l.start_date, l.end_date)) {
        b.add({ sheet: null, row_ref: null, entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex!.id, outcome: 'changed', needs_review: false,
          raw: { employee_number: emp, name: p.shortName, start: r.start, end: r.end, original: lref(l) },
          payload: { rescheduled_from_id: l.id, change_kind: 'rescheduled', start_date: r.start, end_date: r.end, status: 'approved', source_kind: 'monthly_grid', source_ref: 'monthly sheets', note: `Marked days of ${lref(l)} (only these were taken per the monthly sheets)`, change_note: 'Only the marked days were taken (monthly sheet is the real leave)', evidence },
          diff: { dates: { from: lref(l), to: `${r.start} → ${r.end}` } },
          message: `${who}: ${lref(l)} is only partly marked on the monthly sheets; ${r.start} → ${r.end} kept as the leave, the rest no longer counts.` });
      }
    }

    // B2. new employee: the original plan becomes the baseline; a block fully marked on the sheets is also current
    if (!ex) {
      for (const rg of sheetOrig) {
        const work = eachDay(rg.start, rg.end).filter((d) => inScope(d) && working(d));
        const taken = work.length > 0 && work.every(isMarked);
        const outside = eachDay(rg.start, rg.end).every((d) => !inScope(d));
        const current = taken || (outside && sheetCur.some((c) => rk(c.start, c.end) === rk(rg.start, rg.end)));
        if (current) for (const d of eachDay(rg.start, rg.end)) if (isMarked(d)) covered.add(d);
        b.add({ sheet: sheetOf(rg.sourceRef), row_ref: cellOf(rg.sourceRef), entity_kind: 'leave_record', employee_number: emp, matched_employee_id: null, outcome: 'new', needs_review: false, raw: { employee_number: emp, name: p.shortName, start: rg.start, end: rg.end, source: rg.sourceRef, plan: 'original' },
          payload: { absence_type_code: 'annual_leave_planned', status: current ? 'approved' : 'rescheduled', start_date: rg.start, end_date: rg.end, source_kind: 'pv_schedule', source_ref: rg.sourceRef, review_status: 'none', in_original_plan: true, in_current_plan: current, note: current ? 'Original plan block, taken as planned' : 'Original plan block; not taken on these dates per the monthly sheets' },
          diff: null, message: `${who}: original plan ${rg.start} → ${rg.end}${current ? '' : ' (not taken on these dates; history only)'}` });
      }
    }

    // C. marked periods with no record → approved leave typed from the sheet colour
    const groups: string[][] = [];
    for (const d of [...marks.keys()].sort()) {
      if (!inScope(d) || covered.has(d)) continue;
      const meaning = colourMeaning(marks.get(d) ?? null);
      if (meaning && !meaning.absence) continue;                          // "go to other shift / off" is not leave
      const g = groups[groups.length - 1];
      if (g && addDays(g[g.length - 1], 1) === d) g.push(d); else groups.push([d]);
    }
    const usedNotTaken = new Set<ExistingLeave>();
    for (const g of groups) {
      if (!g.some(working)) { offOnly++; continue; }                       // Off days marked next to leave carry no manpower
      while (!working(g[0])) g.shift();                                    // a new record starts and ends on duty days
      while (!working(g[g.length - 1])) g.pop();
      const start = g[0], end = g[g.length - 1];
      const key = majorityFill(g.map((d) => marks.get(d) ?? null));
      const meaning = colourMeaning(key);
      const type = meaning?.type ?? 'annual_leave_planned';
      const colourNote = meaning ? `sheet colour: ${meaning.label}` : `sheet colour ${key ?? 'not readable'} is not in the key; type set to planned annual leave (PV), check it`;
      const run = mergedRuns.find((r) => r.employeeNumber === emp && r.start <= end && r.end >= start);
      const sourceRef = run?.sourceRef ?? 'monthly sheets';
      const partner = ex ? notTaken.filter((l) => !usedNotTaken.has(l) && Math.abs(days(l.start_date, l.end_date) - g.length) <= 3)
        .sort((a, c) => Math.abs(Date.parse(a.start_date) - Date.parse(start)) - Math.abs(Date.parse(c.start_date) - Date.parse(start)))[0] : undefined;
      if (partner) {
        usedNotTaken.add(partner);
        b.add({ sheet: sheetOf(sourceRef), row_ref: cellOf(sourceRef), entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex!.id, outcome: 'changed', needs_review: !meaning,
          raw: { employee_number: emp, name: p.shortName, start, end, original: lref(partner), colour: key },
          payload: { rescheduled_from_id: partner.id, change_kind: 'rescheduled', start_date: start, end_date: end, status: 'approved', absence_type_code: type, source_kind: 'monthly_grid', source_ref: sourceRef, note: `Taken on other dates per the monthly sheets; ${colourNote}`, change_note: 'Taken on other dates per the monthly sheets', evidence },
          diff: { dates: { from: lref(partner), to: `${start} → ${end}` } },
          message: `${who}: leave ${lref(partner)} is not marked on the monthly sheets; taken ${start} → ${end} instead (${colourNote}).` });
        continue;
      }
      b.add({ sheet: sheetOf(sourceRef), row_ref: cellOf(sourceRef), entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex?.id ?? null, outcome: 'new', needs_review: !meaning,
        raw: { employee_number: emp, name: p.shortName, start, end, source: sourceRef, colour: key },
        payload: { absence_type_code: type, status: 'approved', start_date: start, end_date: end, source_kind: 'monthly_grid', source_ref: sourceRef, review_status: 'none', in_original_plan: false, in_current_plan: true, note: `Marked on the monthly sheet (${sheetOf(sourceRef)} ${cellOf(sourceRef)}); ${colourNote}`, ...(ex ? { change_kind: 'added', change_note: 'Leave marked on the monthly sheets', evidence: sourceRef } : {}) },
        diff: null, message: `${who}: ${start} → ${end} marked on the monthly sheets; recorded as leave (${colourNote}).` });
    }
    for (const l of notTaken) {
      if (usedNotTaken.has(l)) continue;
      b.add({ sheet: null, row_ref: null, entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex!.id, outcome: 'changed', needs_review: false,
        raw: { employee_number: emp, name: p.shortName, start: l.start_date, end: l.end_date },
        payload: { leave_record_id: l.id, change_kind: 'not_taken', change_note: 'Not marked on the monthly sheets; not taken on these dates', evidence },
        diff: { status: { from: l.status, to: 'rescheduled' } },
        message: `${who}: leave ${lref(l)} is not marked on the monthly sheets; recorded as not taken (kept in history, no longer counted).` });
    }

    // E. months with no monthly sheet for this person: the updated PV sheet adds leave there
    const handRanges = dbLeaves.filter((l) => l.hand_corrected || (counts(l) && l.source_kind === 'manual')).map((l) => ({ start: l.start_date, end: l.end_date }));
    const liveRanges = [...current.filter((l) => !notTaken.includes(l)).map((l) => ({ start: l.start_date, end: l.end_date })), ...handRanges, ...(!ex ? sheetOrig : [])];
    for (const rg of sheetCur) {
      if (eachDay(rg.start, rg.end).some(inScope)) continue;
      if (liveRanges.some((l) => l.start <= rg.end && l.end >= rg.start)) continue;
      b.add({ sheet: sheetOf(rg.sourceRef), row_ref: cellOf(rg.sourceRef), entity_kind: 'leave_record', employee_number: emp, matched_employee_id: ex?.id ?? null, outcome: 'new', needs_review: false,
        raw: { employee_number: emp, name: p.shortName, start: rg.start, end: rg.end, source: rg.sourceRef, plan: 'current' },
        payload: { absence_type_code: 'annual_leave_planned', status: 'approved', start_date: rg.start, end_date: rg.end, source_kind: 'pv_schedule', source_ref: rg.sourceRef, review_status: 'none', in_original_plan: origKeys.has(rk(rg.start, rg.end)), in_current_plan: true, ...(ex ? { change_kind: 'added', change_note: 'Planned on the updated PV sheet (no monthly sheet for these dates yet)', evidence } : {}) },
        diff: null, message: `${who}: planned leave ${rg.start} → ${rg.end} from the updated PV sheet (no monthly sheet for these dates yet)` });
    }
  }
  // "Covering X-shift" notes: a crew move written as text in a day cell. Never applied automatically (the note has
  // no end date and the crew blocks were not changed); listed for review unless the move is already recorded.
  const COVER = /cover(?:ing)?\s*([ABCD])\s*[-\s]?\s*shift/i;
  for (const m of parsed.gridRemarks) {
    const hit = COVER.exec(m.text);
    if (!hit) continue;
    const crew = hit[1].toUpperCase();
    const ex = byNumber.get(m.employeeNumber) ?? null;
    const recorded = !!ex && !!m.date && crewRecorded(ex, m.date, crew);
    const who = label(m.employeeNumber, m.shortName);
    const when = m.date ?? 'an unknown date';
    b.add({ sheet: m.sheet, row_ref: m.cell, entity_kind: 'note', employee_number: m.employeeNumber, matched_employee_id: ex?.id ?? null, outcome: recorded ? 'unchanged' : 'review', needs_review: !recorded,
      raw: { text: m.text.trim(), date: m.date, crew }, payload: null, diff: null,
      message: recorded ? `${who}: note "${m.text.trim()}" on ${when} — already recorded (in ${crew} Shift on that date).`
        : `${who}: note "${m.text.trim()}" on ${when} (${m.sheet} ${m.cell}). The workbook records a crew move only as this note; record it in Shift Movements if it applies.` });
  }

  if (takenAsMarked) b.add({ sheet: null, row_ref: null, entity_kind: 'note', employee_number: null, matched_employee_id: null, outcome: 'unchanged', needs_review: false, raw: { takenAsMarked }, payload: null, diff: null, message: `${takenAsMarked} current leave records are exactly as marked on the monthly sheets; unchanged.` });
  if (offOnly) b.add({ sheet: null, row_ref: null, entity_kind: 'note', employee_number: null, matched_employee_id: null, outcome: 'unchanged', needs_review: false, raw: { offOnly }, payload: null, diff: null, message: `${offOnly} marked periods fall only on roster Off days (usually the Off days after a leave); no manpower effect, nothing recorded.` });

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

/** Whether an existing employee is already in `crew` on `date` (role history or an active temporary cover). */
function crewRecorded(ex: ExistingEmployee, date: string, crew: string): boolean {
  if (ex.crew_moves?.some((m) => m.start <= date && (m.end === null || date <= m.end) && m.crew === crew)) return true;
  const period = ex.crew_history?.find((h) => h.from <= date && (h.to === null || date <= h.to));
  return (period?.crew ?? (ex.crew_history?.length ? null : ex.current_role?.crew_code ?? null)) === crew;
}
