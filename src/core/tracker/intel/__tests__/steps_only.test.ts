// The steps-only reader (owner, 30 Oct 2026: "I just want to update the steps"): the Mech. Maint. report of 29 Oct night.
import { describe, expect, it } from 'vitest';
import { reconcile } from '..';
import { act, eq, MM } from './fixture';
import type { TrkData } from '../..';

const S = '2026-10-28T04:00:00Z';
const NR = { tracked: false, disabledReason: 'not required' };
function d(): TrkData {
  return { steps: [], iats: [], log: [], settings: {}, putBack: [], engine: { scopes: [], entries: [], estimates: [], updates: [] },
    equipment: [eq('R-12-201'), eq('R-12-203'), eq('R-12-204'), eq('R-12-205'), eq('E-12-207'), eq('P-12-203-E-01A'), eq('P-12-203-E-01B'), eq('E-12-216A', { combine: 'E-12-216A/B' }), eq('E-12-216B', { combine: 'E-12-216A/B' }), eq('12-PSV-0643'), eq('12-PSV-0719')],
    activities: [
      act('R-12-201', 'Prepare for loading', { actualStart: S, actualFinish: S }), act('R-12-201', 'Load catalyst'),
      act('R-12-203', 'Possible welding of the bolts to fix the bubble cap trays', NR), act('R-12-203', 'Load catalyst', { actualStart: S }), act('R-12-203', 'Install trays'),
      act('R-12-204', 'Repair of thermowell brackets', NR), act('R-12-204', 'Load catalyst'), act('R-12-204', 'Install trays'), act('R-12-204', 'Deblind'),
      act('R-12-205', 'Dump ceramic balls & remaining catalyst inside the cone'), act('R-12-205', 'Load ceramic balls'),
      act('E-12-207', 'Offer for process', { actualStart: S }), act('E-12-207', 'Shell side hydro test at 383 psig'),
      act('P-12-203-E-01A', 'Offer for Inspection / NDT', { actualStart: S }), act('P-12-203-E-01A', 'Shell test at 225 psig'),
      act('P-12-203-E-01B', 'Offer for Rotating', { actualStart: S }), act('P-12-203-E-01B', 'Shell test at 225 psig'),
      act('E-12-216A', 'H-Blast Tube bundle using 2% soda ash', { actualStart: S, actualFinish: S }), act('E-12-216B', 'H-Blast Tube bundle using 2% soda ash'),
      act('12-PSV-0643', 'Install PSV'), act('12-PSV-0719', 'Install PSV')],
  } as unknown as TrkData;
}
const REPORT = `*Unit 12 TR-2 SD*
📌R-201:
Fresh catalyst shifting from warehouse I/P.
📌R-203:
Tray stud bolt welding I/P ,(19/60 )tray stud bolts welded,Remaining (41 stud bolts )waiting material.
📌R-204:
One thermocouple bracket installed. Fresh catalyst loading I/P.
📌R-205:
Ceramic Ball vacuuming I/P.
📌E-12-207:
Shell test completed at 330 PSIG. Inspection cleared .
📌P-12-203 E1A/B:
Shell test completed at 288 PSIG. Inspection cleared.
📌E-12-216 A/B:
E-12-216B: Tube ID HB I/P.
📌PSV-12-0643/0719: All PSVs fixed back in their locations.
📌FCV-12-1419: Control valve fixed back in location.`;

describe('steps only', () => {
  const r = reconcile(d(), REPORT, MM);
  const acted = r.proposals.filter((p) => p.status !== 'info').map((p) => `${p.type} ${p.tag} ${p.activityName ?? ''}`.trim());
  it('no status lines; logistics and unknown tags change nothing', () => {
    expect(r.proposals.some((p) => p.type === 'status_line')).toBe(false);
    expect(r.proposals.filter((p) => p.tag === 'R-12-201' && p.status !== 'info')).toEqual([]);
    expect(r.proposals.find((p) => p.tag === '12-FCV-1419')?.title).toContain('not in this shutdown');
  });
  it('the field words find the right steps', () => {
    expect(acted).toEqual(expect.arrayContaining(['start_step R-12-204 Load catalyst', 'start_step R-12-205 Dump ceramic balls & remaining catalyst inside the cone',
      'finish_step E-12-207 Shell side hydro test at 383 psig', 'finish_step E-12-207 Offer for process', 'finish_step P-12-203-E-01A Shell test at 225 psig', 'finish_step P-12-203-E-01A Offer for Inspection / NDT',
      'finish_step P-12-203-E-01B Shell test at 225 psig', 'start_step E-12-216B H-Blast Tube bundle using 2% soda ash', 'finish_step 12-PSV-0643 Install PSV', 'finish_step 12-PSV-0719 Install PSV']));
    expect(acted.some((x) => /Install trays|Deblind|Load ceramic balls/.test(x))).toBe(false);
  });
  it('a not-required step reported is asked, never switched on; a test pressure difference is noted; another party\'s offer is asked', () => {
    expect(r.proposals.find((p) => p.tag === 'R-12-203' && p.type === 'review')?.title).toContain('marked not required');
    expect(r.proposals.find((p) => p.tag === 'R-12-204' && p.type === 'review')?.activityName).toBe('Repair of thermowell brackets');
    expect(r.proposals.find((p) => p.tag === 'E-12-207' && /test/.test(p.activityName ?? ''))?.issues).toEqual(['reported 330 psig, the step says 383 psig']);
    expect(r.proposals.find((p) => p.tag === 'P-12-203-E-01B' && p.type === 'review')?.activityName).toBe('Offer for Rotating');
  });
});

describe('day report 30 Oct', () => {
  const d2 = (): TrkData => ({ steps: [], iats: [], log: [], settings: {}, putBack: [], engine: { scopes: [], entries: [], estimates: [], updates: [] },
    equipment: [eq('V-12-209'), eq('P-12-203-E-01A'), eq('R-12-205')],
    activities: [act('V-12-209', 'Demister out', { actualStart: S, actualFinish: S }), act('V-12-209', 'Demister back'), act('P-12-203-E-01A', 'Tube test at 135 psig'), act('R-12-205', 'Dump ceramic balls', { actualStart: S })] } as unknown as TrkData);
  const r = reconcile(d2(), '📌 V-12-209 Demister reinstalled.\n📌 P-12-203-E01-A Parts reinstalled.\n📌 R-12-205 Ceramic balls: 284 drums. Total: 2,640 drums.', MM);
  it('"reinstalled" finishes the "back" step; "E01-A" is the part E-01A; a labelled count is not the total', () => {
    expect(r.proposals.find((p) => p.type === 'finish_step')?.activityName).toBe('Demister back');
    expect(r.proposals.some((p) => p.tag === 'P-12-203-E-01A')).toBe(true);
    expect(r.facts.flatMap((f) => f.qty ?? []).map((q) => q.value)).toEqual([2640]);
  });
});
