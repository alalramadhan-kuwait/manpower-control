import { describe, expect, it } from 'vitest';
import { detectImportType, inferEmploymentType, parseManpowerWorkbook, parsePromotionMaster, planManpowerImport, planPromotionImport } from '..';
import { mergeGridRuns } from '../plan';
import { parseMonthlyGridSheet } from '../parseManpowerWorkbook';
import * as XLSX from 'xlsx';
import type { ExistingEmployee } from '../types';
import { syntheticManpowerWorkbook, syntheticPromotionWorkbook } from './fixtures';

describe('detection', () => {
  it('recognises the manpower workbook and the promotion master', () => {
    expect(detectImportType(syntheticManpowerWorkbook()).importType).toBe('u12_manpower_workbook');
    expect(detectImportType(syntheticPromotionWorkbook()).importType).toBe('promotion_master');
  });
});

describe('employment type inference', () => {
  it('treats 5-digit numbers as KNPC and 6-digit badge numbers as contractors', () => {
    expect(inferEmploymentType('20001')).toBe('knpc');
    expect(inferEmploymentType('400001')).toBe('contractor');
  });
});

describe('PV schedule parsing', () => {
  const parsed = parseManpowerWorkbook(syntheticManpowerWorkbook(), 'test.xlsx');
  it('reads the plan year, people, crews and special controller codes', () => {
    expect(parsed.year).toBe(2026);
    const ctrl = parsed.pvPeople.find((p) => p.employeeNumber === '10001')!;
    expect(ctrl.role).toBe('controller'); expect(ctrl.crew).toBe('A');
    const vr = parsed.pvPeople.find((p) => p.employeeNumber === '10002')!;
    expect(vr.role).toBe('vr_controller'); expect(vr.crew).toBeNull();
    expect(parsed.pvPeople.find((p) => p.employeeNumber === '20001')!.role).toBe('field_operator');
  });
  it('parses d1~~d2 ranges with month and year rollover', () => {
    const by = Object.fromEntries(parsed.pvRanges.map((r) => [r.employeeNumber, r]));
    expect(by['10001']).toMatchObject({ start: '2026-02-02', end: '2026-02-23' });
    expect(by['10002']).toMatchObject({ start: '2026-05-26', end: '2026-06-08' });
    expect(by['20001']).toMatchObject({ start: '2026-01-09', end: '2026-01-14' });
    expect(by['20002']).toMatchObject({ start: '2026-01-09', end: '2026-01-12' });
    expect(by['400001']).toMatchObject({ start: '2026-12-30', end: '2027-01-13' });
    expect(by['20001'].sourceRef).toContain('PV Scheduled');
  });
});

describe('monthly grid parsing and planning', () => {
  const parsed = parseManpowerWorkbook(syntheticManpowerWorkbook(), 'test.xlsx');
  it('turns 1-cells into date runs per employee', () => {
    const runs = parsed.gridRuns.filter((r) => r.employeeNumber === '20001').map((r) => [r.start, r.end]);
    expect(runs).toEqual([['2026-01-09', '2026-01-16'], ['2026-01-25', '2026-01-26']]);
  });
  it('merges runs that continue across month sheets', () => {
    const merged = mergeGridRuns(parsed.gridRuns).filter((r) => r.employeeNumber === '400001');
    expect(merged.map((r) => [r.start, r.end])).toEqual([['2026-01-31', '2026-02-02']]);
  });
  it('plans new employees, roles and qualifications; the monthly sheets decide the leave, never an unresolved absence', () => {
    const plan = planManpowerImport(parsed, [], [], 'test.xlsx');
    expect(plan.summary.employeesNew).toBe(5);
    const contractor = plan.rows.find((r) => r.entity_kind === 'employee' && r.employee_number === '400001')!;
    expect(contractor.payload).toMatchObject({ employment_type: 'contractor', employment_type_source: 'inferred', display_name: 'Contractor One' });
    const tc = plan.rows.find((r) => r.entity_kind === 'qualification' && r.employee_number === '20001')!;
    expect(tc.payload).toMatchObject({ qualification: 'take_charge', status: 'not_yet_confirmed' });
    const leave = plan.rows.filter((r) => r.entity_kind === 'leave_record' && r.payload).map((r) => {
      const p = r.payload as any; return [r.employee_number, p.start_date, p.end_date, p.source_kind, p.status, p.in_original_plan, p.in_current_plan];
    });
    expect(leave).toEqual([
      // Ctrl One: Jan sheet only; the original Feb block was moved to Mar on the updated sheet → Feb is history, Mar comes from the updated PV sheet
      ['10001', '2026-02-02', '2026-02-23', 'pv_schedule', 'rescheduled', true, false],
      ['10001', '2026-03-02', '2026-03-23', 'pv_schedule', 'approved', false, true],
      // Ctrl VR: on no monthly sheet → the plan sheets decide
      ['10002', '2026-05-26', '2026-06-08', 'pv_schedule', 'approved', true, true],
      ['10002', '2026-07-01', '2026-07-06', 'pv_schedule', 'approved', false, true],
      // Field One: original 9–14 fully marked → taken; 15–16 are Off days (nothing); 25–26 marked → leave
      ['20001', '2026-01-09', '2026-01-14', 'pv_schedule', 'approved', true, true],
      ['20001', '2026-01-25', '2026-01-26', 'monthly_grid', 'approved', false, true],
      // Contractor One: December is not on a monthly sheet and not on the updated plan → history;
      // 31 Jan–2 Feb marked, of which 31 Jan and 1 Feb are Off days → the leave is the duty day 2 Feb
      ['400001', '2026-12-30', '2027-01-13', 'pv_schedule', 'rescheduled', true, false],
      ['400001', '2026-02-02', '2026-02-02', 'monthly_grid', 'approved', false, true],
      // Field Two: 9–12 taken; 13–14 are working days (N1, N2) marked → leave
      ['20002', '2026-01-09', '2026-01-12', 'pv_schedule', 'approved', true, true],
      ['20002', '2026-01-13', '2026-01-14', 'monthly_grid', 'approved', false, true]
    ]);
    expect(plan.rows.some((r) => (r.payload as any)?.status === 'unresolved')).toBe(false);
    expect(plan.summary.unresolvedNew).toBe(0);
    // the synthetic sheet has no fill colours → type defaults to planned annual leave and the row is flagged to check
    const marked = plan.rows.find((r) => r.employee_number === '20001' && (r.payload as any)?.source_kind === 'monthly_grid')!;
    expect(marked).toMatchObject({ needs_review: true, payload: { absence_type_code: 'annual_leave_planned' } });
    expect(marked.message).toContain('not in the key');
  });
  it('never creates an Acting Controller qualification (it must be recorded explicitly in the profile)', () => {
    const plan = planManpowerImport(parsed, [], [], 'test.xlsx');
    const quals = plan.rows.filter((r) => r.entity_kind === 'qualification').map((r) => (r.payload as any)?.qualification);
    expect(quals).not.toContain('acting_controller');
  });
  describe('existing register (monthly sheet is the real leave)', () => {
    const emp = (id: string, num: string, name: string, crew: 'A' | null = 'A'): ExistingEmployee => ({
      id, employee_number: num, official_name: name, display_name: name, short_name: name, employment_type: 'knpc', employment_type_source: 'inferred', in_unit12_scope: true,
      grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null,
      current_role: crew ? { position_code: 'field_operator', crew_code: crew } : null, qualifications: { take_charge: 'yes' }
    });
    const existing = [emp('e1', '20001', 'Field One'), emp('e2', '20002', 'Field Two')];
    const cur = (id: string, employee_id: string, start: string, end: string, over: object = {}) =>
      ({ id, employee_id, start_date: start, end_date: end, source_kind: 'pv_schedule' as const, status: 'approved', absence_type_code: 'annual_leave_planned', review_status: 'none', in_original_plan: true, in_current_plan: true, ...over });
    const leaveRows = (plan: ReturnType<typeof planManpowerImport>, num: string) => plan.rows.filter((r) => r.entity_kind === 'leave_record' && r.employee_number === num && r.payload);
    const idempotent = [cur('a', 'e1', '2026-01-09', '2026-01-14'), cur('b', 'e1', '2026-01-25', '2026-01-26', { source_kind: 'monthly_grid', in_original_plan: false }),
      cur('c', 'e2', '2026-01-09', '2026-01-12'), cur('d', 'e2', '2026-01-13', '2026-01-14', { source_kind: 'monthly_grid', in_original_plan: false })];

    it('never replaces a role set by hand; a different workbook role becomes a review note', () => {
      const manual = { ...existing[0], current_role: { position_code: 'field_operator', crew_code: 'B' as const, source: 'manual' as const, effective_from: '2026-09-23' } };
      const imported = { ...existing[1], current_role: { position_code: 'field_operator', crew_code: 'B' as const, source: 'import' as const } };
      const plan = planManpowerImport(parsed, [manual, imported], idempotent, 'test.xlsx');
      const role = (num: string) => plan.rows.find((r) => r.entity_kind === 'role_assignment' && r.employee_number === num)!;
      expect(role('20001')).toMatchObject({ outcome: 'review', needs_review: true, payload: null });
      expect(role('20001').message).toContain('kept the role set by hand');
      expect(role('20002')).toMatchObject({ outcome: 'changed', payload: { crew_code: 'A' } });
    });
    it('changes nothing when the register already matches the monthly sheets (re-importing the same workbook)', () => {
      const plan = planManpowerImport(parsed, existing, idempotent, 'test.xlsx');
      expect(leaveRows(plan, '20001')).toEqual([]);
      expect(leaveRows(plan, '20002')).toEqual([]);
    });
    it('a block with no marks is not taken (history, no longer counted); a similar-length marked period elsewhere is its new dates', () => {
      const plan = planManpowerImport(parsed, existing, [cur('a', 'e1', '2026-01-17', '2026-01-22'), idempotent[1], idempotent[2], idempotent[3]], 'test.xlsx');
      const rows = leaveRows(plan, '20001');
      expect(rows.map((r) => [r.outcome, (r.payload as any).change_kind, (r.payload as any).rescheduled_from_id ?? (r.payload as any).leave_record_id, (r.payload as any).start_date ?? null])).toEqual([
        ['changed', 'rescheduled', 'a', '2026-01-09']
      ]);
      expect(rows[0].payload).toMatchObject({ end_date: '2026-01-14', source_kind: 'monthly_grid' });
    });
    it('a block with no marks and nothing similar is recorded as not taken, never cancelled or deleted', () => {
      const plan = planManpowerImport(parsed, existing, [...idempotent, cur('x', 'e2', '2026-01-25', '2026-01-26')], 'test.xlsx');
      const rows = leaveRows(plan, '20002');
      expect(rows.map((r) => [r.outcome, (r.payload as any).change_kind, (r.payload as any).leave_record_id])).toEqual([['changed', 'not_taken', 'x']]);
      expect(plan.summary.pvNotTaken).toBe(1);
    });
    it('a partly marked block keeps only its marked days', () => {
      const plan = planManpowerImport(parsed, existing, [cur('a', 'e2', '2026-01-09', '2026-01-20')], 'test.xlsx');
      const rows = leaveRows(plan, '20002');
      expect(rows.map((r) => [(r.payload as any).change_kind, (r.payload as any).rescheduled_from_id, (r.payload as any).start_date, (r.payload as any).end_date, (r.payload as any).source_kind])).toEqual([
        ['rescheduled', 'a', '2026-01-09', '2026-01-14', 'monthly_grid']
      ]);
    });
    it('marked days with no record become approved leave typed from the sheet colour', () => {
      const withColour = structuredClone(parsed);
      for (const r of withColour.gridRuns) if (r.employeeNumber === '20001' && r.start === '2026-01-25') r.fills = { '2026-01-25': 'rgb:00B0F0', '2026-01-26': 'rgb:00B0F0' };
      const plan = planManpowerImport(withColour, existing, [idempotent[0], idempotent[2], idempotent[3]], 'test.xlsx');
      const rows = leaveRows(plan, '20001');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: 'new', needs_review: false, payload: { status: 'approved', absence_type_code: 'special_leave', source_kind: 'monthly_grid', change_kind: 'added', start_date: '2026-01-25', end_date: '2026-01-26' } });
    });
    it('"go to other shift / off" marks are not leave', () => {
      const offShift = structuredClone(parsed);
      for (const r of offShift.gridRuns) if (r.employeeNumber === '20001' && r.start === '2026-01-25') r.fills = { '2026-01-25': 'theme:9:0.6', '2026-01-26': 'theme:9:0.6' };
      const plan = planManpowerImport(offShift, existing, [idempotent[0], idempotent[2], idempotent[3]], 'test.xlsx');
      expect(leaveRows(plan, '20001')).toEqual([]);
    });
    it('lists "Covering X-shift" notes for review, and marks them as recorded once the move is in Shift Movements', () => {
      const withNote = structuredClone(parsed);
      withNote.gridRemarks.push({ employeeNumber: '20001', shortName: 'Field One', sheet: 'Jan', cell: 'E9', date: '2026-01-20', text: 'Covering B-shift' });
      const notes = (plan: ReturnType<typeof planManpowerImport>) => plan.rows.filter((r) => r.entity_kind === 'note' && (r.raw as any)?.crew);
      const open = notes(planManpowerImport(withNote, existing, idempotent, 'test.xlsx'));
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ outcome: 'review', needs_review: true, sheet: 'Jan', row_ref: 'E9', raw: { crew: 'B', date: '2026-01-20' } });
      expect(open[0].message).toContain('Shift Movements');
      const moved = existing.map((e) => (e.id === 'e1' ? { ...e, crew_moves: [{ start: '2026-01-15', end: null, crew: 'B' }] } : e));
      expect(notes(planManpowerImport(withNote, moved, idempotent, 'test.xlsx'))[0]).toMatchObject({ outcome: 'unchanged', needs_review: false });
      const permanent = existing.map((e) => (e.id === 'e1' ? { ...e, crew_history: [{ from: '2026-01-01', to: '2026-01-19', crew: 'A' }, { from: '2026-01-20', to: null, crew: 'B' }] } : e));
      expect(notes(planManpowerImport(withNote, permanent, idempotent, 'test.xlsx'))[0]).toMatchObject({ outcome: 'unchanged' });
    });
    it('leave cancelled by hand is not recreated from the sheet marks', () => {
      const cancelled = cur('b', 'e1', '2026-01-25', '2026-01-26', { source_kind: 'monthly_grid', in_original_plan: false, status: 'cancelled', in_current_plan: false, hand_corrected: true });
      const plan = planManpowerImport(parsed, existing, [idempotent[0], cancelled, idempotent[2], idempotent[3]], 'test.xlsx');
      expect(leaveRows(plan, '20001')).toEqual([]);
    });
    it('leave corrected by hand is never re-planned: shortened dates stay short, a type fix is never marked not taken', () => {
      // imported 9–14 Jan replaced by hand with 9–12 Jan; the sheet still marks 13–14 Jan
      const replaced = cur('a', 'e1', '2026-01-09', '2026-01-14', { status: 'rescheduled', in_current_plan: false, hand_corrected: true });
      const shorter = cur('h', 'e1', '2026-01-09', '2026-01-12', { source_kind: 'manual', in_original_plan: false, hand_corrected: true });
      const plan = planManpowerImport(parsed, existing, [replaced, shorter, idempotent[1], idempotent[2], idempotent[3]], 'test.xlsx');
      expect(leaveRows(plan, '20001')).toEqual([]);
      // a type-only correction stays current even on dates the sheet does not mark
      const typeFixed = cur('x', 'e2', '2026-01-25', '2026-01-26', { absence_type_code: 'sick_leave', hand_corrected: true });
      const plan2 = planManpowerImport(parsed, existing, [...idempotent, typeFixed], 'test.xlsx');
      expect(leaveRows(plan2, '20002')).toEqual([]);
    });
    it('never changes a record entered or classified by hand, and does not duplicate it', () => {
      const manual = cur('m', 'e1', '2026-01-25', '2026-01-26', { source_kind: 'manual', absence_type_code: 'sick_leave', in_original_plan: false });
      const plan = planManpowerImport(parsed, existing, [idempotent[0], manual, idempotent[2], idempotent[3]], 'test.xlsx');
      expect(leaveRows(plan, '20001')).toEqual([]);
      const manualAway = cur('m', 'e1', '2026-01-05', '2026-01-06', { source_kind: 'manual', absence_type_code: 'sick_leave', in_original_plan: false });
      const plan2 = planManpowerImport(parsed, existing, [...idempotent, manualAway], 'test.xlsx');
      expect(leaveRows(plan2, '20001')).toEqual([]);
    });
    it('flags a baseline discrepancy instead of rewriting the original plan', () => {
    const existing: ExistingEmployee[] = [{
      id: 'c1', employee_number: '10001', official_name: 'Ctrl One', display_name: 'Ctrl One', short_name: 'Ctrl One', employment_type: 'knpc', employment_type_source: 'inferred', in_unit12_scope: true,
      grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null, current_role: null, qualifications: {}
    }];
    // register says the original block was 4–25 Feb; the sheet now says 2–23 Feb → flagged both ways, nothing rewritten
    const plan = planManpowerImport(parsed, existing, [{ id: 'l1', employee_id: 'c1', start_date: '2026-02-04', end_date: '2026-02-25', source_kind: 'pv_schedule', status: 'approved', in_original_plan: true, in_current_plan: true }], 'test.xlsx');
    const flags = plan.rows.filter((r) => r.entity_kind === 'leave_record' && r.employee_number === '10001' && r.outcome === 'review' && !r.payload);
    expect(flags.map((r) => r.message)).toEqual([
      expect.stringContaining('original PV sheet now shows 2026-02-02 → 2026-02-23'),
      expect.stringContaining('baseline block 2026-02-04 → 2026-02-25 is no longer on the original PV sheet')
    ]);
  });
  });
});

describe('monthly grid, second layout', () => {
  it('reads a block whose title sits several rows above the header and whose day numbers are on a later row', () => {
    const wb = XLSX.utils.book_new();
    const sheet: (string | number | null)[][] = [];
    sheet[0] = ['"B" SHIFT'];
    sheet[5] = ['NO', 'NAME', 'EMP #', 'F', 'S'];
    sheet[6] = [null, null, null, ...Array.from({ length: 31 }, (_, i) => i + 1)];
    const row: (string | number | null)[] = [1, 'Field B', 30001];
    for (let d = 1; d <= 31; d++) row.push(d === 3 || d === 4 ? 1 : d === 10 ? 'Rescheduled in Jun' : null);
    sheet[7] = row;
    sheet[8] = ['TOTAL'];
    sheet[10] = [' Panel operators '];
    sheet[13] = ['NO', 'NAME', 'EMP #', 'F', 'S'];
    sheet[14] = [null, null, null, 'D', 'D', 'B', 'B'];
    sheet[15] = [null, null, null, ...Array.from({ length: 31 }, (_, i) => i + 1)];
    sheet[16] = [1, 'Panel A', 30002, 1];
    sheet[17] = [];
    sheet[18] = [2, 'Panel B', 30003];
    sheet[19] = ['TOTAL AVILABLE'];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.map((r) => r ?? [])), 'May');
    const warnings: string[] = [];
    const res = parseMonthlyGridSheet(wb, 'May', 2026, 5, 'test.xlsx', warnings);
    expect(res.people.map((p) => [p.employeeNumber, p.role, p.crew])).toEqual([['30001', 'field_operator', 'B'], ['30002', 'panel_operator', 'A'], ['30003', 'panel_operator', 'B']]);
    expect(res.runs.map((r) => [r.employeeNumber, r.start, r.end])).toEqual([['30001', '2026-05-03', '2026-05-04'], ['30002', '2026-05-01', '2026-05-01']]);
    expect(warnings).toEqual(['May M8: Field B (30001) day 10 holds "Rescheduled in Jun" instead of 1; not treated as an absence']);
  });
});

describe('promotion master', () => {
  const parsed = parsePromotionMaster(syntheticPromotionWorkbook(), 'promo.xlsx');
  it('reads the as-of date and the block position', () => {
    expect(parsed.asOfDate).toBe('2026-10-01');
    expect(parsed.records[0]).toMatchObject({ employeeNumber: '10001', grade: 16, blockPosition: 'Controller', joinDate: '2004-09-25', warnings: false });
  });
  it('matches by employee number only, ignores out-of-scope rows, reports duplicates and missing KNPC staff', () => {
    const existing: ExistingEmployee[] = [
      { id: 'c1', employee_number: '10001', official_name: 'Ctrl One', display_name: 'Ctrl One', short_name: 'Ctrl One', employment_type: 'knpc', employment_type_source: 'inferred', in_unit12_scope: true, grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null, current_role: null, qualifications: {} },
      { id: 'f1', employee_number: '20001', official_name: 'Field One', display_name: 'Field One', short_name: 'Field One', employment_type: 'knpc', employment_type_source: 'inferred', in_unit12_scope: true, grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null, current_role: null, qualifications: {} },
      { id: 'x1', employee_number: '400001', official_name: 'Contractor One', display_name: 'Contractor One', short_name: null, employment_type: 'contractor', employment_type_source: 'inferred', in_unit12_scope: true, grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null, current_role: null, qualifications: {} }
    ];
    const plan = planPromotionImport(parsed, existing, 'promo.xlsx');
    const emp = plan.rows.filter((r) => r.entity_kind === 'employee');
    expect(emp.map((r) => r.outcome)).toEqual(['changed', 'ignored_out_of_scope', 'error']);
    expect(emp[0].payload).toMatchObject({ official_name: 'CTRL ONE FULL NAME', grade: 16, employment_type: 'knpc', employment_type_source: 'confirmed' });
    expect(plan.rows.filter((r) => r.entity_kind === 'performance').map((r) => (r.payload as any).year)).toEqual([2026, 2025]);
    expect(plan.rows.filter((r) => r.entity_kind === 'sick_total').map((r) => (r.payload as any).days)).toEqual([3, 0]);
    const unmatched = plan.rows.filter((r) => r.outcome === 'unmatched');
    expect(unmatched).toHaveLength(1); // Field One is KNPC but missing; the contractor is not reported
    expect(unmatched[0].employee_number).toBe('20001');
  });
});
