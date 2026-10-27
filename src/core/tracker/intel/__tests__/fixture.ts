import type { TrkActivity, TrkData, TrkEquipment } from '../..';
import type { ReportMeta } from '..';
const eq = (tag: string, more: Partial<TrkEquipment> = {}): TrkEquipment => ({ id: `eq-${tag}`, tag, group: 'G', description: null, fo: null, hoStep: null, procedure: null, barchartKey: tag, opsItem: false, critical: false, tracked: true,
  disabledReason: null, plannedHo: null, plannedFinish: null, sort: 0, stage: 2, pendingReason: null, remark: null, blindsIn: null, blindsOut: null, updatedBy: null, updatedAt: '2026-10-24T06:00:00Z', ...more });
let seq = 0;
const act = (key: string, activity: string, more: Partial<TrkActivity> = {}): TrkActivity => ({ id: `${key}:${++seq}`, activityId: `A${seq}`, group: 'M', key, activity, durationH: 12, start: '2026-10-22T04:00:00Z', finish: '2026-10-23T04:00:00Z', stage: 2, tracked: true, updatedAt: '2026-10-24T06:00:00Z', ...more });
const S = '2026-10-25T04:00:00Z', F = '2026-10-25T16:00:00Z';
export function data(): TrkData {
  seq = 0;
  return { steps: [], iats: [], log: [], settings: { miEnd: '2026-11-07T04:00:00Z', end: '2026-11-07' },
    equipment: [eq('R-12-205', { remark: 'Vacuum dumping I/P (1708 drums)' }), eq('H-12-201'), eq('R-12-201'), eq('R-12-203'), eq('R-12-204'), eq('R-12-202'), eq('E-12-216A', { combine: 'E-12-216A/B' }), eq('E-12-216B', { combine: 'E-12-216A/B' }),
      eq('V-12-213'), eq('F-12-202'), eq('E-12-204'), eq('E-12-205')],
    activities: [
      act('R-12-205', 'Dump Catalyst by Double Vacuum', { actualStart: S, activityId: 'A5410' }), act('R-12-205', 'Open windows & doors of Johnson screen'),
      act('H-12-201', 'Burners down', { actualStart: S, actualFinish: F }), act('H-12-201', 'Burner cleaning', { actualStart: F }), act('H-12-201', 'Fix back burners', { stage: 5 }), act('H-12-201', 'Buffing of outlet header', { actualStart: S }), act('H-12-201', 'Dye penetrant test of outlet header'),
      act('R-12-201', 'Repair of thermowell brackets'), act('R-12-203', 'Repair of thermowell brackets'), act('R-12-204', 'Repair of thermowell brackets'),
      act('R-12-202', 'Cleaning all internal by Hydrojet', { actualStart: S }), act('R-12-202', 'Outlet de-choking', { actualStart: S }), act('R-12-202', 'Offer for Process', { stage: 3 }), act('R-12-202', 'Repair if required', { stage: 4 }),
      act('E-12-216A', 'H-Blast Tube bundle using 2% soda ash'), act('E-12-216A', 'Eddy current inspection', { stage: 3 }), act('E-12-216B', 'H-Blast Tube bundle using 2% soda ash'), act('E-12-216B', 'Eddy current inspection', { stage: 3 }),
      act('V-12-213', 'Internal cleaning by Hydrojetting', { actualStart: S, actualFinish: F }), act('V-12-213', 'PSV header buffing', { actualStart: F }), act('V-12-213', 'Dye penetrant test of PSV header'), act('V-12-213', 'PE / OP inspection', { stage: 3 }),
      act('F-12-202', 'Remove connecting spools', { actualStart: S }), act('F-12-202', 'Hydroblasting Cleaning', { actualStart: S }), act('F-12-202', 'Inspection by Process', { stage: 3 }), act('F-12-202', 'Re-fix filter element (New)', { stage: 5 }), act('F-12-202', 'Fix back spools', { stage: 5 }),
      act('E-12-204', 'Bundle hydroblasting', { actualStart: S })],
    engine: { scopes: [{ id: 'sc5', key: 'R-12-205', scope: 'removal', unit: 'drums', low: null, high: null, initial: 2400, working: 2400, activityIds: ['A5410'], completeAt: null, completeBy: null }],
      entries: [{ id: 'e1', scopeId: 'sc5', shiftDate: '2026-10-25', shift: 'D', kind: 'removal', method: 'vacuum', qty: 1708, verify: 'verified', remark: null, source: 'app', enteredBy: null, stoppage: null, corrects: null }], estimates: [], updates: [] },
    putBack: [{ id: 'v1', tag: 'HV-546A', kind: 'control_valve', what: null, status: 'removed', removedAt: null, servicedAt: null, installedAt: null, source: null, remark: null, updatedBy: null },
      { id: 'v2', tag: 'FV-003B', kind: 'other', what: null, status: 'removed', removedAt: null, servicedAt: null, installedAt: null, source: null, remark: null, updatedBy: null }],
  } as unknown as TrkData;
}
export const META: ReportMeta = { department: 'shift_ops', reportDate: '2026-10-26', shift: 'D', reporter: null, submittedAt: '2026-10-26T15:30:00Z' };
export const MM: ReportMeta = { ...META, department: 'mech_maint' };
