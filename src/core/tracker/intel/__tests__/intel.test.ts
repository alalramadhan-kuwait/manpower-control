// The acceptance reports of the owner's specification (27 Oct 2026), read against a tracker built like the live one.
import { describe, expect, it } from 'vitest';
import { eventAtOf, fingerprint, planningCandidates, planningView, readReport, reconcile, reconstruct, resolveTag, tagsIn, withinTolerance } from '..';

import { act, data, eq, F, META, MM, S } from './fixture';
const run = (text: string, meta = META, d = data(), existing: Parameters<typeof reconcile>[3] = {}) => reconcile(d, text, meta, { now: Date.parse('2026-10-26T16:00:00Z'), ...existing });
const find = (r: ReturnType<typeof reconcile>, f: (p: ReturnType<typeof reconcile>['proposals'][number]) => boolean) => r.proposals.find(f);

describe('reading the report', () => {
  it('resolves plant tags, combined items and valves', () => {
    expect(tagsIn('E-216 A/B').flatMap((t) => t.tags)).toEqual(['E-12-216A', 'E-12-216B']);
    expect(tagsIn('R-201/203/204').flatMap((t) => t.tags)).toEqual(['R-12-201', 'R-12-203', 'R-12-204']);
    expect(tagsIn('E-204/205 bundles').flatMap((t) => t.tags)).toEqual(['E-12-204', 'E-12-205']);
    expect(tagsIn('HV-12-546A transferred').flatMap((t) => t.tags)).toEqual(['HV-12-546A']);
    expect(resolveTag(data(), 'E-12-216').map((m) => m.tag)).toEqual(['E-12-216A', 'E-12-216B']);
    expect(resolveTag(data(), 'HV-12-546A')[0].kind).toBe('valve');
    expect(resolveTag(data(), 'E-12-122B')).toEqual([]);
  });
  it('splits a line into facts with their state, spells out the site short forms, reads the quantities', () => {
    const { facts } = readReport('H-201: Burner cleaning I/P. Burner No. 6 tip found broken.\nR-205: jackhammering and vacuuming I/P. Total 1968 drums, today 124.\nV-213: PSV header buffing done; DPT to be done.');
    expect(facts.map((f) => `${f.tags[0]} ${f.kind}/${f.state}`)).toEqual(['H-12-201 work/in_progress', 'H-12-201 defect/info', 'R-12-205 work/in_progress', 'R-12-205 quantity/info', 'V-12-213 work/done', 'V-12-213 work/pending']);
    expect(facts[3].qty).toEqual([{ value: 1968, unit: 'drum', mode: 'cumulative' }, { value: 124, unit: 'drum', mode: 'daily' }]);
    expect(facts[5].text).toContain('dye penetrant test');
  });
  it('29 Oct report: parts after a tag, a 📌 tag block, a night count apart from the total, RTJ numbers', () => {
    expect(tagsIn('P-205 E-01: Cooler dismantled').flatMap((t) => t.tags)).toEqual(['P-12-205-E-01']);
    expect(tagsIn('P-12-205 E1').flatMap((t) => t.tags)).toEqual(['P-12-205-E-01']);
    expect(tagsIn('P-12-203 TK-01').flatMap((t) => t.tags)).toEqual(['P-12-203-TK-01']);
    expect(tagsIn('C-201 E-01A / E-01B: Elements removed').flatMap((t) => t.tags)).toEqual(['C-12-201-E-01A', 'C-12-201-E-01B']);
    expect(tagsIn('E-204 / E-205: Under inspection').flatMap((t) => t.tags)).toEqual(['E-12-204', 'E-12-205']);
    const { facts } = readReport('📌R-205\nJack hammering and vacuuming I/P.\nTonight: 52 drums.\nTotal: 2356 drums.\nWindow opening I/P : 7/9 completed.\n\n📌E-12-205 / P-12-205:\nTube inlet flange opened, cleaned, DPT completed, and RTJ Nos. 82/83/02 boxed up.');
    expect(facts.filter((f) => f.line <= 5).every((f) => f.tags[0] === 'R-12-205')).toBe(true);
    expect(facts.flatMap((f) => f.qty ?? [])).toEqual([{ value: 52, unit: 'drum', mode: 'daily' }, { value: 2356, unit: 'drum', mode: 'cumulative' }]);
    expect(facts.some((f) => /^\d+\/\d+\/\d+ boxed up/.test(f.text))).toBe(false);
  });
  it('event time: the end of the report shift, never after the submission', () => {
    expect(eventAtOf(META)).toBe('2026-10-26T15:30:00.000Z');
    expect(eventAtOf({ ...META, submittedAt: '2026-10-27T05:00:00Z' })).toBe('2026-10-26T16:00:00.000Z');
    expect(eventAtOf({ ...META, shift: 'N', submittedAt: '2026-10-27T09:00:00Z' })).toBe('2026-10-27T04:00:00.000Z');
    expect(fingerprint('a  b', { department: 'x', reportDate: '2026-10-26', shift: null })).toBe(fingerprint('a b', { department: 'x', reportDate: '2026-10-26', shift: null }));
  });
});

describe('acceptance reports', () => {
  it('1 · R-205 quantities: dumping stays running, 1,972 kept, 124 a day count, no warning for the 4-drum difference', () => {
    const d = data();
    const ops = run('R-205 dumping I/P. 1972 drums.', META, d);
    const drums = find(ops, (p) => p.type === 'drums')!;
    expect(drums.status).toBe('ready'); expect(drums.proposed.total).toBe(1972); expect(drums.proposed.add).toBe(264);
    expect(find(ops, (p) => p.type === 'start_step')).toBeUndefined(); // already running
    expect(find(ops, (p) => p.activityName === 'Dump Catalyst by Double Vacuum')?.classification).toBe('already_recorded');
    // the maintenance report, after the first was applied (the tracker holds 1,972)
    d.engine!.entries[0].qty = 1972;
    const mm = run('R-205 jackhammering and vacuuming I/P. Total 1968 drums, today 124.', MM, d);
    const q = find(mm, (p) => p.classification === 'already_recorded' && /drums/.test(p.title))!;
    expect(q.status).toBe('info'); expect(q.detail).toContain('today 124'); expect(mm.summary.conflicts).toBe(0);
    expect(mm.proposals.some((p) => p.type === 'drums')).toBe(false);
    expect(withinTolerance(1972, 1968)).toBe(true); expect(withinTolerance(1972, 1900)).toBe(false);
  });
  it('2 · H-201 defect: cleaning stays running, the defect is recorded with a proposed rectification, no hold', () => {
    const r = run('H-201: Burner cleaning I/P. Burner No. 6 tip found broken.');
    expect(find(r, (p) => p.activityName === 'Burner cleaning')?.classification).toBe('already_recorded');
    const def = find(r, (p) => p.type === 'defect')!;
    expect(def.status).toBe('review'); expect(def.newStep?.title).toMatch(/rectification/i); expect(def.newStep?.durationH).toBeNull(); expect(def.detail).toContain('Not a hold');
    expect(r.proposals.some((p) => p.type === 'hold')).toBe(false);
  });
  it('3 · R-201/203/204 collector ring: location and repair status kept apart, nothing concluded complete', () => {
    const ops = run('R-201/203/204: Collector ring under repair.');
    // owner, 27 Oct 2026: a collector ring repair is not the thermowell bracket repair; that step is not started, a step
    // for the ring is suggested for review on each reactor
    expect(ops.proposals.filter((p) => p.type === 'start_step').length).toBe(0);
    expect(ops.proposals.filter((p) => p.type === 'new_step' && p.status === 'review' && /collector ring/i.test(p.title)).map((p) => p.tag)).toEqual(['R-12-201', 'R-12-203', 'R-12-204']);
    expect(ops.proposals.filter((p) => p.type === 'finish_step').length).toBe(0);
    const mm = run('R-201/203/204: Collector ring shifted to site.', MM);
    expect(mm.proposals.filter((p) => p.classification === 'location').length).toBe(3);
    expect(mm.proposals.some((p) => p.type === 'finish_step' || p.type === 'start_step')).toBe(false);
  });
  it('3b · a general repair step ("Repair if required") takes any repair; a named one only its own object', () => {
    const d = data(); const a = d.activities.find((x) => x.key === 'R-12-203' && /thermowell/i.test(x.activity))!; a.activity = 'Repair if required';
    const r = run('R-203: Collector ring under repair.', META, d);
    expect(r.proposals.filter((p) => p.type === 'start_step').map((p) => p.activityName)).toEqual(['Repair if required']);
    const t = run('R-201: Thermowell brackets repair in progress.');
    expect(t.proposals.filter((p) => p.type === 'start_step').map((p) => p.activityName)).toEqual(['Repair of thermowell brackets']);
  });
  it('4 · R-202: completed steps proposed, readiness shown, inspection not accepted', () => {
    const r = run('R-202: Internal cleaning done. Outlet de-choking done. Ready for inspection.');
    expect(r.proposals.filter((p) => p.type === 'finish_step').map((p) => p.activityName)).toEqual(['Cleaning all internal by Hydrojet', 'Outlet de-choking']);
    const ready = find(r, (p) => p.classification === 'readiness')!;
    expect(ready.activityName).toBe('Offer for Process'); expect(ready.status).toBe('review'); expect(ready.proposed).toEqual({});
  });
  it('5 · E-216A/B: both exchangers, cleaning stays pending, scaffolding recorded, unnamed valves not attributed', () => {
    const r = run('E-216 A/B: Cleaning to start.\nFour control valves dropped.\nScaffold erection in progress.');
    expect(new Set(r.proposals.map((p) => p.tag))).toEqual(new Set(['E-12-216A', 'E-12-216B']));
    expect(r.proposals.filter((p) => p.type === 'start_step' || p.type === 'finish_step').length).toBe(0);
    expect(r.proposals.filter((p) => p.type === 'info' && /scaffold/i.test(p.title)).length).toBe(2); expect(r.proposals.some((p) => p.type === 'new_step')).toBe(false);
    expect(r.proposals.filter((p) => p.classification === 'unclear' && /control valves/.test(p.title)).length).toBe(2);
  });
  it('6 · E-122B: not in this tracker → a review item, nothing created, no spare hold invented', () => {
    const r = run('E-122B: Retubing to start. Buffing and DPT done.', MM);
    expect(r.proposals.length).toBe(1); expect(r.proposals[0].classification).toBe('unclear'); expect(r.proposals[0].title).toContain('E-12-122B is not in this tracker');
    expect(r.summary.holds).toBe(0);
  });
  it('7 · V-213: inspection status kept, buffing finished, DPT pending, no equipment-wide completion', () => {
    const r = run('V-213: Under inspection. PSV header buffing done; DPT to be done.', { ...META, department: 'inspection' });
    expect(find(r, (p) => p.type === 'finish_step')?.activityName).toBe('PSV header buffing');
    expect(find(r, (p) => p.activityName === 'Dye penetrant test of PSV header')?.classification).toBe('step_pending');
    expect(find(r, (p) => p.classification === 'readiness')?.title).toContain('Under inspection');
    expect(r.proposals.some((p) => p.activityName === 'PE / OP inspection' && p.type === 'finish_step')).toBe(false);
  });
  it('8 · F-202: removal and cleaning done, reinstatement running, elements planned, operations clearance kept apart from handover', () => {
    const r = run('F-202: New elements to be installed. Connecting spools removed and hydroblasting done. Operations clearance cleared. Spool fixing back in progress.');
    expect(r.proposals.filter((p) => p.type === 'finish_step').map((p) => p.activityName).sort()).toEqual(['Hydroblasting Cleaning', 'Remove connecting spools']);
    expect(find(r, (p) => p.type === 'start_step')?.activityName).toBe('Fix back spools');
    expect(find(r, (p) => p.activityName === 'Re-fix filter element (New)')?.classification).toBe('step_pending');
    const cl = find(r, (p) => p.classification === 'readiness')!;
    expect(cl.title).toContain('clearance'); expect(cl.proposed).toEqual({}); expect(r.proposals.some((p) => /handover/i.test(String(p.proposed.remark ?? '')) && p.type !== 'status_line')).toBe(false);
  });
  it('9 · valves: each tag to its own record, statuses kept apart, never one generic activity', () => {
    const r = run('HV-12-546A transferred after removal preparation.\nHV-12-548B at instrument workshop.\nLV-12-511B cleaning/DPT pending.\nFV-12-508 at instrument workshop.\nFV-12-003B at instrument workshop for PMR HT.', MM);
    expect(find(r, (p) => p.tag === 'HV-546A')?.type).toBe('info');
    expect(find(r, (p) => p.tag === 'FV-003B')?.title).toContain('workshop');
    expect(r.proposals.filter((p) => p.classification === 'unclear').map((p) => p.tag).sort()).toEqual(['FV-12-508', 'HV-12-548B', 'LV-12-511B']);
    expect(r.proposals.some((p) => p.type === 'new_step')).toBe(false);
  });
  it('10 · Train-1 commissioning: kept as reported, outside Train-2 progress, no readiness inferred', () => {
    const r = run('Train-1: HP loop pressurized to 1600 psig. Reactor bed temperatures increased to 350 DegF.');
    expect(r.proposals.every((p) => p.classification === 'train1' && p.status === 'info')).toBe(true);
    expect(r.proposals.length).toBe(2); expect(r.proposals[0].detail).toContain('1600 psig');
    expect(r.summary.ready).toBe(0);
  });
  it('11 · official Planning progress: stored, variance 0, tracker progress untouched, method unverified', () => {
    const r = run('Train-2 Shutdown Completion Status: Planned 51.01%, Actual 51.01%.', { ...META, department: 'planning' });
    const p = find(r, (x) => x.type === 'planning')!;
    expect(p.status).toBe('ready'); expect(p.proposed).toEqual({ planned: 51.01, actual: 51.01, reportDate: '2026-10-26' });
    expect(r.proposals.length).toBe(1);
    const d = data();
    const rec = reconstruct(d, [{ reportDate: '2026-10-26', cutoff: null, planned: 51.01, actual: 51.01, source: 'Maintenance Planning', revision: 1 }]);
    expect(['unverified', 'partial']).toContain(rec.status); expect(rec.missing.length).toBeGreaterThan(2); expect(rec.note).toContain('identical');
    const view = planningView([{ reportDate: '2026-10-25', cutoff: null, planned: 48, actual: 47.5, source: 'MP', revision: 1 }, { reportDate: '2026-10-26', cutoff: null, planned: 51.01, actual: 51.01, source: 'MP', revision: 1 },
      { reportDate: '2026-10-26', cutoff: null, planned: 51.01, actual: 50.2, source: 'MP', revision: 2 }]);
    expect(view.latest?.actual).toBe(50.2); expect(view.history[1].dActual).toBe(2.7); expect(view.variance).toBe(-0.81);
    const cands = planningCandidates(d, Date.parse('2026-10-26T16:00:00Z'));
    expect(cands.map((c) => c.code)).toEqual(['A', 'B', 'C', 'D', 'E']); for (const c of cands) { expect(c.actual).not.toBeNull(); expect(c.planned).toBeLessThanOrEqual(100); }
  });
});

describe('latest valid information', () => {
  it('an older report never reverses a newer confirmed completion; a later edit makes the change a conflict', () => {
    const d = data();
    const old = run('V-213: PSV header buffing I/P.', { ...META, reportDate: '2026-10-24' }, d);
    expect(find(old, (p) => p.activityName === 'PSV header buffing')?.classification).toBe('already_recorded');
    d.activities.find((a) => a.activity === 'Burner cleaning')!.updatedAt = '2026-10-26T15:45:00Z';
    const r = run('H-201: Burner cleaning done.', META, d);
    expect(find(r, (p) => p.type === 'finish_step')?.status).toBe('conflict');
  });
  it('the same change from two departments is one proposal with both sources; one already applied is not proposed again', () => {
    const r = run('R-202: Internal cleaning done.\nR-202: Internal cleaning completed.', MM);
    const fin = r.proposals.filter((p) => p.type === 'finish_step'); expect(fin.length).toBe(1); expect(fin[0].evidence.length).toBe(2);
    const again = run('R-202: Internal cleaning done.', META, data(), { existing: [{ type: 'finish_step', key: 'R-12-202', activityId: fin[0].activityId, status: 'applied', proposed: {}, department: 'mech_maint', reportDate: '2026-10-26' }] });
    expect(find(again, (p) => p.activityName === 'Cleaning all internal by Hydrojet')?.status).toBe('info');
  });
  it('holds: confirmed, possible and at risk, and a release', () => {
    const d = data();
    const r = run('H-201: Retubing stopped due to no available tubes.\nR-202: Retubing to start; spare availability under review.\nV-213: Hold released, work resumed.', MM, d);
    expect(find(r, (p) => p.tag === 'H-12-201' && p.type === 'hold')?.level).toBe('confirmed');
    expect(find(r, (p) => p.tag === 'R-12-202' && p.type === 'risk')?.level).toBe('possible');
    expect(find(r, (p) => p.tag === 'V-12-213' && p.type === 'hold_release')?.status).toBe('info');
    d.equipment.find((e) => e.tag === 'V-12-213')!.pendingReason = 'Waiting for crane';
    expect(find(run('V-213: Hold released, work resumed.', MM, d), (p) => p.type === 'hold_release')?.status).toBe('ready');
  });
  it('no micro-tracking: a sub-item of cleaning / inspection marks the family step running, never a new step', () => {
    const d = data();
    const r = run('R-203: Collector ring cleaning done, inlet diffuser cleaning done & shifted to WS.\nR-205: basket cleaning done.\nE-216 A/B: Scaffold erection in progress.', MM, d);
    expect(r.proposals.some((p) => p.type === 'new_step')).toBe(false);
    // R-203 has only a repair step in the fixture: cleaning falls back to information
    expect(find(r, (p) => p.tag === 'R-12-205' && p.type === 'info' && /part of ▶/.test(p.title))?.activityName).toBe('Dump Catalyst by Double Vacuum');
    const d2 = data(); d2.activities.push(act('R-12-203', 'Cleaning all internal by Hydrojet'));
    const r2 = run('R-203: Collector ring cleaning done.', MM, d2);
    expect(find(r2, (p) => p.type === 'start_step')?.activityName).toBe('Cleaning all internal by Hydrojet');
  });
  it('an RTJ / flange inspection remark is information on the item, not a new step', () => {
    const d = data(); d.equipment.push(eq('C-12-201')); d.activities.push(act('C-12-201', 'Dismantle (workshop)', { actualStart: S, actualFinish: F }));
    const r = run('C-201: RTJ flanges inspection I/P.', META, d);
    expect(r.proposals.some((p) => p.type === 'new_step')).toBe(false);
    expect(find(r, (p) => p.tag === 'C-12-201' && p.type === 'info')?.title).toContain('inspection scope');
  });
  it('two steps with the same words: the running one is meant', () => {
    const d = data(); d.activities.push({ ...d.activities[0], id: 'R-12-205:x', activityId: 'AX', activity: 'Dump ceramic balls inside the cone', actualStart: null });
    const r = run('R-205: Dumping I/P. 1972 drums.', META, d);
    expect(find(r, (p) => p.activityName === 'Dump Catalyst by Double Vacuum')?.classification).toBe('already_recorded');
    expect(r.proposals.some((p) => p.type === 'review')).toBe(false);
  });
  it('a same-name existing step is reused instead of a new one; a workflow change is marked', () => {
    const d = data(); d.activities.push(act('E-12-205', 'Bundle hydroblasting', { actualStart: S, actualFinish: F }));
    const r = run('H-201: Burner cleaning of pass 2 done.\nE-205: Additional hydroblasting after inspection rejection done.', MM, d);
    expect(find(r, (p) => p.tag === 'H-12-201' && /part of/.test(p.title))?.activityName).toBe('Burner cleaning');
    expect(find(r, (p) => p.tag === 'E-12-205' && p.type === 'new_step')?.classification).toBe('workflow_change');
  });
});
