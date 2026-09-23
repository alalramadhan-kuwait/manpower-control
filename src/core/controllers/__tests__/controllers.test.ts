import { describe, expect, it } from 'vitest';
import { checkCandidates, coverageNeeds, maxEndDate } from '..';
import type { MpAbsence, MpAssignment, MpPerson } from '../../manpower';

const P = (id: string, role: MpPerson['role'], crew: MpPerson['crew'], grade: number | null = 16): MpPerson =>
  ({ id, employeeNumber: id, name: id, role, crew, grade, employmentType: 'knpc', takeCharge: null, panelQualified: null, actingController: null });
const leave = (employeeId: string, start: string, end: string): MpAbsence => ({ employeeId, start, end, status: 'approved', typeCode: 'annual_leave_planned', inCurrentPlan: true });
const crew = (c: 'A' | 'B' | 'C' | 'D') => [P(`ctrl${c}`, 'controller', c), ...[1, 2, 3, 4].map((i) => P(`p${c}${i}`, 'panel_operator', c, i === 1 ? 14 : 13)), ...[1, 2, 3, 4, 5, 6, 7].map((i) => P(`f${c}${i}`, 'field_operator', c, 11))]
  .map((p) => ({ ...p, panelQualified: p.role === 'panel_operator' ? 'yes' as const : null, takeCharge: p.role === 'field_operator' ? 'yes' as const : null }));
const people = [...crew('A'), ...crew('B'), ...crew('C'), ...crew('D'), P('vr', 'vr_controller', null), P('mc', 'morning_controller', null, 15)];

describe('maximum 2 months', () => {
  it('ends the day before the same date two months later (PostgreSQL month arithmetic)', () => {
    expect(maxEndDate('2026-10-01')).toBe('2026-11-30');
    expect(maxEndDate('2026-10-15')).toBe('2026-12-14');
    expect(maxEndDate('2026-12-31')).toBe('2027-02-27');
    expect(maxEndDate('2027-12-31')).toBe('2028-02-28');
  });
});

describe('coverage needs', () => {
  it('joins the duty days of one absence into one period and names who is away', () => {
    const needs = coverageNeeds('2026-09-20', '2026-10-10', people, [leave('ctrlA', '2026-09-22', '2026-10-05')], []);
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ crew: 'A', who: ['ctrlA'] });
    expect(needs[0].start >= '2026-09-22' && needs[0].end <= '2026-10-05').toBe(true);
  });
  it('disappears once a cover is recorded', () => {
    const cover: MpAssignment = { id: 'x', kind: 'shift_cover', employeeId: 'vr', crew: 'A', start: '2026-09-22', end: '2026-10-05' };
    expect(coverageNeeds('2026-09-20', '2026-10-10', people, [leave('ctrlA', '2026-09-22', '2026-10-05')], [cover])).toEqual([]);
  });
  it('a Morning rotation creates a need on the rotated Controller\'s crew', () => {
    const rot: MpAssignment = { id: 'r', kind: 'morning_rotation', employeeId: 'ctrlB', crew: null, start: '2026-10-01', end: '2026-10-20' };
    const needs = coverageNeeds('2026-10-01', '2026-10-20', people, [], [rot]);
    expect(needs.map((n) => n.crew)).toEqual(['B']);
  });
});

describe('who can cover', () => {
  it('puts the free VR first; blocks own crew, low grade and anyone already assigned', () => {
    const low = P('low', 'controller', 'D', 14);
    const busy: MpAssignment = { id: 'b', kind: 'shift_cover', employeeId: 'mc', crew: 'C', start: '2026-10-03', end: '2026-10-04' };
    const list = checkCandidates('shift_cover', 'A', '2026-10-01', '2026-10-10', [...people.filter((p) => p.id !== 'ctrlD'), low], [], [busy]);
    expect(list[0].person.id).toBe('vr');
    expect(list[0].blocked).toEqual([]);
    const by = (id: string) => list.find((c) => c.person.id === id)!;
    expect(by('ctrlA').blocked).toContain('Own crew');
    expect(by('low').blocked.join()).toContain('Grade 15+ required');
    expect(by('mc').blocked.join()).toContain('Already covering C Shift');
    expect(by('ctrlB').warnings.join()).toContain('Own crew (B) loses them');
  });
  it('warns when the candidate is on leave during the period', () => {
    const list = checkCandidates('shift_cover', 'A', '2026-10-01', '2026-10-10', people, [leave('vr', '2026-10-05', '2026-10-20')], []);
    expect(list.find((c) => c.person.id === 'vr')!.warnings).toEqual(['On leave 6 of these days']);
  });
});

describe('Stage H corrections', () => {
  it('shift cover has no length limit unless one is configured', async () => {
    const { shiftCoverMaxEnd } = await import('..');
    expect(shiftCoverMaxEnd('2026-10-01', null)).toBeNull();
    expect(shiftCoverMaxEnd('2026-10-01', 30)).toBe('2026-10-30');
  });
  it('the Morning Controller covering a shift leaves the Morning post needing cover; a Morning rotation resolves it', () => {
    const cover: MpAssignment = { id: 'c', kind: 'shift_cover', employeeId: 'mc', crew: 'A', start: '2026-10-01', end: '2026-10-05' };
    const needs = coverageNeeds('2026-10-01', '2026-10-05', people, [leave('ctrlA', '2026-10-01', '2026-10-05')], [cover]);
    expect(needs.map((n) => [n.kind, n.start, n.end])).toEqual([['morning', '2026-10-01', '2026-10-05']]);
    const rot: MpAssignment = { id: 'r', kind: 'morning_rotation', employeeId: 'ctrlD', crew: null, start: '2026-10-01', end: '2026-10-05' };
    const after = coverageNeeds('2026-10-01', '2026-10-05', people, [leave('ctrlA', '2026-10-01', '2026-10-05')], [cover, rot]);
    expect(after.some((n) => n.kind === 'morning')).toBe(false);
  });
  it('two overlapping gaps and one VR: the first gets the VR, the second is Additional Controller required', () => {
    const needs = coverageNeeds('2026-12-01', '2026-12-20', people, [leave('ctrlC', '2026-12-01', '2026-12-14'), leave('ctrlB', '2026-12-07', '2026-12-20')], []);
    const c = needs.find((n) => n.crew === 'C')!; const b = needs.find((n) => n.crew === 'B')!;
    expect(c).toMatchObject({ additional: false }); expect(c.vr?.id).toBe('vr');
    expect(b).toMatchObject({ additional: true, vr: null });
    expect(b.vrNote).toContain('VR covers C Shift');
  });
  it('a VR on leave for the whole gap is not offered', () => {
    const needs = coverageNeeds('2026-12-01', '2026-12-14', people, [leave('ctrlC', '2026-12-01', '2026-12-14'), leave('vr', '2026-11-25', '2026-12-20')], []);
    expect(needs[0]).toMatchObject({ additional: true, vrNote: 'VR on leave' });
  });
});

describe('VR partly on leave', () => {
  it('is still suggested, with the leave shown, and is not called free', () => {
    const needs = coverageNeeds('2026-12-01', '2026-12-14', people, [leave('ctrlC', '2026-12-01', '2026-12-14'), leave('vr', '2026-11-25', '2026-12-05')], []);
    expect(needs[0].vr?.id).toBe('vr');
    expect(needs[0].additional).toBe(false);
    expect(needs[0].vrNote).toContain('on leave part of this period');
  });
});
