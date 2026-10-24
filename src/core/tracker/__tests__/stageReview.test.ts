// Stage review: items whose stage and finished steps disagree; a finished step never stands for a handover.
import { describe, expect, it } from 'vitest';
import { stageReview, type EquipView, type TrkData } from '..';

const eq = (tag: string, sort = 0) => ({ id: tag, tag, barchartKey: tag, tracked: true, sort }) as never;
const view = (tag: string, stage: number, sort = 0) => ({ eq: eq(tag, sort), stage }) as unknown as EquipView;
const act = (key: string, stage: number | null, start: boolean, finish: boolean, group = 'Mech') =>
  ({ id: `${key}-${stage}-${start}-${finish}`, activityId: 'A', key, group, activity: 'x', stage, tracked: true, detail: false, actualStart: start ? '2026-10-22T08:00:00Z' : null, actualFinish: finish ? '2026-10-22T10:00:00Z' : null }) as never;
const data = (activities: unknown[]) => ({ activities }) as unknown as TrkData;

describe('stage review', () => {
  it('blinded but not handed over: flagged, never moved', () => {
    const r = stageReview(data([act('C-201-ST', 1, true, true), act('C-201-ST', 4, true, false)]), [view('C-201-ST', 0)]);
    expect(r.map((x) => [x.eq.tag, x.issue, x.stage])).toEqual([['C-201-ST', 'ho_missing', 0]]);
  });
  it('blinding still running before handover is the normal process, not an issue', () => {
    expect(stageReview(data([act('V-209', 1, true, false)]), [view('V-209', 0)])).toEqual([]);
  });
  it('handed over and the finished steps reach a later stage: behind, with the steps stage', () => {
    const r = stageReview(data([act('E-204', 3, true, true)]), [view('E-204', 1)]);
    expect(r.map((x) => [x.issue, x.steps])).toEqual([['behind', 3]]);
  });
  it('stage further than the steps is shown, low priority; Operations steps do not count', () => {
    const r = stageReview(data([act('V-201', 2, true, true), act('V-201', 5, true, true, 'Operations')]), [view('V-201', 3)]);
    expect(r.map((x) => [x.issue, x.steps])).toEqual([['ahead', 2]]);
  });
  it('work started on steps with no stage: the stage cannot follow', () => {
    expect(stageReview(data([act('P-207', null, true, false)]), [view('P-207', 1)]).map((x) => x.issue)).toEqual(['no_stage']);
  });
  it('the order puts the handover gaps first', () => {
    const r = stageReview(data([act('A', 3, true, true), act('B', 1, true, true)]), [view('A', 1, 0), view('B', 0, 1)]);
    expect(r.map((x) => x.eq.tag)).toEqual(['B', 'A']);
  });
});
