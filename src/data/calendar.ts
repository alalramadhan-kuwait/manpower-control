// Calendar information: Kuwait public holidays and unit events. Information only (no effect on minimums).
import { supabase } from './supabase';
import { dataChanged } from './changes';

export interface Holiday { id: string; name: string; start: string; end: string; expected: boolean; note: string | null }
export type EventCategory = 'shutdown' | 'startup' | 'maintenance' | 'catalyst' | 'outage' | 'operational' | 'training' | 'other';
export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  shutdown: 'Shutdown', startup: 'Startup', maintenance: 'Major maintenance', catalyst: 'Catalyst activity', outage: 'Unit outage',
  operational: 'Planned operational activity', training: 'Training / team event', other: 'Other'
};
export interface UnitEvent { id: string; category: EventCategory; title: string; unit: string | null; start: string; end: string; note: string | null; status: 'active' | 'cancelled' }

type HRow = { id: string; name: string; start_date: string; end_date: string; expected: boolean; note: string | null };
type ERow = { id: string; category: EventCategory; title: string; unit: string | null; start_date: string; end_date: string; note: string | null; status: 'active' | 'cancelled' };

export async function fetchCalendarInfo(from: string, to: string): Promise<{ holidays: Holiday[]; events: UnitEvent[]; units: string[] }> {
  const [h, e, u] = await Promise.all([
    supabase.from('public_holidays').select('*').lte('start_date', to).gte('end_date', from).order('start_date'),
    supabase.from('unit_events').select('*').eq('status', 'active').lte('start_date', to).gte('end_date', from).order('start_date'),
    supabase.from('unit_events').select('unit').eq('status', 'active').not('unit', 'is', null)
  ]);
  for (const r of [h, e, u]) if (r.error) throw r.error;
  return {
    holidays: (h.data as HRow[]).map((r) => ({ id: r.id, name: r.name, start: r.start_date, end: r.end_date, expected: r.expected, note: r.note })),
    events: (e.data as ERow[]).map((r) => ({ id: r.id, category: r.category, title: r.title, unit: r.unit, start: r.start_date, end: r.end_date, note: r.note, status: r.status })),
    // every unit / train name in use, sorted: the order gives each one its colour on every month
    units: [...new Set((u.data as { unit: string | null }[]).map((r) => r.unit?.trim()).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b))
  };
}

export async function saveHoliday(v: { id?: string; name: string; start: string; end: string; expected: boolean; note: string | null }) {
  const row = { name: v.name.trim(), start_date: v.start, end_date: v.end, expected: v.expected, note: v.note };
  const { error } = v.id ? await supabase.from('public_holidays').update(row).eq('id', v.id) : await supabase.from('public_holidays').insert(row);
  if (error) throw error;
  dataChanged();
}
export async function deleteHoliday(id: string) {
  const { error } = await supabase.from('public_holidays').delete().eq('id', id);
  if (error) throw error;
  dataChanged();
}
export async function saveEvent(v: { id?: string; category: EventCategory; title: string; unit: string | null; start: string; end: string; note: string | null }) {
  const row = { category: v.category, title: v.title.trim(), unit: v.unit?.trim() || null, start_date: v.start, end_date: v.end, note: v.note };
  const { error } = v.id ? await supabase.from('unit_events').update(row).eq('id', v.id) : await supabase.from('unit_events').insert(row);
  if (error) throw error;
  dataChanged();
}
export async function cancelEvent(id: string, reason: string) {
  const { error } = await supabase.from('unit_events').update({ status: 'cancelled', cancel_reason: reason }).eq('id', id);
  if (error) throw error;
  dataChanged();
}
