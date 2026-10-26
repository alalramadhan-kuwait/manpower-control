import { describe, expect, it } from 'vitest';
import { approvalState, crewPlace, joinTouching, leaveState, oracleState, planState, timeState, type OracleLogEntry, type StatusRecord } from '../status';

const rec = (o: Partial<StatusRecord> = {}): StatusRecord => ({
  root_id: 'r1', start_date: '2026-11-10', end_date: '2026-11-20', status: 'approved', in_current_plan: true, absence_type_code: 'annual_leave_planned', ...o
});
const log = (o: Partial<OracleLogEntry> = {}): OracleLogEntry => ({ rootId: 'r1', start: '2026-11-10', end: '2026-11-20', status: 'submitted', source: 'recorded', at: '2026-10-20T08:00:00Z', ...o });

describe('leave status', () => {
  it('keeps the plan version state apart', () => {
    expect(planState(rec())).toBe('current');
    expect(planState(rec({ status: 'rescheduled', in_current_plan: false }))).toBe('rescheduled');
    expect(planState(rec({ status: 'cancelled', in_current_plan: false }))).toBe('cancelled');
  });
  it('reads the Section Head approval only from approved / declined, for plan PV only', () => {
    expect(approvalState(rec({ approved_at: '2026-10-01' }), '2026-10-26')).toBe('approved');
    expect(approvalState(rec({ declined_at: '2026-10-01' }), '2026-10-26')).toBe('declined');
    expect(approvalState(rec(), '2026-10-26')).toBe('awaiting');
    expect(approvalState(rec(), '2026-11-10')).toBe('lapsed');
    expect(approvalState(rec({ absence_type_code: 'sick_leave' }), '2026-10-26')).toBe('not_required');
  });
  it('never assumes an Oracle application without a recorded entry', () => {
    expect(oracleState(rec(), [])).toBe('not_recorded');
    expect(oracleState(rec({ approved_at: '2026-10-01' }), [])).toBe('not_recorded');
    expect(oracleState(rec(), [log({ source: 'assumed_past', status: 'approved' })])).toBe('assumed');
  });
  it('keeps Oracle submitted apart from Oracle approved, and follows the latest entry for these dates', () => {
    expect(oracleState(rec(), [log()])).toBe('submitted');
    expect(oracleState(rec(), [log(), log({ status: 'approved', at: '2026-10-22T08:00:00Z' })])).toBe('approved');
    expect(oracleState(rec(), [log({ status: 'cancelled' })])).toBe('not_recorded');
    expect(oracleState(rec(), [log({ start: '2026-11-11' })])).toBe('not_recorded');
  });
  it('takes the time state from the dates only', () => {
    expect(timeState(rec(), '2026-11-01')).toBe('upcoming');
    expect(timeState(rec(), '2026-11-15')).toBe('on_leave');
    expect(timeState(rec(), '2026-11-21')).toBe('taken');
    expect(timeState(rec({ end_date: '9999-12-31' }), '2026-11-21')).toBe('open');
  });
  it('a taken leave can still be awaiting Oracle: the four facts stay separate', () => {
    expect(leaveState(rec({ approved_at: '2026-10-01' }), [log()], '2026-12-01')).toEqual({ plan: 'current', approval: 'approved', oracle: 'submitted', time: 'taken' });
  });
});

describe('joinTouching', () => {
  const r = (emp: string, s: string, e: string) => ({ employee_id: emp, start_date: s, end_date: e });
  it('joins back-to-back records of one person into one leave', () => {
    const j = joinTouching([r('a', '2026-02-14', '2026-02-15'), r('a', '2026-02-02', '2026-02-13'), r('a', '2026-05-09', '2026-05-22')]);
    expect(j.map((x) => [x.start, x.end, x.records.length])).toEqual([['2026-02-02', '2026-02-15', 2], ['2026-05-09', '2026-05-22', 1]]);
  });
  it('keeps a one-day gap and other people apart', () => {
    const j = joinTouching([r('a', '2026-01-25', '2026-01-30'), r('a', '2026-02-01', '2026-02-01'), r('b', '2026-01-31', '2026-02-02')]);
    expect(j).toHaveLength(3);
  });
});

describe('crewPlace', () => {
  const vrMoves = [{ start: '2026-10-08', end: null, crew: 'A', kind: 'placement' as const }];
  it('shows a VR Controller in the crew he is placed in, never as Day', () => {
    expect(crewPlace({ role: 'vr_controller', crew: null }, '2026-12-10', vrMoves).text).toBe('placed in A');
    expect(crewPlace({ role: 'vr_controller', crew: null }, '2026-10-01', vrMoves).text).toBe('not placed');
  });
  it('shows a temporary cover, day duty and a Controller shift cover with the own crew', () => {
    expect(crewPlace({ role: 'field_operator', crew: 'D' }, '2026-11-02', [{ start: '2026-11-01', end: '2026-11-05', crew: 'A', kind: 'temporary' }]).text).toBe('D · with A');
    expect(crewPlace({ role: 'field_operator', crew: 'B' }, '2026-11-02', [{ start: '2026-10-01', end: null, crew: 'DAY', kind: 'temporary' }]).text).toBe('B · day duty');
    expect(crewPlace({ role: 'controller', crew: 'A' }, '2026-11-02', [], 'B').text).toBe('A · covering B');
    expect(crewPlace({ role: 'panel_operator', crew: 'C' }, '2026-11-02', []).text).toBe('C');
  });
});
