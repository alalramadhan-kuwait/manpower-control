// The tracker rules on the TR-2 seed (tracker v4 pack), against the test scenarios of the module plan (§10).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { logText, spanText, tidyStep, noteCurrent, relatedWork, askText, staleItems, equipBlind, linkedStep, miWeighted, neutName, partsOf, waitingSteps, attention, planVsActual, focusList, iatChecks, iatStatus, lineOnEquipment, lineStreams, loopLines, luKeys, luTag, streamItems, sortActs, isoState, missingBlinds, nextStep, blindLink, miBlinds, criticalHandover, isolationOf, neutLink, opsProgress, opsResults, pointComplete, soakLeft, type TrkPoint, banner, equipViews, reportText, leaderReportText, shiftOf, shiftReport, stepViews, phases, stepTiming, stepTimingCsv, timing, timingCsv, timingSummary, type TrkData, type TrkEquipment, type TrkLog, type TrkStep } from '..';
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
  it('3 · V-206 blinded and moved to box-up while S219 is open: in progress (blinded = handed over, no check flag)', () => {
    const d = seed(); Object.assign(eq(d, 'V-12-206'), { stage: 5, blindsIn: '2026-10-20T09:00:00+03:00' });
    const v = view(d, 'V-12-206');
    expect([v.stage, v.flag, v.hoAt]).toEqual([5, 'IN_PROGRESS', '2026-10-20T09:00:00+03:00']);
  });
  it('3c · R-12-205 blinded (stage tap) without S110 done: the critical handover, M & I starts at the blinds-in time', () => {
    const d = seed(); for (const e of d.equipment) e.critical = e.tag === 'R-12-205';
    Object.assign(eq(d, 'R-12-205'), { stage: 1, blindsIn: '2026-10-20T10:00:00+03:00' }); step(d, 'S110').status = 'not_started';
    const r = criticalHandover(d, stepViews(d, Date.parse('2026-10-20T12:00:00+03:00')));
    expect([r.at, r.critical.map((c) => c.done)]).toEqual([Date.parse('2026-10-20T10:00:00+03:00'), [true]]);
  });
  it('3b · the blind and deblind bar-chart lines are the stage, a combined blind + open line is a work step', () => {
    expect([blindLink({ activity: 'Blind', stage: 1 }), blindLink({ activity: 'Box-up & Deblind', stage: 6 }), blindLink({ activity: 'Blind, Remove elbow & Top trays', stage: 2 }), blindLink({ activity: 'Entry Permit', stage: 1 })]).toEqual([null, 6, null, null]);
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
    expect(text.split('\n').slice(0, 2)).toEqual(['*[TEST] Unit-12 Train-2 shutdown report*', '_20 Oct 2026 · Day shift · 15:00_']);
    expect(text).toContain('\n*Reactors*\n- R-205: ');
    expect(text).toContain('*Max bed temperature*\n- R-205: 202°F\n- R-201: 183°F');
    expect(text).toContain('*Vessels*\n- V-201: Under inspection');
    expect(text).toContain('*Notes*\nScaffold at R-205');
    expect(text.trimEnd().endsWith('— Ali')).toBe(true);
    expect(text).not.toMatch(/ {2,}/);
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

describe('mechanical activity timing', () => {
  const a = { id: '1', activityId: 'A5410', group: 'Reactors', key: 'R-12-205', activity: 'Dump Catalyst by Double Vacuum', durationH: 120, start: '2026-10-23T03:00:00+03:00', finish: '2026-10-28T03:00:00+03:00', stage: 2, tracked: true };
  it('not started after its planned start: late start', () => {
    const t = timing(a, at('2026-10-23 12:00'));
    expect([t.state, t.plannedH, t.lateStart, t.actualH]).toEqual(['NOT_STARTED', 120, true, null]);
  });
  it('started 9 h late, finished in 130 h: delay +9 h, overrun +10 h', () => {
    const t = timing({ ...a, actualStart: '2026-10-23T12:00:00+03:00', actualFinish: '2026-10-28T22:00:00+03:00' }, at('2026-10-30 10:00'));
    expect([t.state, t.startDelayH, t.actualH, t.overrunH]).toEqual(['FINISHED', 9, 130, 10]);
    expect(timingSummary([t, timing(a, at('2026-10-30 10:00'))])).toEqual({ total: 2, started: 1, finished: 1, running: 0, avgStartDelayH: 9, avgOverrunH: 10 });
  });
  it('the record for future reference: one CSV line per activity, Kuwait time', () => {
    const csvText = timingCsv([timing({ ...a, actualStart: '2026-10-23T12:00:00+03:00', actualNote: 'vacuum truck late, 2 h' }, at('2026-10-24 12:00'))]);
    const [head, line] = csvText.split('\n');
    expect(head.startsWith('equipment,activity_id,activity,stage,planned_start')).toBe(true);
    expect(line).toBe('R-12-205,A5410,Dump Catalyst by Double Vacuum,2,2026-10-23 03:00,2026-10-28 03:00,120,2026-10-23 12:00,,,9,,"vacuum truck late, 2 h",');
  });
  it('the shift report counts the activities started and finished in the shift', () => {
    const d = seed(); d.log = [{ kind: 'activity', ref: 'R-12-205 · A5410', field: 'actual_start', oldValue: null, newValue: '2026-10-23T09:00:00+03:00', byName: 'Ctl', at: '2026-10-23T09:05:00+03:00' }];
    const r = shiftReport(d, at('2026-10-23 12:00'), null);
    expect(r.activities.length).toBe(1);
    expect(reportText(r)).toContain('- R-205: ');
    expect(reportText(r)).not.toContain('Mechanical');
  });
  it('the report carries the drums of a reactor dumping: verified total and this shift', () => {
    const d = seed();
    const sc = { id: 'sc', key: 'R-12-205', scope: 'removal' as const, unit: 'drums', low: 2300, high: 2600, initial: 2600, working: 2600, activityIds: ['A5410'], completeAt: null, completeBy: null };
    const e = (q: number, date: string, shift: 'D' | 'N', verify: 'verified' | 'pending') => ({ id: `${q}${shift}`, scopeId: 'sc', shiftDate: date, shift, kind: 'removal' as const, method: 'vacuum' as const, qty: q, verify,
      remark: null, source: 'field' as const, enteredBy: null, enteredByName: null, enteredAt: '', verifiedByName: null, verifiedAt: null });
    d.engine = { scopes: [sc], entries: [e(150, '2026-10-22', 'N', 'verified'), e(170, '2026-10-23', 'D', 'pending')], estimates: [], updates: [] };
    const text = reportText(shiftReport(d, at('2026-10-23 12:00'), null));
    expect(text).toContain('*Catalyst removal (drums)*');
    expect(text).toContain('- R-205: 150/2,600 drums (5.8%) · this shift +170 · 1 awaiting verification');
  });
});

describe('report wording', () => {
  it('a problem on an item is listed under Issues with its start time, apart from the note', () => {
    const d = seed();
    d.events = [{ id: 'x', category: 'reactors', text: 'High temp in one bed', startedAt: '2026-10-23T11:40:00+03:00', endedAt: null, by: 'Eng', endedBy: null, key: 'R-12-205' }];
    const text = reportText(shiftReport(d, at('2026-10-23 13:00'), null));
    expect(text).toContain('*Issues*\n- R-205: High temp in one bed (since 11:40)');
    expect(text.indexOf('*Issues*')).toBeGreaterThan(text.indexOf('*Reactors*'));
  });
  it('bar-chart steps read in sentence case, short forms spelled out, tags kept', () => {
    expect(tidyStep('Pump Suc Line & Suc Stainer Cleaning')).toBe('Pump suction line & suction strainer cleaning');
    expect(tidyStep('Dump Catalyst by Double Vacuum')).toBe('Dump catalyst by double vacuum');
    expect(tidyStep('Hydro blasting for shell internal')).toBe('Hydro blasting for shell internal');
    expect(tidyStep('Check The N2 Pre-Charge Pressure In Bladder Accumulator')).toBe('Check the N2 Pre-Charge pressure in bladder accumulator');
  });
  it('a note older than the item\'s latest step start or finish gives way to the steps', () => {
    const d = seed(); const e = d.equipment.find((x) => x.tag === 'R-12-205')!;
    Object.assign(e, { remark: 'Parts removal I/P', updatedAt: '2026-10-23T08:00:00+03:00' });
    expect(noteCurrent(e, d, at('2026-10-23 12:00'))).toBe(true);
    Object.assign(d.activities.find((a) => a.key === 'R-12-205')!, { actualStart: '2026-10-23T09:00:00+03:00' });
    expect(noteCurrent(e, d, at('2026-10-23 12:00'))).toBe(false);
  });
});

describe('change log in words', () => {
  const L = (kind: string, ref: string, field: string, oldValue: string | null, newValue: string | null) => ({ kind, ref, field, oldValue, newValue, byName: 'Aad323', at: '2026-10-23T10:00:00Z' }) as Parameters<typeof logText>[0];
  it('says what changed on which item', () => {
    const acts = [{ id: 'a', activityId: 'A1', key: 'E-12-207', activity: 'Hydroblasting', group: null, durationH: 1, start: null, finish: null, stage: null, tracked: true }];
    expect(logText(L('activity', 'E-12-207 · A1', 'actual_finish', null, '2026-10-23T10:00:00+00:00'), acts)).toEqual({ item: 'E-207', what: '✓ finished Hydroblasting' });
    expect(logText(L('equipment', 'R-12-205', 'note', 'old', 'Vacuum dumping stopped'))).toEqual({ item: 'R-205', what: '📝 note "Vacuum dumping stopped"' });
    expect(logText(L('equipment', 'V-12-212', 'stage', '0', '1')).what).toBe('stage Not HO → HO');
    expect(logText(L('qty', 'R-12-203 removal 2026-10-23 D', 'removal', null, '2 free_fall'))).toEqual({ item: 'R-203', what: '🛢 2 drums (2026-10-23 D)' });
    expect(logText(L('event', 'V-12-209', 'event ended', null, 'Last gas test failed')).what).toBe('✓ issue resolved "Last gas test failed"');
    expect(logText(L('shift', '2026-10-23 D', 'temperatures', null, '{"R205":"700","R203":""}')).what).toBe('🌡 R-205 700°F');
  });
});

describe('step timing', () => {
  it('estimate vs taken: started 08:00, done 14:30 against 4 h is +2.5 h; running counts to now', () => {
    const d = seed(); const s = { ...step(d, 'S321'), startedAt: '2026-10-21T08:00:00+03:00', doneAt: '2026-10-21T14:30:00+03:00' };
    expect(stepTiming(s, at('2026-10-22 10:00'))).toMatchObject({ estH: 4, actualH: 6.5, overrunH: 2.5, running: false });
    expect(stepTiming({ ...s, doneAt: null }, at('2026-10-21 10:00'))).toMatchObject({ actualH: 2, running: true, overrunH: null });
    expect(stepTimingCsv([stepTiming(s, at('2026-10-22 10:00'))]).split('\n')[1]).toBe('S321,FO3,7,E-216A/B S/S neutralization,SOP-12-2018,4,2026-10-21 08:00,2026-10-21 14:30,6.5,2.5,');
  });
});

describe('the two parts of the shutdown: operations end, M & I starts, at the R-205 handover', () => {
  const settings = { hoTarget: '2026-10-20T07:00:00+03:00', opsStart: '2026-10-16T07:00:00+03:00', miStart: '2026-10-20T07:00:00+03:00' };
  it('before the handover: operations day 3 of 4 on 18-Oct 19:00 (time gone vs steps done), M & I waiting', () => {
    const d = { ...seed(), settings }; const now = at('2026-10-18 19:00');
    const { ops, mi } = phases(d, now);
    expect([ops!.day, ops!.days, ops!.planPct, ops!.actualPct, ops!.state]).toEqual([3, 4, 63, 29, 'BEHIND']);
    expect([mi.actualStart, mi.critical]).toEqual([null, [{ tag: 'R-12-205', hoStep: 'S110', done: false }]]);
    expect(reportText(shiftReport(d, at('2026-10-19 10:00'), null))).toContain('- R-205: Not handed over');
  });
  it('S110 done 20-Oct 10:00: operations done (+3 h), M & I started then, its plan measured from that start', () => {
    const d = { ...seed(), settings }; Object.assign(step(d, 'S110'), { status: 'done', doneAt: '2026-10-20T10:00:00+03:00' });
    const now = at('2026-10-21 10:00');
    const { ops, mi } = phases(d, now);
    expect([ops!.state, ops!.finishDelayH]).toEqual(['DONE', 3]);
    expect([mi.actualStart, mi.delayH]).toEqual([Date.parse('2026-10-20T10:00:00+03:00'), 3]);
    expect(mi.banner).not.toBeNull();
    expect(reportText(shiftReport(d, now, null))).toContain('📊 Handover ');
  });
});

describe('isolation & neutralization', () => {
  const pt = (o: Partial<TrkPoint>): TrkPoint => ({ id: o.ref ?? 'x', kind: 'blind', grp: null, ref: 'SEG-1', name: '', detail: null, fo: 'FO1', stepId: null, items: [], beforeHo: true, sort: 0, status: 'open',
    inAt: null, outAt: null, fillAt: null, soakAt: null, drainAt: null, doneAt: null, soakH: null, remark: null, updatedBy: null, updatedAt: null, ...o });
  it('an item is ready (handed over) when its neutralization before handover is done and its linked blinds are in', () => {
    const pts = [pt({ ref: 'SEG-12', items: ['E-12-205'], status: 'in' }), pt({ ref: 'SEG-13', items: ['E-12-205'], status: 'open' }),
      pt({ kind: 'neut', ref: 'E-12-205', items: ['E-12-205'], status: 'soaking' }), pt({ kind: 'neut', ref: 'H-12-202', items: ['H-12-202'], beforeHo: false })];
    expect(isolationOf('E-12-205', pts)).toMatchObject({ blindsIn: 1, neutDone: 0, ready: false });
    pts[2].status = 'done';
    expect(isolationOf('E-12-205', pts)?.ready).toBe(false);   // SEG-13 not in yet
    pts[1].status = 'in';
    expect(isolationOf('E-12-205', pts)?.ready).toBe(true);
    expect(isolationOf('H-12-202', pts)?.ready).toBe(false);
    expect(isolationOf('V-12-201', pts)).toBeNull();
    expect([pointComplete({ kind: 'blind', status: 'out' }), pointComplete({ kind: 'neut', status: 'draining' })]).toEqual([true, false]);
  });
  it('the soak timer, and the soda-ash lines moved by the neutralization', () => {
    const p = pt({ kind: 'neut', status: 'soaking', soakH: 4, soakAt: '2026-10-21T10:00:00+03:00' });
    expect([soakLeft(p, at('2026-10-21 12:30')), soakLeft(p, at('2026-10-21 14:30'))]).toEqual([1.5 * 36e5, -0.5 * 36e5]);
    expect([neutLink({ activity: 'Soda ash soaking' }), neutLink({ activity: 'Neutralize with 2% soda ash.' }), neutLink({ activity: 'H-Blast Tube bundle using 2% soda ash' })]).toEqual([true, true, false]);
  });
  it('operations % = neutralized + items handed over (the guideline steps only without them), blinds are M & I', () => {
    const d = seed();
    d.points = [pt({ ref: 'A', status: 'in' }), pt({ ref: 'B' }), pt({ kind: 'neut', ref: 'N', status: 'done' }), pt({ kind: 'neut', ref: 'H', beforeHo: false })];
    const now = at('2026-10-18 07:00'); const sv = stepViews(d, now); const r = opsResults(d, equipViews(d, now, sv))!;
    expect(r.neut).toEqual([1, 1]);
    expect(miBlinds(d)).toMatchObject({ segregation: [1, 2], hp: [0, 0] });
    const o = opsProgress(sv, { opsStart: '2026-10-16T07:00:00+03:00', miStart: '2026-10-20T07:00:00+03:00' }, now, null, r)!;
    expect(o.actualPct).toBe(Math.round(r.done / r.total * 100));
  });
});

describe('next step on an item (needs attention)', () => {
  const eq = { tag: 'R-12-201', barchartKey: null, hoStep: 'S222' } as TrkEquipment;
  const v = (stage: number) => ({ eq, stage } as Parameters<typeof nextStep>[0]);
  const a = (id: string, group: string, actualStart: string | null = null, actualFinish: string | null = null) =>
    ({ id, activityId: id, group, key: 'R-12-201', activity: `step ${id}`, tracked: true, stage: 1, start: '2026-10-20T07:00:00Z', actualStart, actualFinish } as Parameters<typeof nextStep>[1][number]);
  it('before the handover: the first unfinished operations step, running or not', () => {
    expect(nextStep(v(0), [a('OP-02', 'Operations'), a('OP-01', 'Operations', 'x', 'y'), a('B1', 'Mech')])).toEqual({ text: 'step OP-02', running: false, n: 2, of: 2 });
    expect(nextStep(v(0), [a('OP-01', 'Operations', 'x')])?.running).toBe(true);
  });
  it('then the neutralization, then the handover step; after the handover the bar chart', () => {
    const p = { kind: 'neut', beforeHo: true, items: ['R-12-201'], ref: 'S111', status: 'filling' } as TrkPoint;
    expect(nextStep(v(0), [a('OP-01', 'Operations', 'x', 'y')], [p])?.text).toBe('Neutralize S111 · Filling');
    expect(nextStep(v(0), [])?.text).toBe('Hand over (S222)');
    expect(nextStep(v(1), [a('OP-01', 'Operations'), a('B1', 'Mech')])?.text).toBe('step B1');
  });
});

describe('focus order (needs attention)', () => {
  const ev = (tag: string, group: string, critical = false) => ({ eq: { tag, group, critical, barchartKey: null, hoStep: null }, stage: 0 } as Parameters<typeof focusList>[1][number]);
  const at = (tag: string) => ({ kind: 'equipment', ref: tag, label: tag, detail: '1 h', flag: 'HO_LATE', rank: 1, at: 3600e3 } as Parameters<typeof focusList>[0][number]);
  it('main items before parts and misc, critical first, the compressor before the pumps', () => {
    const eqs = [ev('12-VC-0106', 'Check valves'), ev('C-12-201', 'Compressor'), ev('C-12-201-E-01A', 'Pumps / LO'), ev('P-12-203', 'Pumps / LO'), ev('V-12-212', 'Vessels', true)];
    const f = focusList(eqs.map((e) => at(e.eq.tag)), eqs, []);
    expect(f.map((x) => x.a.ref)).toEqual(['V-12-212', 'C-12-201', 'P-12-203', 'C-12-201-E-01A', '12-VC-0106']);
    expect(f.filter((x) => x.minor).map((x) => x.a.ref)).toEqual(['C-12-201-E-01A', '12-VC-0106']);
  });
});

describe('isolation links: blinds lock the loops, items take the colour', () => {
  const pt = (x: Partial<TrkPoint>) => ({ id: x.ref, kind: 'neut', grp: null, name: '', detail: null, fo: null, stepId: null, items: [], requires: [], beforeHo: true, sort: 0, status: 'open',
    inAt: null, outAt: null, fillAt: null, soakAt: null, drainAt: null, doneAt: null, soakH: 4, remark: null, updatedBy: null, updatedAt: null, ...x } as TrkPoint);
  const seg06 = pt({ ref: 'SEG-06', kind: 'blind', grp: 'hp_critical', items: ['E-202 to E-203'] });
  const seg11 = pt({ ref: 'SEG-11', kind: 'blind', status: 'in' });
  const s215 = pt({ ref: 'S215', stepId: 'S215', items: ['E-202 to E-203', 'C-12-201'], requires: ['SEG-06', 'SEG-11'] });
  const s320 = pt({ ref: 'S320', stepId: 'S320', items: ['V-12-213'], status: 'done' });
  const all = [seg06, seg11, s215, s320];

  it('reactor: catalyst soak, body spray after dumping, parts on their own', () => {
    const soak = pt({ ref: 'R-12-205', items: ['R-12-205'], status: 'done' });
    const body = pt({ ref: 'R-12-205 body', items: ['R-12-205'], method: 'spray', beforeHo: false, afterActs: ['A5410', 'A7050'] });
    const wd = pt({ ref: 'S117', stepId: 'S117', items: ['R-205 withdrawal line'], partOf: ['R-12-205'] });
    const act = (activityId: string, activity: string, fin: string | null) => ({ activityId, activity, key: 'R-12-205', actualFinish: fin }) as never;
    expect([neutName(soak), neutName(body), neutName(wd)]).toEqual(['Catalyst soak', 'Body spray', 'S117']);
    expect(waitingSteps(body, [act('A5410', 'Dump Catalyst by Double Vacuum', null), act('A7050', 'Dump ceramic balls', null), act('A5260', 'Remove top basket', null)])).toEqual(['Dump Catalyst by Double Vacuum', 'Dump ceramic balls']);
    expect(waitingSteps(body, [act('A5410', 'Dump', kw('2026-10-21 08:00')), act('A7050', 'Dump balls', kw('2026-10-21 09:00'))])).toEqual([]);
    expect(partsOf('R-12-205', [soak, body, wd]).map((p) => p.ref)).toEqual(['S117']);
    // the body spray is not needed for the hand over: the reactor is ready on its soak alone
    expect(isolationOf('R-12-205', [soak, body])?.ready).toBe(true);
  });
  it('a loop waits for the blinds not in', () => {
    expect(missingBlinds(s215, all)).toEqual(['SEG-06']);
    expect(missingBlinds(s215, [{ ...seg06, status: 'in' }, seg11])).toEqual([]);
  });
  it('the items: blind missing, not started, neutralizing, ready, handed over', () => {
    expect(isoState('C-12-201', 0, all)?.state).toBe('blind');
    expect(isoState('C-12-201', 0, [{ ...seg06, status: 'in' }, seg11, s215])?.state).toBe('idle');
    expect(isoState('C-12-201', 0, [seg06, seg11, { ...s215, status: 'filling' }])?.state).toBe('neut');
    expect(isoState('V-12-213', 0, all)?.state).toBe('ready');
    expect(isoState('V-12-213', 1, all)?.state).toBe('ho');
    expect(isoState('P-12-203', 0, all)).toBeNull();
  });
  it('the next step names the missing blind', () => {
    const e = { eq: { tag: 'C-12-201', barchartKey: null, hoStep: 'S223' }, stage: 0 } as Parameters<typeof nextStep>[0];
    expect(nextStep(e, [], all)?.text).toBe('🔒 Blinds for S215: SEG-06');
  });
});

describe('work-step order', () => {
  const a = (activityId: string, start: string, actualStart: string | null = null, group = 'Mech') => ({ activityId, group, start, actualStart, activity: activityId.startsWith('A4750') ? 'Soda ash part' : 'Work' });
  it('operations first, then by the real start, split parts kept together', () => {
    const xs = [a('A3881-3', '2026-10-20T20:00Z'), a('A4750-2', '2026-10-21T12:00Z', '2026-10-19T15:51Z'), a('A4750-3', '2026-10-21T20:00Z'),
      a('A4750-1', '2026-10-21T04:00Z', '2026-10-19T15:51Z'), a('A3881-2', '2026-10-20T12:00Z', '2026-10-19T14:18Z'), a('OP-02', '', null, 'Operations'), a('A3881-1', '2026-10-20T04:00Z', '2026-10-19T10:20Z')];
    expect(sortActs(xs).map((x) => x.activityId)).toEqual(['OP-02', 'A3881-1', 'A3881-2', 'A4750-1', 'A4750-2', 'A4750-3', 'A3881-3']);
  });
});

describe('order set by hand', () => {
  it('the saved place wins over the plan, steps without a place go last', () => {
    const a = (activityId: string, start: string, seq: number | null, group = 'Mech') => ({ activityId, group, start, seq });
    const xs = [a('OP-01', '', 3, 'Operations'), a('B1', '2026-10-20T07:00Z', 1), a('B2', '2026-10-21T07:00Z', 2), a('B3', '2026-10-19T07:00Z', null)];
    expect(sortActs(xs).map((x) => x.activityId)).toEqual(['B1', 'B2', 'OP-01', 'B3']);
  });
  it('the field-detail steps are not the next step', () => {
    const e = { eq: { tag: 'V-12-206', barchartKey: null, hoStep: 'S219' }, stage: 0 } as Parameters<typeof nextStep>[0];
    const mk = (id: string, detail: boolean) => ({ id, activityId: id, group: 'Operations', key: 'V-12-206', activity: id, tracked: true, stage: 1, start: null, detail } as Parameters<typeof nextStep>[1][number]);
    expect(nextStep(e, [mk('OP-03', true), mk('OP-04', false)])).toMatchObject({ text: 'OP-04', n: 1, of: 1 });
  });
});

describe('process lineup', () => {
  const st = (id: string, from: string, to: string, lineNos: string[]) => ({ id, from, to, fluid: 'x', line: lineNos.join(' '), lineNos, sheets: ['1-R-12-0-104'], size: null, conf: 'check' });
  const lu = [st('a', 'R-201', 'R-202', ['P-12-2039']), st('b', 'E-216A/B', 'E-229', ['P-12-2029']), st('c', 'F-202', 'V-212', ['P-12-2061']), st('d', 'EA-201A-D', 'V-206', ['P-12-2047'])];
  it('tags: tracker form to lineup form, lineup keys', () => {
    expect(luTag('E-12-229')).toBe('E-229');
    expect(luKeys('E-216A/B')).toEqual(['E-216', 'E-216A', 'E-216B']);
    expect(luKeys('EA-201A-D')).toEqual(['EA-201', 'EA-201A', 'EA-201B', 'EA-201C', 'EA-201D']);
    expect(luKeys('HDR: Injection water manifold')).toEqual(['Injection water manifold']);
  });
  it('a line gives its place and the tracker items at its ends', () => {
    const s = lineStreams('P-12-2061', lu);
    expect(s.map((x) => `${x.from}>${x.to}`)).toEqual(['F-202>V-212']);
    expect(streamItems(s[0], ['F-12-202', 'V-12-212', 'V-12-213'])).toEqual(['F-12-202', 'V-12-212']);
    expect(lineStreams(null, lu)).toEqual([]);
  });
  it('a loop covers the lines between its equipment', () => {
    expect(loopLines({ items: ['R-201 to R-202'], name: 'Reactor inter piping' }, lu).lines).toEqual(['P-12-2039']);
    expect(loopLines({ items: ['E-12-216A', 'E-12-229'], name: 'Charge pump to H-201' }, lu).lines).toEqual(['P-12-2029']);
  });
});

describe('line named in an equipment data block', () => {
  it('finds the vent line on its vessel', () => {
    const eqs = [{ tag: 'V-212', plantTag: 'V-12-212', name: 'COMPRESSOR KO DRUM', data: 'design 1850 psig; oper 1641 psig @ 130F; LLLL 12 in; vent VT-12-2018-GR1', sheet: '1-R-12-0-117' }];
    expect(lineOnEquipment('VT-12-2018', eqs).map((x) => [x.eq.plantTag, x.what])).toEqual([['V-12-212', 'vent']]);
    expect(lineOnEquipment('P-12-9999', eqs)).toEqual([]);
  });
});

describe('IAT checks from the sheet', () => {
  it('in order, the hydro pressure from the sheet or the recommendation, IF REQ optional', () => {
    const c = iatChecks({ checks: { hydro: 'REQ', lpt: 'REQ', pwht: 'IF REQ.' }, recommendation: '6. Hydrotest the spool at 525 psig.' });
    expect(c.map((x) => [x.label, x.optional])).toEqual([['LPT', false], ['PWHT', true], ['Hydro 525 psig', false]]);
    expect(iatChecks({ checks: { hydro: 'REQ\n2740' }, recommendation: null })[0].label).toBe('Hydro 2740 psig');
    expect(iatStatus({ sheetStatus: null, status: 'closed' })).toBe('Completed');
  });
});

describe('plan vs actual by finished steps', () => {
  it('a stage is planned once its line is planned to finish', () => {
    const t0 = Date.parse('2026-10-21T07:00:00+03:00');
    const acts = [{ id: 'a', activityId: 'A1', group: 'Mech', key: 'R-12-202', activity: 'Remove top trays', durationH: 8, start: new Date(t0).toISOString(), finish: new Date(t0 + 8 * 36e5).toISOString(), stage: 2, tracked: true }];
    expect(planVsActual(acts, 1, t0 + 4 * 36e5)?.variance).toBe(1);   // still running in the plan: stage 1 is on plan (+1 vs 0)
    expect(planVsActual(acts, 1, t0 + 9 * 36e5)?.variance).toBe(-1);  // planned finished, not done: one stage behind
  });
});

describe('WhatsApp report in the plant format', () => {
  it('same status shares a line, pending blinds named, loops not started on one line', () => {
    const d = seed(); const now = at('2026-10-21 10:00');
    for (const t of ['V-12-202', 'V-12-210']) Object.assign(eq(d, t), { stage: 3, remark: null });
    d.points = [{ id: 'b', kind: 'blind', grp: 'segregation', ref: 'SEG-18', name: 'HP flare', detail: null, fo: 'FO3', stepId: 'S317', items: [], beforeHo: true, sort: 1, status: 'open', inAt: null, outAt: null, fillAt: null, soakAt: null, drainAt: null, doneAt: null, soakH: null, remark: null, updatedBy: null, updatedAt: null },
      { id: 'n1', kind: 'neut', grp: null, ref: 'S214', name: 'V-206 to V-207', detail: null, fo: 'FO2', stepId: 'S214', items: ['V-12-206'], beforeHo: true, sort: 2, status: 'draining', inAt: null, outAt: null, fillAt: null, soakAt: null, drainAt: null, doneAt: null, soakH: 4, remark: null, updatedBy: null, updatedAt: null },
      { id: 'n2', kind: 'neut', grp: null, ref: 'S112', name: 'ADD line', detail: null, fo: 'FO1', stepId: 'S112', items: [], beforeHo: true, sort: 3, status: 'open', inAt: null, outAt: null, fillAt: null, soakAt: null, drainAt: null, doneAt: null, soakH: 4, remark: null, updatedBy: null, updatedAt: null }];
    const text = reportText(shiftReport(d, now, null));
    expect(text).toContain('- V-202/210: Under inspection');
    expect(text).toContain('*Segregation blinding*\n- 1 blind pending: SEG-18');
    expect(text).toContain('*Neutralization*\n- V-206 to V-207: Soda ash draining I/P\n- Not started: S112');
  });
});

describe('team leader report', () => {
  it('the measures by name, the controlling item, then the equipment by stage; hours, no days, no columns', () => {
    const d = seed(); d.settings = { ...d.settings, miStart: kw('2026-10-20 07:00'), miEnd: kw('2026-11-07 07:00') };
    Object.assign(step(d, 'S110'), { status: 'done', doneAt: '2026-10-20T07:00:00+03:00' });
    const text = leaderReportText(d, at('2026-10-24 09:00'), { title: 'U-12 TR-2 SD', by: 'Ali' });
    expect(text.split('\n').slice(0, 2)).toEqual(['*U-12 Train-2 SD · Team leader update*', '_24 Oct · M&I day 5 of 18_']);
    for (const m of ['🛠 *Work done (hours):* ', '📦 *Items completed:* ', '🟢 *Items within the end date:* ']) expect(text).toContain(m);
    expect(text).toMatch(/\n🎯 \*Critical path \(R-205\):\* (ahead|behind|on plan) · \d+% vs plan \d+%\n {3}End .* · \d+ h (after|before) P6/);
    expect(text).toContain('*Equipment status*\n• Reactors 5: ');
    expect(text).toMatch(/\n📋 \*SD scope:\* .*NRV \d+\/\d+/);
    expect(text).not.toContain('Steps completed');
    expect(text).not.toMatch(/\d d\b/);
    expect(text).not.toMatch(/\S {2,}/);
    expect(text.trimEnd().endsWith('— Ali')).toBe(true);
  });
});

describe('M & I progress, forecast and the controlling item', () => {
  const act = (key: string, id: string, start: string, finish: string, h: number, as: string | null = null, af: string | null = null) => ({ id: key + id, activityId: id, group: 'Mech', key, activity: id, durationH: h, start: kw(start), finish: kw(finish), stage: 2, tracked: true, actualStart: as && kw(as), actualFinish: af && kw(af) }) as never;
  const ev = (tag: string, group = 'Reactors') => ({ eq: { tag, barchartKey: tag, tracked: true, group }, stage: 1, hoAt: kw('2026-10-20 07:00') }) as never;
  const data = (activities: unknown[], engine?: unknown) => ({ settings: { miEnd: kw('2026-11-07 07:00'), fcMin: 3, fcWindow: 4 }, activities, engine }) as unknown as TrkData;
  const at = (x: string) => Date.parse(kw(x));
  it('a task finished early saves its days for the item: 9 days planned, done in 5', () => {
    const d = data([act('R-12-205', 'DUMP', '2026-10-20 07:00', '2026-10-29 07:00', 216, '2026-10-20 07:00', '2026-10-25 07:00'), act('R-12-205', 'CLEAN', '2026-10-29 07:00', '2026-11-01 07:00', 72)]);
    const i = miWeighted(d, at('2026-10-25 07:00'), [ev('R-12-205')])!.items[0];
    expect([i.physPct, i.forecast, i.svD, i.spareD, i.impactD]).toEqual([75, at('2026-10-28 07:00'), 4, 10, 0]);
  });
  it('a late line in parallel with float does not move the item; behind its own plan is not a shutdown delay', () => {
    const d = data([act('V-12-209', 'LONG', '2026-10-20 07:00', '2026-10-30 07:00', 240, '2026-10-20 07:00'), act('V-12-209', 'SHORT', '2026-10-20 07:00', '2026-10-21 07:00', 24),
      act('E-12-204', 'A', '2026-10-20 07:00', '2026-10-22 07:00', 48), act('Electrical', 'E1', '2026-10-20 07:00', '2026-11-04 07:00', 360)]);
    const w = miWeighted(d, at('2026-10-24 07:00'), [ev('V-12-209', 'Vessels'), ev('E-12-204', 'Exchangers')])!;
    const v = w.items.find((i) => i.tag === 'V-12-209')!, e = w.items.find((i) => i.tag === 'E-12-204')!;
    // SHORT not started 4 days late, but LONG (running, not measured) still sets the finish
    expect([v.forecast, v.physPct, v.physHiPct]).toEqual([at('2026-10-30 07:00'), 0, 91]);
    expect(v.unverified).toEqual(['SHORT: P6 start passed, no start recorded', 'LONG: running, not measured']);
    // E-204 not started: 2 days of work from now, 4 days behind its P6 finish, still 12 days of float
    expect([e.svD, e.spareD, e.impactD]).toEqual([-4, 12, 0]);
    expect(w.support).toEqual([0, 1]);
  });
  it('running drums count by the drums removed and finish at the measured rate', () => {
    const shifts = [['2026-10-21', 'D', 200], ['2026-10-21', 'N', 200], ['2026-10-22', 'D', 200]] as const;
    const engine = { scopes: [{ id: 's', key: 'R-12-205', scope: 'removal', unit: 'drums', working: 2400, initial: 2400, activityIds: ['DUMP'], completeAt: null }],
      entries: shifts.map(([shiftDate, shift, qty], n) => ({ id: `e${n}`, scopeId: 's', shiftDate, shift, kind: 'removal', method: 'vacuum', qty, verify: 'verified' })), estimates: [], updates: [] };
    const d = data([act('R-12-205', 'DUMP', '2026-10-21 07:00', '2026-10-26 07:00', 120, '2026-10-21 07:00'), act('R-12-205', 'LOAD', '2026-10-26 07:00', '2026-10-28 07:00', 48)], engine);
    const i = miWeighted(d, at('2026-10-22 19:00'), [ev('R-12-205')])!.items[0];
    // 600 of 2,400 drums = 25% of the dumping line; 1,800 left at 200 a shift = 9 shifts = 4.5 days, then 2 days of loading
    expect([i.physPct, i.forecast, i.unverified]).toEqual([18, at('2026-10-29 07:00'), []]);
  });
  it('any item can control the end, a PSV too', () => {
    const d = data([act('R-12-205', 'A', '2026-10-20 07:00', '2026-11-03 07:00', 336, '2026-10-20 07:00', '2026-10-30 07:00'),
      act('12-PSV-0519', 'P1', '2026-10-20 07:00', '2026-10-25 07:00', 120), act('12-PSV-0519', 'P2', '2026-10-25 07:00', '2026-11-04 07:00', 240)]);
    const w = miWeighted(d, at('2026-10-27 07:00'), [ev('R-12-205'), ev('12-PSV-0519', 'PSVs')])!;
    expect([w.controlling?.tag, w.controlling?.small, w.estEnd, w.impactD]).toEqual(['12-PSV-0519', true, at('2026-11-11 07:00'), 4]);
    expect(w.delays.map((i) => [i.tag, i.spareD])).toEqual([['12-PSV-0519', -4]]);
    expect([w.main.physPct, w.small.physPct, w.small.items]).toEqual([100, 0, 1]);
  });
});

describe('equipment blind list', () => {
  const a = (key: string, activity = 'Blind') => ({ key, activity, stage: 1, tracked: true, group: 'Mech' });
  it('keeps equipment blinds, leaves out control valves, check valves and PSVs', () => {
    expect(['V-12-209', 'C-12-201-TK-03', '12-HV-0534', '12-LV-0553B', '12-VC-0105', '12-PSV-0519'].map((k) => equipBlind(a(k)))).toEqual([true, true, false, false, false, false]);
    expect(equipBlind(a('V-12-209', 'Deblind'))).toBe(false);
  });
});

describe('a control valve dropped in two procedures', () => {
  const act = (id: string, s: string | null, f: string | null) => ({ id, activityId: id, group: 'Operations', key: id, activity: id, durationH: null, start: null, finish: null, stage: null, tracked: true, actualStart: s, actualFinish: f }) as never;
  const step = (linkActs: string[]) => ({ id: 's', pointId: 'p', seq: 1, phase: 'before', text: '', source: null, doneAt: null, doneBy: null, crane: true, kind: 'step', startAt: null, startBy: null, linkActs }) as never;
  it('one record shows in every step: done when all its valves are, running when one is', () => {
    const acts = [act('FV-548', kw('2026-10-22 09:04'), kw('2026-10-22 13:49')), act('FV-1427', kw('2026-10-22 09:04'), null), act('FV-1426', kw('2026-10-22 09:04'), kw('2026-10-22 13:49'))];
    expect(linkedStep(step(['FV-1426']), acts).doneAt).toBe(kw('2026-10-22 13:49'));
    const both = linkedStep(step(['FV-548', 'FV-1427']), acts);
    expect([both.startAt, both.doneAt]).toEqual([kw('2026-10-22 09:04'), null]);
  });
});

describe('ask for updates', () => {
  const eqp = (tag: string, group: string, extra = {}) => ({ id: tag, tag, group, description: null, fo: null, hoStep: null, procedure: null, barchartKey: tag, opsItem: false, critical: false, tracked: true, disabledReason: null,
    plannedHo: null, plannedFinish: null, sort: 0, stage: 2, pendingReason: null, remark: null, blindsIn: null, blindsOut: null, updatedBy: null, updatedAt: null, ...extra });
  const act = (key: string, id: string, start: string, finish: string, as: string | null, af: string | null = null) => ({ id: key + id, activityId: id, group: 'Mech', key, activity: id, durationH: 24, start: kw(start), finish: kw(finish), stage: 2, tracked: true, actualStart: as && kw(as), actualFinish: af && kw(af) });
  const d = { settings: { miEnd: kw('2026-11-07 07:00') }, steps: [], iats: [], log: [], points: [],
    equipment: [eqp('V-12-209', 'Vessels'), eqp('E-12-207', 'Exchangers'), eqp('12-PSV-0537', 'PSVs'), eqp('12-PSV-0601', 'PSVs'), eqp('V-12-212', 'Vessels', { pendingReason: 'Waiting gas test' }), eqp('V-12-201', 'Vessels')],
    activities: [act('V-12-209', 'Hydrojet', '2026-10-21 07:00', '2026-10-22 07:00', '2026-10-21 08:00'),
      act('E-12-207', 'Hydroblast', '2026-10-21 07:00', '2026-10-22 07:00', '2026-10-22 20:00'),
      act('12-PSV-0537', 'Remove PSV', '2026-10-20 07:00', '2026-10-25 07:00', '2026-10-21 09:00'), act('12-PSV-0601', 'Remove PSV', '2026-10-20 07:00', '2026-10-25 07:00', '2026-10-21 10:00'),
      act('V-12-212', 'Open manway', '2026-10-21 07:00', '2026-10-21 19:00', null),
      act('V-12-201', 'Box-up', '2026-10-21 07:00', '2026-10-21 19:00', null)] } as unknown as TrkData;
  it('asks about running or due work with no update past its limit; on hold, recent or finished items are left out', () => {
    const xs = staleItems(d, Date.parse(kw('2026-10-23 07:00')));
    // V-209 46 h (> 12 h), PSVs 46/45 h (> 24 h), V-201 box-up due since 21 Oct 07:00 not started; E-207 updated 11 h ago, V-212 on hold
    expect(xs.map((x) => [x.tag, x.status])).toEqual([['V-12-201', ''], ['V-12-209', 'Hydrojet I/P'], ['12-PSV-0537', 'Remove PSV I/P'], ['12-PSV-0601', 'Remove PSV I/P']]);
    const text = askText(xs, Date.parse(kw('2026-10-23 07:00')), { name: 'U-12 TR-2 SD' });
    expect(text).toContain('*Vessels*\n- V-201: no activity since 21 Oct:\n- V-209: Hydrojet I/P since 21 Oct:');
    expect(text).toContain('*PSVs*\n- PSV-0537: Remove PSV I/P since 21 Oct:\n- PSV-0601: Remove PSV I/P since 21 Oct:');
    expect(text).not.toContain('?');
  });
});

describe('the same work in two places', () => {
  const step = (o: object) => ({ id: 's', pointId: 'p', seq: 1, phase: 'before', text: 'Blinds in: E-202 S/S O/L and TV-667 U/S', source: null, doneAt: null, doneBy: null, crane: false, kind: 'step', startAt: null, startBy: null, linkActs: [], ...o }) as never;
  const blind = (id: string, status: string, inAt: string | null) => ({ id, kind: 'blind', ref: id, name: id, status, inAt, updatedBy: 'Section Head' }) as never;
  it('a procedure step follows its segregation blinds: done when all are in', () => {
    const pts = [blind('SEG-06', 'in', kw('2026-10-20 09:00')), blind('SEG-07', 'open', null)];
    expect(linkedStep(step({ linkPoints: ['SEG-06', 'SEG-07'] }), [], pts).doneAt).toBeNull();
    pts[1] = blind('SEG-07', 'in', kw('2026-10-21 10:00'));
    expect(linkedStep(step({ linkPoints: ['SEG-06', 'SEG-07'] }), [], pts).doneAt).toBe(kw('2026-10-21 10:00'));
  });
  it('the work of other lists on the same tag', () => {
    const a = (key: string, activity: string) => ({ id: key + activity, activityId: 'x', group: 'Mech', key, activity, durationH: null, start: null, finish: null, stage: null, tracked: true }) as never;
    const acts = [a('OPR list', 'OPlist-1014 FV-1426 Down stream check valve servicing'), a('OPR list', 'OPlist-1035 LV 553B Passing to be attended'), a('OPR list', 'OPlist-1099 FV-14260 other'), a('FV-1426', 'Drop control valve FV-1426')];
    expect(relatedWork('FV-1426 d/s', 'FV-1426 d/s', acts).map((x: { activity: string }) => x.activity)).toEqual(['OPlist-1014 FV-1426 Down stream check valve servicing', 'Drop control valve FV-1426']);
    expect(relatedWork('12-LV-0553B', '12-LV-0553B', acts).length).toBe(1);
    // the unit number (12) is not the item: V-12-201 does not pull in V-12-202 or V-12-206
    const vs = [a('V-12-202', 'Box-up'), a('V-12-206', 'Blind'), a('OPR list', 'OPlist-1050 V-12-201 drain valve to be serviced')];
    vs.push(a('C-12-201-ST', 'Shift to workshop'), a('R-12-205', 'Dump catalyst'), a('C-12-201', 'Shift to workshop'));
    expect(relatedWork('C-12-201', 'C-12-201', vs).length).toBe(0);
    // a list named after several items is not all about one of them; a part is not its pump
    const ms = [a('P-203/205 HT motors', 'functional test'), a('P-203/205 HT motors', 'P-12-203 P1 B-M'), a('OPR list', 'OPlist-1030 P-203 seal flushing line strainer')];
    expect(relatedWork('P-12-203', 'P-12-203', ms).length).toBe(2);
    expect(relatedWork('P-12-203-E-01A', 'P-12-203-E-01A', ms).length).toBe(0);
    expect(relatedWork('V-12-201', 'V-12-201', vs).map((x: { activity: string }) => x.activity)).toEqual(['OPlist-1050 V-12-201 drain valve to be serviced']);
  });
});

describe('spanText', () => {
  const t = (h: number) => new Date(Date.parse('2026-10-20T10:00:00Z') + h * 36e5).toISOString();
  it('says how long a step took', () => {
    expect(spanText(t(0), t(0))).toBe('');
    expect(spanText(t(0), t(0.1))).toBe('');
    expect(spanText(t(0), t(0.5))).toBe('30 min');
    expect(spanText(t(0), t(6))).toBe('6 h');
    expect(spanText(t(0), t(51))).toBe('51 h'); // durations in hours (project rule)
    expect(spanText(t(0), t(72))).toBe('72 h');
    expect(spanText(null, t(5))).toBe('');
  });
});
