import { describe, expect, it } from 'vitest';
import { gateDates, gateProposal, gateVerdict, isFactual, OPEN_CHECK_DAYS, overrideNote } from '../gate';
import type { Finding } from '../../validation';

const f = (rule: Finding['rule'], severity: Finding['severity']): Finding => ({ rule, severity, message: rule, key: rule } as Finding);

describe('server check verdict', () => {
  it('hard stop never allowed', () => { expect(gateVerdict([f('max_consecutive_duty_days', 'hard_stop')], true).allowed).toBe(false); });
  it('a new shortage blocks a normal change; only the Section Head may go ahead, with a reason (overridable)', () => {
    expect(gateVerdict([f('crew_minimum', 'critical')], false)).toMatchObject({ allowed: false, overridable: true });
  });
  it('a hard stop is never overridable, even alongside a shortage', () => {
    expect(gateVerdict([f('crew_minimum', 'critical'), f('min_rest_hours', 'hard_stop')], false)).toMatchObject({ allowed: false, overridable: false });
  });
  it('the override reason is kept in plain words', () => { expect(overrideNote('  cover by phone ')).toBe('Below the minimum, accepted by the Section Head: cover by phone'); });
  it('a factual operational absence is recorded even when a crew falls short', () => { expect(gateVerdict([f('crew_minimum', 'critical')], true).allowed).toBe(true); });
  it('warnings pass', () => { expect(gateVerdict([f('leave_overlap', 'warning')], false).allowed).toBe(true); });
});

describe('what is checked', () => {
  const base = { employeeId: 'p', typeShort: 'INJ', entryMode: 'tracked' };
  it('an open absence is checked over the next days and stays unavailable', () => {
    const pr = gateProposal({ ...base, type: 'absence', detail: { absence_type_code: 'injury', start_date: '2026-10-12', end_date: null, action: 'new' } });
    expect(pr).toMatchObject({ kind: 'absence', start: '2026-10-12' });
    expect(pr!.end).toBe('2027-01-10');
    expect(OPEN_CHECK_DAYS).toBe(90);
  });
  it('an extension checks only the added days; return and cancel give people back', () => {
    expect(gateProposal({ ...base, type: 'absence', detail: { start_date: '2026-10-01', end_date: '2026-10-20', old_end: '2026-10-14', action: 'extend' } })).toMatchObject({ start: '2026-10-15', end: '2026-10-20' });
    expect(gateProposal({ ...base, type: 'absence', detail: { start_date: '2026-10-01', end_date: '2026-10-11', action: 'return' } })).toBeNull();
    expect(gateProposal({ ...base, type: 'absence', detail: { start_date: '2026-10-01', end_date: '2026-10-11', action: 'cancel' } })).toBeNull();
  });
  it('factual only for tracked new / extend', () => {
    expect(isFactual({ ...base, type: 'absence', detail: { action: 'new' } })).toBe(true);
    expect(isFactual({ ...base, entryMode: 'fixed', type: 'absence', detail: { action: 'new' } })).toBe(false);
  });
  it('a shift move ends the day before the return date', () => {
    expect(gateDates({ start_date: '2026-11-01', return_date: '2026-11-08' })).toEqual({ start: '2026-11-01', end: '2026-11-07' });
  });
});
