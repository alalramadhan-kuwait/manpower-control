import { describe, expect, it } from 'vitest';
import { detectImportType, inferEmploymentType, parseManpowerWorkbook, parsePromotionMaster, planManpowerImport, planPromotionImport } from '..';
import { mergeGridRuns } from '../plan';
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
    expect(contractor.payload).toMatchObject({ employment_type: 'contractor', employment_type_source: 'inferred' });
    const tc = plan.rows.find((r) => r.entity_kind === 'qualification' && r.employee_number === '20001')!;
    expect(tc.payload).toMatchObject({ qualification: 'take_charge', status: 'not_yet_confirmed' });
    const pv = plan.rows.filter((r) => r.entity_kind === 'leave_record' && r.outcome === 'new');
    expect(pv).toHaveLength(5);
    expect(pv[0].payload).toMatchObject({ absence_type_code: 'annual_leave_planned', status: 'approved', source_kind: 'pv_schedule' });
    const review = plan.rows.filter((r) => r.entity_kind === 'leave_record' && r.outcome === 'review');
    // Field One: 9–16 Jan is covered (PV 9–14 + roster Off 15–16 for crew A); 25–26 Jan (M1, M2) is not.
    // Field Two: PV 9–12 ends on a working day, so 13–14 Jan (N1, N2) are NOT absorbed — they are unresolved.
    // Contractor One: 31 Jan–2 Feb has no PV at all.
    expect(review.map((r) => [r.employee_number, (r.payload as any).start_date, (r.payload as any).end_date])).toEqual([
      ['20001', '2026-01-25', '2026-01-26'], ['20002', '2026-01-13', '2026-01-14'], ['400001', '2026-01-31', '2026-02-02']
    ]);
    expect(review[0].payload).toMatchObject({ absence_type_code: null, status: 'unresolved', review_status: 'pending_review' });
  });
  it('does not re-create leave or override qualifications that already exist', () => {
    const existing: ExistingEmployee[] = [{
      id: 'e1', employee_number: '20001', full_name: 'Field One', short_name: 'Field One', employment_type: 'knpc', employment_type_source: 'inferred', in_unit12_scope: true,
      grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null,
      current_role: { position_code: 'field_operator', crew_code: 'A' }, qualifications: { take_charge: 'yes' }
    }];
    const plan = planManpowerImport(parsed, existing, [{ employee_id: 'e1', start_date: '2026-01-09', end_date: '2026-01-14', source_kind: 'pv_schedule', status: 'approved' }], 'test.xlsx');
    const rows = plan.rows.filter((r) => r.employee_number === '20001');
    expect(rows.find((r) => r.entity_kind === 'employee')!.outcome).toBe('unchanged');
    expect(rows.find((r) => r.entity_kind === 'role_assignment')!.outcome).toBe('unchanged');
    expect(rows.find((r) => r.entity_kind === 'qualification')!.outcome).toBe('unchanged');
    expect(rows.find((r) => r.entity_kind === 'leave_record' && r.raw?.start === '2026-01-09')!.outcome).toBe('unchanged');
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
      { id: 'c1', employee_number: '10001', full_name: 'Ctrl One', short_name: 'Ctrl One', employment_type: 'knpc', employment_type_source: 'inferred', in_unit12_scope: true, grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null, current_role: null, qualifications: {} },
      { id: 'f1', employee_number: '20001', full_name: 'Field One', short_name: 'Field One', employment_type: 'knpc', employment_type_source: 'inferred', in_unit12_scope: true, grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null, current_role: null, qualifications: {} },
      { id: 'x1', employee_number: '400001', full_name: 'Contractor One', short_name: null, employment_type: 'contractor', employment_type_source: 'inferred', in_unit12_scope: true, grade: null, master_position: null, cost_center: null, join_date: null, normalization_date: null, last_promotion_date: null, position_start_date: null, education: null, service_years: null, years_in_grade: null, current_role: null, qualifications: {} }
    ];
    const plan = planPromotionImport(parsed, existing, 'promo.xlsx');
    const emp = plan.rows.filter((r) => r.entity_kind === 'employee');
    expect(emp.map((r) => r.outcome)).toEqual(['changed', 'ignored_out_of_scope', 'error']);
    expect(emp[0].payload).toMatchObject({ full_name: 'CTRL ONE FULL NAME', grade: 16, employment_type: 'knpc', employment_type_source: 'confirmed' });
    expect(plan.rows.filter((r) => r.entity_kind === 'performance').map((r) => (r.payload as any).year)).toEqual([2026, 2025]);
    expect(plan.rows.filter((r) => r.entity_kind === 'sick_total').map((r) => (r.payload as any).days)).toEqual([3, 0]);
    const unmatched = plan.rows.filter((r) => r.outcome === 'unmatched');
    expect(unmatched).toHaveLength(1); // Field One is KNPC but missing; the contractor is not reported
    expect(unmatched[0].employee_number).toBe('20001');
  });
});
