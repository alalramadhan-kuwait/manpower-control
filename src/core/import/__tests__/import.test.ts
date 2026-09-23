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
  it('plans new employees, roles, qualifications and leave; flags non-PV absences for review', () => {
    const plan = planManpowerImport(parsed, [], [], 'test.xlsx');
    expect(plan.summary.employeesNew).toBe(5);
    const contractor = plan.rows.find((r) => r.entity_kind === 'employee' && r.employee_number === '400001')!;
    expect(contractor.payload).toMatchObject({ employment_type: 'contractor', employment_type_source: 'inferred', display_name: 'Contractor One' });
    const tc = plan.rows.find((r) => r.entity_kind === 'qualification' && r.employee_number === '20001')!;
    expect(tc.payload).toMatchObject({ qualification: 'take_charge', status: 'not_yet_confirmed' });
    const pv = plan.rows.filter((r) => r.entity_kind === 'leave_record' && r.outcome === 'new');
    // current plan: Ctrl One MAR, Ctrl VR MAY + JUL, Field One 9–12, Field Two 9–12 (5) + original-only history: Ctrl One FEB, Field One 9–14, Contractor DEC (3)
    expect(pv).toHaveLength(8);
    const cur = pv.filter((r) => (r.payload as any).in_current_plan);
    expect(cur).toHaveLength(5);
    expect(cur.map((r) => [r.employee_number, (r.payload as any).start_date, (r.payload as any).in_original_plan])).toEqual([
      ['10001', '2026-03-02', false], ['10002', '2026-05-26', true], ['10002', '2026-07-01', false], ['20001', '2026-01-09', false], ['20002', '2026-01-09', true]
    ]);
    const hist = pv.filter((r) => !(r.payload as any).in_current_plan);
    expect(hist.map((r) => [r.employee_number, (r.payload as any).start_date, (r.payload as any).status])).toEqual([
      ['10001', '2026-02-02', 'rescheduled'], ['20001', '2026-01-09', 'rescheduled'], ['400001', '2026-12-30', 'cancelled']
    ]);
    const review = plan.rows.filter((r) => r.entity_kind === 'leave_record' && r.outcome === 'review');
    // Field One: current plan 9–12 ends on A2, so 13–16 Jan (N1 N2 Off1 Off2 marked on the sheet) and 25–26 Jan are unresolved.
    // Field Two: PV 9–12 ends on a working day, so 13–14 Jan (N1, N2) are NOT absorbed — they are unresolved.
    // Contractor One: 31 Jan–2 Feb has no current plan at all.
    expect(review.map((r) => [r.employee_number, (r.payload as any).start_date, (r.payload as any).end_date])).toEqual([
      ['20001', '2026-01-13', '2026-01-16'], ['20001', '2026-01-25', '2026-01-26'], ['20002', '2026-01-13', '2026-01-14'], ['400001', '2026-01-31', '2026-02-02']
    ]);
    expect(review[0].payload).toMatchObject({ absence_type_code: null, status: 'unresolved', review_status: 'pending_review', in_current_plan: true });
  });
  it('recognises existing leave (reschedules it when the current sheet moved it) and never overrides qualifications', () => {
    const existing: ExistingEmployee[] = [{
      id: 'e1', employee_number: '20001', official_name: 'Field One', display_name: 'Field One', short_name: 'Field One', employment_type: 'knpc', employment_type_source: 'inferred', in_unit12_scope: true,
      grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null,
      current_role: { position_code: 'field_operator', crew_code: 'A' }, qualifications: { take_charge: 'yes' }
    }];
    const plan = planManpowerImport(parsed, existing, [{ id: 'p1', employee_id: 'e1', start_date: '2026-01-09', end_date: '2026-01-14', source_kind: 'pv_schedule', status: 'approved', in_original_plan: true, in_current_plan: true }], 'test.xlsx');
    const rows = plan.rows.filter((r) => r.employee_number === '20001');
    expect(rows.find((r) => r.entity_kind === 'employee')!.outcome).toBe('unchanged');
    expect(rows.find((r) => r.entity_kind === 'role_assignment')!.outcome).toBe('unchanged');
    expect(rows.find((r) => r.entity_kind === 'qualification')!.outcome).toBe('unchanged');
    const resched = rows.find((r) => r.entity_kind === 'leave_record' && r.outcome === 'changed')!;
    expect(resched.payload).toMatchObject({ rescheduled_from_id: 'p1', change_kind: 'rescheduled', start_date: '2026-01-09', end_date: '2026-01-12' });
    expect(resched.diff).toEqual({ dates: { from: '2026-01-09 → 2026-01-14', to: '2026-01-09 → 2026-01-12' } });
    expect(rows.filter((r) => r.entity_kind === 'leave_record' && r.outcome === 'new')).toHaveLength(0);
  });
  it('pairs rescheduled blocks, cancels vanished ones and adds new ones against the register', () => {
    const emp = (id: string, num: string, name: string, type: 'knpc' | 'contractor' = 'knpc'): ExistingEmployee => ({
      id, employee_number: num, official_name: name, display_name: name, short_name: name, employment_type: type, employment_type_source: 'inferred', in_unit12_scope: true,
      grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null, current_role: null, qualifications: {}
    });
    const existing = [emp('c1', '10001', 'Ctrl One'), emp('v1', '10002', 'Ctrl VR'), emp('x1', '400001', 'Contractor One', 'contractor')];
    const base = { source_kind: 'pv_schedule' as const, status: 'approved', in_original_plan: true, in_current_plan: true };
    const plan = planManpowerImport(parsed, existing, [
      { id: 'l1', employee_id: 'c1', start_date: '2026-02-02', end_date: '2026-02-23', ...base },
      { id: 'l2', employee_id: 'v1', start_date: '2026-05-26', end_date: '2026-06-08', ...base },
      { id: 'l3', employee_id: 'x1', start_date: '2026-12-30', end_date: '2027-01-13', ...base }
    ], 'test.xlsx');
    const leave = plan.rows.filter((r) => r.entity_kind === 'leave_record' && r.sheet?.startsWith('PV'));
    const byEmp = (n: string) => leave.filter((r) => r.employee_number === n);
    expect(byEmp('10001').map((r) => [r.outcome, (r.payload as any)?.change_kind ?? null])).toEqual([['changed', 'rescheduled']]);
    expect(byEmp('10001')[0].payload).toMatchObject({ rescheduled_from_id: 'l1', start_date: '2026-03-02', end_date: '2026-03-23' });
    expect(byEmp('10001')[0].message).toContain('moved');
    expect(byEmp('10002').map((r) => [r.outcome, (r.payload as any)?.change_kind ?? null])).toEqual([['unchanged', null], ['new', 'added']]);
    expect(byEmp('400001').map((r) => [r.outcome, (r.payload as any)?.change_kind ?? null])).toEqual([['changed', 'cancelled']]);
    expect(byEmp('400001')[0].payload).toMatchObject({ leave_record_id: 'l3' });
    expect(plan.summary).toMatchObject({ pvRescheduled: 1, pvCancelled: 1, pvAdded: 1 });
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

describe('unresolved absences already in the register', () => {
  const parsed = parseManpowerWorkbook(syntheticManpowerWorkbook(), 'test.xlsx');
  const existing: ExistingEmployee[] = [{
    id: 'e1', employee_number: '20001', official_name: 'Field One', display_name: 'Field One', short_name: 'Field One', employment_type: 'knpc', employment_type_source: 'inferred', in_unit12_scope: true,
    grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null,
    current_role: { position_code: 'field_operator', crew_code: 'A' }, qualifications: {}
  }];
  const pv = { id: 'p1', employee_id: 'e1', start_date: '2026-01-09', end_date: '2026-01-14', source_kind: 'pv_schedule' as const, status: 'approved', in_original_plan: true, in_current_plan: true };
  const gridRows = (plan: ReturnType<typeof planManpowerImport>) => plan.rows.filter((r) => r.entity_kind === 'leave_record' && r.employee_number === '20001' && !r.sheet?.startsWith('PV') && ((r.raw as any)?.start ?? '') >= '2026-01-25');
  it('keeps an exact match unchanged', () => {
    const plan = planManpowerImport(parsed, existing, [pv, { id: 'l1', employee_id: 'e1', start_date: '2026-01-25', end_date: '2026-01-26', source_kind: 'monthly_grid', status: 'unresolved', absence_type_code: null, review_status: 'pending_review' }], 'test.xlsx');
    expect(gridRows(plan).map((r) => r.outcome)).toEqual(['unchanged']);
  });
  it('moves the dates of an import-owned record that now overlaps a different run', () => {
    const plan = planManpowerImport(parsed, existing, [pv, { id: 'l1', employee_id: 'e1', start_date: '2026-01-25', end_date: '2026-01-25', source_kind: 'monthly_grid', status: 'unresolved', absence_type_code: null, review_status: 'pending_review' }], 'test.xlsx');
    const rows = gridRows(plan);
    expect(rows.map((r) => r.outcome)).toEqual(['changed']);
    expect(rows[0].payload).toMatchObject({ leave_record_id: 'l1', start_date: '2026-01-25', end_date: '2026-01-26' });
    expect(rows[0].diff).toEqual({ dates: { from: '2026-01-25 → 2026-01-25', to: '2026-01-25 → 2026-01-26' } });
  });
  it('never touches a record a person has classified; flags it instead', () => {
    const plan = planManpowerImport(parsed, existing, [pv, { id: 'l1', employee_id: 'e1', start_date: '2026-01-25', end_date: '2026-01-25', source_kind: 'monthly_grid', status: 'approved', absence_type_code: 'sick_leave', review_status: 'resolved' }], 'test.xlsx');
    const rows = gridRows(plan);
    // 25 Jan is explained by the classified sick leave; 26 Jan is not → one new unresolved day, classified record untouched
    expect(rows.map((r) => [r.outcome, (r.payload as any)?.start_date ?? null])).toEqual([['review', '2026-01-26'], ['unchanged', null]]);
    expect(rows[1].message).toContain('classified absence');
  });
  it('flags a grid record the workbook no longer marks, without deleting it', () => {
    const plan = planManpowerImport(parsed, existing, [pv, { id: 'l1', employee_id: 'e1', start_date: '2026-01-05', end_date: '2026-01-06', source_kind: 'monthly_grid', status: 'unresolved', absence_type_code: null, review_status: 'pending_review' }], 'test.xlsx');
    const rows = plan.rows.filter((r) => r.entity_kind === 'leave_record' && r.employee_number === '20001' && !r.sheet?.startsWith('PV'));
    const gone = rows.find((r) => !r.payload && (r.raw as any).start === '2026-01-05')!;
    expect(gone.outcome).toBe('review');
    expect(gone.message).toContain('no longer marked');
    expect(rows.filter((r) => r.payload && (r.payload as any).start_date === '2026-01-25').length).toBe(1);
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
