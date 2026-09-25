import { describe as group, expect, it } from 'vitest';
import { day, describe, type AuditLookups, type AuditRow } from '..';

const lk: AuditLookups = {
  people: new Map([['e1', 'Saleh Alajmi'], ['e2', 'Huseen Al-Shati'], ['e3', 'Abdullah Ashkanani']]),
  positions: new Map([['pf', 'Field Operator']]),
  crews: new Map([['cc', 'C'], ['cd', 'D']]),
  absence: new Map([['annual_leave_planned', 'PV']]),
  actors: new Map([['u1', 'Section Head']])
};
const row = (over: Partial<AuditRow>): AuditRow => ({ id: 'a', occurred_at: '2026-09-24T10:00:00Z', actor_id: 'u1', entity_table: 'employees', entity_id: null, action: 'insert',
  previous: null, next: null, reason: null, related_employee_id: null, batch_id: null, ...over });

group('audit history sentences', () => {
  it('dates read as day month year', () => {
    expect(day('2026-09-24')).toBe('24 Sep 2026');
    expect(day(null)).toBe('—');
  });
  it('a permanent crew move and its cancellation', () => {
    const next = { employee_id: 'e1', kind: 'permanent', from_crew: 'C', to_crew: 'D', start_date: '2026-03-01', end_date: null, status: 'active', reason: 'Section Head: in D Shift' };
    const made = describe(row({ entity_table: 'crew_movements', action: 'insert', next, related_employee_id: 'e1' }), lk);
    expect(made).toMatchObject({ category: 'crews', title: 'Saleh Alajmi: permanent move C → D from 1 Mar 2026', actor: 'Section Head', fromImport: false });
    expect(made.details).toEqual(['Reason: Section Head: in D Shift']);
    const cancelled = describe(row({ entity_table: 'crew_movements', action: 'update', previous: next, next: { ...next, status: 'cancelled', cancel_reason: 'wrong crew' }, related_employee_id: 'e1' }), lk);
    expect(cancelled.title).toBe('Saleh Alajmi: permanent move cancelled (C → D from 1 Mar 2026)');
    expect(cancelled.details).toEqual(['Reason: wrong crew']);
  });
  it('day duty until further notice', () => {
    const e = describe(row({ entity_table: 'crew_movements', next: { employee_id: 'e1', kind: 'temporary', from_crew: 'C', to_crew: 'DAY', start_date: '2026-09-24', end_date: null }, related_employee_id: 'e1' }), lk);
    expect(e.title).toBe('Saleh Alajmi: day duty from C Shift, 24 Sep 2026 until further notice');
  });
  it('a crew correction on the role record', () => {
    const prev = { employee_id: 'e1', position_id: 'pf', home_crew_id: 'cc', effective_from: '2026-09-24', effective_to: null };
    const e = describe(row({ entity_table: 'employee_role_assignments', action: 'update', previous: prev, next: { ...prev, home_crew_id: 'cd' }, related_employee_id: 'e1' }), lk);
    expect(e.title).toBe('Saleh Alajmi: crew C → D from 24 Sep 2026');
  });
  it('leave cancelled by hand lists what changed', () => {
    const prev = { employee_id: 'e1', absence_type_code: 'annual_leave_planned', start_date: '2026-10-01', end_date: '2026-10-10', status: 'approved', in_current_plan: true };
    const e = describe(row({ entity_table: 'leave_records', action: 'update', previous: prev, next: { ...prev, status: 'cancelled', in_current_plan: false }, related_employee_id: 'e1' }), lk);
    expect(e.title).toBe('Saleh Alajmi: PV 1 Oct 2026 – 10 Oct 2026 cancelled');
    expect(e.details).toEqual(['Status: approved → cancelled', 'Counts: Yes → No']);
  });
  it('a Controller cover names both people', () => {
    const e = describe(row({ entity_table: 'controller_assignments', next: { kind: 'shift_cover', employee_id: 'e3', crew_code: 'B', covers_employee_id: 'e2', start_date: '2026-09-02', end_date: '2026-09-15', status: 'active' } }), lk);
    expect(e).toMatchObject({ category: 'controllers', title: 'Controller cover: Abdullah Ashkanani covers B Shift for Huseen Al-Shati, 2 Sep 2026 – 15 Sep 2026' });
  });
  it('login changes from the Users screen', () => {
    const e = describe(row({ entity_table: 'user_accounts', action: 'update', reason: 'Account edited by Section Head',
      previous: { display_name: 'Section Head', username: 'al@x.com', role_code: 'section_head', is_active: true }, next: { display_name: 'Section Head', username: 'ajr015', role_code: 'section_head', is_active: true, password_reset: true } }), lk);
    expect(e).toMatchObject({ category: 'logins', title: 'Login changed: Section Head', details: ['Username: al@x.com → ajr015', 'Password reset'] });
  });
  it('import rows are marked and unknown actors are named', () => {
    const e = describe(row({ actor_id: 'zz', batch_id: 'b1', next: { display_name: 'New Person', employee_number: '26604' } }), lk);
    expect(e).toMatchObject({ title: 'Staff member added: New Person (#26604)', fromImport: true, actor: 'Unknown login' });
  });
  it('operating modes and periods', () => {
    const prev = { code: 'shutdown', label: 'Shutdown', controller_min: 1, panel_min: 2, panel_grade14_min: 1, field_min: 4, is_active: true };
    const e = describe(row({ entity_table: 'operating_modes', action: 'update', previous: prev, next: { ...prev, field_min: 3 } }), lk);
    expect(e).toMatchObject({ category: 'modes', title: 'Operating mode changed: Shutdown', details: ['Minimums: Controller 1 · Panel 2 (1 Grade 14+) · Field 4 → Controller 1 · Panel 2 (1 Grade 14+) · Field 3'] });
    const p = describe(row({ entity_table: 'operation_periods', next: { mode_code: 'one_train', start_date: '2026-11-01', end_date: '2026-11-10', status: 'active', note: 'Train 2 turnaround' } }), lk);
    expect(p).toMatchObject({ title: 'Operating period scheduled: one train, 1 Nov 2026 – 10 Nov 2026', details: ['Train 2 turnaround'] });
  });
  it('holidays and unit events', () => {
    expect(describe(row({ entity_table: 'unit_events', next: { category: 'shutdown', title: 'SD', unit: 'Train-1', start_date: '2026-11-01', end_date: '2026-11-18', status: 'active' } }), lk))
      .toMatchObject({ category: 'modes', title: 'Unit event added: Train-1 SD, 1 Nov 2026 – 18 Nov 2026' });
    expect(describe(row({ entity_table: 'public_holidays', action: 'delete', previous: { name: 'Eid al-Fitr', start_date: '2027-03-09', end_date: '2027-03-11', expected: true } }), lk).title)
      .toBe('Public holiday removed: Eid al-Fitr, 9 Mar 2027 – 11 Mar 2027 (expected)');
  });
  it('Oracle HR status change', () => {
    const prev = { employee_id: 'e1', absence_type_code: 'annual_leave_planned', start_date: '2026-10-01', end_date: '2026-10-10', status: 'approved', in_current_plan: true, oracle_status: 'submitted', oracle_ref: null };
    const e = describe(row({ entity_table: 'leave_records', action: 'update', previous: prev, next: { ...prev, oracle_status: 'approved', oracle_ref: 'HR-77' }, related_employee_id: 'e1' }), lk);
    expect(e.title).toBe('Saleh Alajmi: PV 1 Oct 2026 – 10 Oct 2026 · Oracle: Approved');
    expect(e.details).toEqual(['Oracle: Submitted → Approved', 'Oracle no.: — → HR-77']);
  });
});
