// The tracker rules on the TR-2 seed (tracker v4 pack), against the test scenarios of the module plan (§10).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attention, banner, equipViews, reportText, shiftOf, shiftReport, stepViews, type TrkData, type TrkEquipment, type TrkLog, type TrkStep } from '..';
import { barchartRows, parseCsv } from '../csv';

const csv = (f: string) => parseCsv(readFileSync(new URL(`./fixtures/${f}.csv`, import.meta.url), 'utf8'));
const kw = (s: string) => `${s.replace(' ', 'T')}:00+03:00`;
const init = new Map(csv('initial_step_status_19oct').map((r) => [r.step_id, r.status]));
const ST: Record<string, TrkStep['status']> = { Done: 'done', 'In progress': 'in_progress' };
function seed(): TrkData {
  const steps: TrkStep[] = csv('steps').map((s) => ({ id: s.step_id, stepId: s.step_id, fo: s.fo, gate: Number(s.gate), gateName: s.gate_name, shortName: s.short_name, text: s.step_text,
    procedure: s.procedure || null, prereq: [s.prereq_1, s.prereq_2, s.prereq_3].filter(Boolean), estHours: s.est_hours ? Number(s.est_hours) : null, note: s.note || null, target: null,
    status: ST[init.get(s.step_id) ?? ''] ?? 'not_started', pendingReason: null, remark: null, updatedBy: null, updatedAt: null }));
  const equipment: TrkEquipment[] = csv('equipment').map((e, i) => ({ id: e.tag, tag: e.tag, group: e.group, description: e.description, fo: e.fo || null, hoStep: e.ho_step || null, procedure: e.procedure || null,
    barchartKey: e.barchart_key || null, opsItem: e.ops_handover_item === '1', critical: e.critical === '1', tracked: true, disabledReason: null,
    plannedHo: e.planned_ho ? kw(e.planned_ho) : null, plannedFinish: e.planned_finish ? kw(e.planned_finish) : null, sort: i, stage: e.tag === 'V-12-201' ? 2 : 0,
    pendingReason: null, remark: null, blindsIn: null, blindsOut: null, updatedBy: null, updatedAt: null }));
  const activities = barchartRows(csv('barchart_activities')).map((a, i) => ({ id: String(i), activityId: a.activity_id, group: a.group, key: a.equipment_key, activity: a.activity,
    durationH: Number(a.duration_h) || null, start: a.planned_start, finish: a.planned_finish, stage: a.stage === '' ? null : Number(a.stage), tracked: a.tracked !== '0' }));
  return { steps, equipment, iats: [], activities, log: [], settings: { hoTarget: '2026-10-20T07:00:00+03:00' } };
}
const at = (s: string) => Date.parse(kw(s));
const step = (d: TrkData, id: string) => d.steps.find((s) => s.stepId === id)!;
const eq = (d: TrkData, tag: string) => d.equipment.find((e) => e.tag === tag)!;
const view = (d: TrkData, tag: string, now = at('2026-10-20 10:00')) => equipViews(d, now).find((v) => v.eq.tag === tag)!;

describe('the seed', () => {
  it('loads the pack: 69 steps, 96 items (48 ops), 593 bar-chart activities, 23 logbook statuses', () => {
    const d = seed();
    expect([d.steps.length, d.equipment.length, d.equipment.filter((e) => e.opsItem).length, d.activities.length, d.steps.filter((s) => s.status !== 'not_started').length]).toEqual([69, 96, 48, 593, 23]);
  });
});

describe('§10 test scenarios', () => {
  it('1 · S325 done: V-12-209 handed over (stage 1), in progress, handover time = the step time', () => {
    const d = seed(); Object.assign(step(d, 'S325'), { status: 'done', updatedAt: '2026-10-20T08:15:00+03:00' });
    const v = view(d, 'V-12-209');
    expect([v.stage, v.flag, v.hoAt]).toEqual([1, 'IN_PROGRESS', '2026-10-20T08:15:00+03:00']);
  });
  it('2 · a pending reason on S322: E-216A/B pending with the step\'s reason', () => {
    const d = seed(); step(d, 'S322').pendingReason = 'Stuck / seized bolts';
    for (const t of ['E-12-216A', 'E-12-216B']) expect([view(d, t).flag, view(d, t).reason]).toEqual(['PENDING', 'Stuck / seized bolts (step)']);
  });
  it('3 · V-206 moved to box-up while S219 is open: CHECK HO STEP', () => {
    const d = seed(); eq(d, 'V-12-206').stage = 5;
    expect(view(d, 'V-12-206').flag).toBe('CHECK_HO');
  });
  it('4 · V-206 at box-up, S219 done, an open IAT: IAT OPEN; IAT closed: in progress', () => {
    const d = seed(); eq(d, 'V-12-206').stage = 5; step(d, 'S219').status = 'done';
    d.iats.push({ id: 'i1', tag: 'V-12-206', iatNo: 'IAT-1', jobText: 'weld repair', discipline: 'Mech', issuedAt: '2026-10-20T09:00:00+03:00', status: 'open', closedAt: null });
    expect(view(d, 'V-12-206').flag).toBe('IAT_OPEN');
    d.iats[0].status = 'closed';
    expect(view(d, 'V-12-206').flag).toBe('IN_PROGRESS');
  });
  it('5 · 20-Oct 10:00: only ready / in progress / pending steps are late, never a waiting one, PSVs and CVs never late', () => {
    const d = seed(); const now = at('2026-10-20 10:00');
    const sv = [...stepViews(d, now).values()];
    expect(sv.filter((v) => v.late).length).toBeGreaterThan(0);
    expect(sv.filter((v) => v.late).every((v) => ['READY', 'IN_PROGRESS', 'PENDING'].includes(v.state))).toBe(true);
    expect(sv.some((v) => v.state === 'WAITING' && v.late)).toBe(false);
    for (const v of equipViews(d, now).filter((e) => e.eq.group === 'PSVs' || e.eq.group === 'CV shells')) expect(v.late).toBe(false);
  });
  it('6 · S110 done: S114, S115, S117, S118 ready; S111 waits for S109, then is ready', () => {
    const d = seed(); step(d, 'S110').status = 'done';
    const now = at('2026-10-20 10:00'); let sv = stepViews(d, now);
    expect(['S114', 'S115', 'S117', 'S118'].map((s) => sv.get(s)!.state)).toEqual(['READY', 'READY', 'READY', 'READY']);
    expect([sv.get('S111')!.state, sv.get('S111')!.waitingFor]).toEqual(['WAITING', ['S109']]);
    step(d, 'S109').status = 'done'; sv = stepViews(d, now);
    expect(sv.get('S111')!.state).toBe('READY');
  });
  it('7 · an item switched off leaves Today, Plan % and Late', () => {
    const d = seed(); const now = at('2026-10-23 12:00');
    const before = equipViews(d, now); const late = before.find((e) => e.eq.tracked && e.eq.opsItem && e.late && e.plan)!;
    expect(late).toBeTruthy();
    const items = banner(before).items;
    eq(d, late.eq.tag).tracked = false;
    const after = equipViews(d, now);
    expect(attention(stepViews(d, now), after).some((a) => a.ref === late.eq.tag)).toBe(false);
    expect(banner(after).items).toBe(items - 1);
    for (const t of ['12-PSV-1403', '12-PSV-1404']) { eq(d, t).tracked = false; expect(attention(stepViews(d, now), equipViews(d, now)).some((a) => a.ref === t)).toBe(false); }
  });
  it('8 · the day shift report has exactly the three updates of the shift', () => {
    const d = seed(); const now = at('2026-10-20 15:00');
    const log: TrkLog[] = [
      { kind: 'step', ref: 'S106', field: 'status', oldValue: 'not_started', newValue: 'done', byName: 'Ctl', at: '2026-10-20T06:30:00+03:00' },   // night before
      { kind: 'step', ref: 'S203', field: 'status', oldValue: 'not_started', newValue: 'done', byName: 'Ctl', at: '2026-10-20T08:00:00+03:00' },
      { kind: 'step', ref: 'S315', field: 'status', oldValue: 'not_started', newValue: 'done', byName: 'Ctl', at: '2026-10-20T09:00:00+03:00' },
      { kind: 'equipment', ref: 'V-12-201', field: 'stage', oldValue: '2', newValue: '3', byName: 'Ctl', at: '2026-10-20T11:00:00+03:00' },
    ];
    d.log = log; for (const id of ['S203', 'S315']) step(d, id).status = 'done'; eq(d, 'V-12-201').stage = 3;
    const r = shiftReport(d, now, { notes: 'Scaffold at R-205', temps: { R205: '202', R201: '183' } });
    expect(r.stepsDone.map((s) => s.stepId)).toEqual(['S203', 'S315']);
    expect(r.stageChanges).toEqual([expect.objectContaining({ tag: 'V-12-201', from: 2, to: 3 })]);
    const text = reportText(r, { test: true, by: 'Ali' });
    expect(text.startsWith('[TEST] U-12 TR-2 SD · Tue 20 Oct · Day')).toBe(true);
    expect(text).toContain('Max bed °F 205:202 201:183');
  });
});

describe('plan vs actual', () => {
  it('R-205 (critical) on 23-Oct 12:00, not handed over: behind the bar chart', () => {
    const d = seed(); const v = view(d, 'R-12-205', at('2026-10-23 12:00'));
    expect(v.eq.critical).toBe(true);
    expect(v.plan!.planned).toBe(2);
    expect(v.plan!.variance).toBe(-2);
    expect(v.plan!.days).toBeGreaterThan(2);
  });
  it('the overall banner is behind when nothing moves, ahead when items run ahead of the plan', () => {
    const d = seed(); const now = at('2026-10-23 12:00');
    expect(banner(equipViews(d, now)).state).toBe('BEHIND');
    for (const e of d.equipment.filter((x) => x.opsItem)) e.stage = 5;
    expect(banner(equipViews(d, now)).state).toBe('AHEAD');
  });
});

describe('shifts', () => {
  it('day 07:00–19:00 and night 19:00–07:00 Kuwait, the night dated the day it starts', () => {
    expect(shiftOf(at('2026-10-20 07:00')).shift).toBe('D');
    expect(shiftOf(at('2026-10-20 18:59')).shift).toBe('D');
    expect([shiftOf(at('2026-10-20 19:00')).shift, shiftOf(at('2026-10-20 19:00')).date]).toEqual(['N', '2026-10-20']);
    expect([shiftOf(at('2026-10-21 03:00')).shift, shiftOf(at('2026-10-21 03:00')).date]).toEqual(['N', '2026-10-20']);
  });
});
