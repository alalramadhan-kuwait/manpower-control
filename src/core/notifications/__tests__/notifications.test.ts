import { describe, expect, it } from 'vitest';
import { actionCount, buildNotices, type NoticeInput } from '..';
import { coverageNeeds } from '../../controllers';
import { evaluateRange, type MpAbsence, type MpPerson } from '../../manpower';
import type { Crew } from '../../roster';

let seq = 0;
const person = (crew: Crew | null, role: MpPerson['role'], grade: number): MpPerson => ({ id: `p${++seq}`, employeeNumber: String(seq), name: `Person ${seq}`, role, crew, grade, employmentType: 'knpc',
  takeCharge: role === 'field_operator' ? 'yes' : null, panelQualified: role === 'panel_operator' ? 'yes' : null, actingController: null });
const crew = (c: Crew, field: number) => [person(c, 'controller', 16), person(c, 'panel_operator', 14), ...[1, 2].map(() => person(c, 'panel_operator', 12)), ...Array.from({ length: field }, () => person(c, 'field_operator', 10))];
const A = crew('A', 5), B = crew('B', 7), C = crew('C', 7), D = crew('D', 7);  // A is short in Field every duty
const people = [...A, ...B, ...C, ...D];
const leave = (p: MpPerson, start: string, end: string): MpAbsence => ({ employeeId: p.id, start, end, status: 'approved', typeCode: 'annual_leave_planned', typeLabel: 'PV', typeShort: 'PV', inCurrentPlan: true });

const base = (over: Partial<NoticeInput> = {}): NoticeInput => {
  const absences = over.absences ?? [];
  return { today: '2026-09-25', days: evaluateRange('2026-09-25', '2026-10-10', people, absences), needs: coverageNeeds('2026-09-25', '2026-10-10', people, absences, []),
    requests: [], needsAction: 0, absences, people, plan: { modes: [], periods: [] }, isSectionHead: true, ...over };
};

describe('notification center', () => {
  it('a crew short on every duty becomes one shortage notice per period', () => {
    const n = buildNotices(base());
    const short = n.filter((x) => x.area === 'shortage');
    expect(short.length).toBeGreaterThan(0);
    expect(short.every((x) => x.level === 'action' && x.title.startsWith('A Shift short · Field 5 of 6'))).toBe(true);
    expect(short[0].to).toMatch(/^\/\?date=2026-/);
  });
  it('a Controller on leave with no cover asks for a cover, naming a free VR', () => {
    const vr = person(null, 'vr_controller', 16);
    const absences = [leave(B[0], '2026-10-01', '2026-10-06')];
    const n = buildNotices(base({ people: [...people, vr], absences, days: evaluateRange('2026-09-25', '2026-10-10', [...people, vr], absences), needs: coverageNeeds('2026-09-25', '2026-10-10', [...people, vr], absences, []) }));
    const cover = n.find((x) => x.area === 'controller')!;
    expect(cover).toMatchObject({ level: 'action', title: 'Cover needed · B Shift' });
    expect(cover.detail).toContain(`Move VR ${vr.name}`);
    expect(cover.to).toBe(`/controllers?assign=cover&crew=B&from=${cover.date}`);
  });
  it('requests: review is an action for everyone; the decision is an action only for the Section Head', () => {
    const requests = [{ id: 'r1', employeeName: 'Person X', typeLabel: 'Unscheduled', start: '2026-10-02', end: '2026-10-03', status: 'reviewed' as const, overtime: true }];
    expect(buildNotices(base({ requests })).find((x) => x.id === 'req-r1')).toMatchObject({ level: 'action', title: 'Waiting for your decision' });
    expect(buildNotices(base({ requests, isSectionHead: false })).find((x) => x.id === 'req-r1')).toMatchObject({ level: 'watch' });
  });
  it('a reschedule request is the Section Head\'s to decide and says when the crew would be short', () => {
    const changes = [{ id: 'c1', employeeName: 'Person X', oldStart: '2026-10-02', oldEnd: '2026-10-08', newStart: '2026-10-09', newEnd: '2026-10-15', short: 2, clash: 0 }];
    expect(buildNotices(base({ changes })).find((x) => x.id === 'chg-c1')).toMatchObject({ level: 'action', title: 'Reschedule request to decide', to: '/requests?view=forms' });
    expect(buildNotices(base({ changes })).find((x) => x.id === 'chg-c1')?.detail).toContain('crew short 2d');
    expect(buildNotices(base({ changes, isSectionHead: false })).find((x) => x.id === 'chg-c1')).toMatchObject({ level: 'watch' });
  });
  it('leave with estimated dates is a reminder until the final notice, an action once it is about to start', () => {
    const estimated = [{ id: 'e1', employeeId: 'x', employeeName: 'Person X', start: '2026-10-20', end: '2026-10-30' }, { id: 'e2', employeeId: 'y', employeeName: 'Person Y', start: '2026-10-01', end: '2026-10-10' }];
    const n = buildNotices(base({ estimated }));
    expect(n.find((x) => x.id === 'est-e1')).toMatchObject({ level: 'watch', title: 'Leave dates still an estimate', to: '/employees/x' });
    expect(n.find((x) => x.id === 'est-e2')).toMatchObject({ level: 'action' });
  });
  it('actions come first and only actions count in the badge; leave starting soon is info', () => {
    const n = buildNotices(base({ needsAction: 3, absences: [leave(C[5], '2026-09-28', '2026-10-02')] }));
    const levels = n.map((x) => x.level);
    expect(levels).toEqual([...levels].sort((a, b) => ['action', 'watch', 'info'].indexOf(a) - ['action', 'watch', 'info'].indexOf(b)));
    expect(n.find((x) => x.area === 'leave')).toMatchObject({ level: 'info', title: '1 leave starting · next 7 days' });
    expect(actionCount(n)).toBe(n.filter((x) => x.level === 'action').length);
    expect(n.find((x) => x.id === 'staff-action')!.title).toBe('3 staff records to complete');
  });
  it('Oracle HR: rejected and not-yet-approved leave starting within 30 days', () => {
    const o = (p: MpPerson, start: string, oracle: MpAbsence['oracle']): MpAbsence => ({ ...leave(p, start, start), oracle });
    const absences = [o(B[4], '2026-10-01', 'not_submitted'), o(B[5], '2026-10-03', 'submitted'), o(C[4], '2026-10-08', 'rejected'), o(C[5], '2026-10-02', 'approved'), o(D[4], '2026-12-01', 'not_submitted')];
    const n = buildNotices(base({ absences }));
    expect(n.find((x) => x.id.startsWith('oracle-rej'))).toMatchObject({ level: 'action', title: '1 leave rejected in Oracle', to: '/oracle?s=rejected' });
    const w = n.find((x) => x.id === 'oracle-2026-09-25')!;
    expect(w).toMatchObject({ level: 'action', title: '2 leaves not approved in Oracle · next 30 days', to: '/requests?view=leave' });
    expect(w.detail).toBe(`${B[4].name} 1 Oct · ${B[5].name} 3 Oct`);
  });
  it('Controller leave rules: one grouped notice each; actions for the Section Head only', () => {
    const controllerLeave = { overlaps: [{ a: 'Jasem Sadeq', b: 'Muath Malallah', start: '2026-12-07', end: '2026-12-14', days: 8 }], extras: [{ name: 'Yaser Asiri', nth: 5, year: 2027, start: '2027-09-01', end: '2027-09-04' }] };
    const head = buildNotices(base({ controllerLeave }));
    expect(head.find((x) => x.id.startsWith('ctl2-'))).toMatchObject({ level: 'action', title: '2 Controllers on leave together · 1×', detail: 'Jasem + Muath 7 Dec – 14 Dec · needs your approval', to: '/controllers/board?month=2026-12' });
    expect(head.find((x) => x.id.startsWith('ctlx-'))).toMatchObject({ level: 'action', title: 'Controller leave over 4 a year · 1×', detail: 'Yaser (leave 5) 1 Sep · needs your approval' });
    expect(buildNotices(base({ controllerLeave, isSectionHead: false })).find((x) => x.id.startsWith('ctl2-'))!.level).toBe('watch');
  });
});

describe('shutdown team not complete', () => {
  it('is an action with the days short and the places, linking to the plan', () => {
    const n = buildNotices({ ...base(), shutdowns: [{ id: 'sp1', title: 'Train-2 SD', start: '2026-11-01', end: '2026-11-30', shortDays: 12, gaps: [{ team: 'Day', label: 'Senior FO', days: 12 }] }] });
    expect(n.find((x) => x.id === 'sd-gap-sp1')).toMatchObject({ level: 'action', area: 'shortage', title: 'Train-2 SD · team not complete', to: '/shutdown/sp1' });
    expect(n.find((x) => x.id === 'sd-gap-sp1')!.detail).toContain('12 days short');
  });
});
