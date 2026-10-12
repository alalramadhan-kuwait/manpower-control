// Leave labels shared by the plan and the profile (the old add / correct sheet is gone: every change to the published
// plan goes through Requests → Entry).
import type { Crew } from '@/core/roster';
import type { LeaveRecord } from '@/data/types';

export interface SheetPerson { id: string; name: string; crew: Crew | null }

export const SOURCE_LABEL: Record<LeaveRecord['source_kind'], string> = { pv_schedule: 'PV plan', monthly_grid: 'Monthly sheet', manual: 'Entered by hand' };

export function changeLabel(c: { change_kind: string; to_start: string | null; by_hand?: boolean }): string {
  const base = c.change_kind === 'added' ? (c.by_hand ? 'Added by hand' : 'Added to current plan')
    : c.change_kind === 'rescheduled' ? (c.to_start ? 'Moved to other dates' : 'Not taken on these dates')
    : c.change_kind === 'cancelled' ? (c.by_hand ? 'Cancelled by hand' : 'Cancelled')
    : c.change_kind === 'corrected' ? 'Corrected by hand'
    : c.change_kind === 'baseline_added' ? 'Added to original plan (later workbook)'
    : c.change_kind === 'source_data_changed' ? 'Source data changed between workbook versions' : c.change_kind;
  return base;
}
