// The working plan's own reads and writes: which days were set by hand (locked) or marked Unavailable, and saving the
// edited days. The days themselves are the members' sd_days rows the plan check, the server and the exports read.
import { supabase } from './supabase';
import { dataChanged } from './changes';
import { updateSdMember } from './shutdown';
import { markKey, type Marks } from '@/core/shutdown/workingPlan';

export async function fetchDayMarks(memberIds: string[]): Promise<Marks> {
  const out: Marks = {};
  if (!memberIds.length) return out;
  const { data, error } = await supabase.from('sd_days').select('member_id,work_date,locked,unavailable').in('member_id', memberIds).or('locked.eq.true,unavailable.eq.true').limit(10000);
  if (error) throw error;
  for (const r of (data ?? []) as { member_id: string; work_date: string; locked: boolean; unavailable: boolean }[]) out[markKey(r.member_id, r.work_date)] = { locked: r.locked, unavailable: r.unavailable };
  return out;
}

export interface SavedDay { memberId: string; date: string; works: boolean; hours: number | null; locked: boolean; unavailable: boolean }
/** Save the changed days (and the members' rest days off their crews that the new days need). */
export async function saveWorkingPlan(rows: SavedDay[], restDays: { memberId: string; days: string[] }[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('sd_days').upsert(rows.slice(i, i + 500).map((r) => ({ member_id: r.memberId, work_date: r.date, works: r.works, hours: r.works ? r.hours : null, locked: r.locked, unavailable: !r.works && r.unavailable })), { onConflict: 'member_id,work_date' });
    if (error) throw error;
  }
  for (const r of restDays) await updateSdMember(r.memberId, { rest_days: r.days });
  dataChanged();
}
