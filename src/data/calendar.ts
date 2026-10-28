// Calendar information: Kuwait public holidays and unit events. A shutdown / outage that names unit sections takes
// them down on its dates, and the crews' minimums follow (core/modes); every other event is information only.
import { supabase } from './supabase';
import { dataChanged } from './changes';
import type { UnitSection } from '@/core/modes';

export interface Holiday { id: string; name: string; start: string; end: string; expected: boolean; note: string | null }
export type EventCategory = 'shutdown' | 'startup' | 'maintenance' | 'catalyst' | 'outage' | 'operational' | 'training' | 'other';
export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  shutdown: 'Shutdown', startup: 'Startup', maintenance: 'Major maintenance', catalyst: 'Catalyst activity', outage: 'Unit outage',
  operational: 'Planned operational activity', training: 'Training / team event', other: 'Other'
};
export interface UnitEvent { id: string; category: EventCategory; title: string; unit: string | null; unitCodes: string[]; start: string; end: string; note: string | null; status: 'active' | 'cancelled'; tentative?: boolean; sourceRef?: string | null }
/** Shutdowns and outages can take unit sections down. */
export const TAKES_UNITS_DOWN: EventCategory[] = ['shutdown', 'outage'];

type HRow = { id: string; name: string; start_date: string; end_date: string; expected: boolean; note: string | null };
type ERow = { id: string; category: EventCategory; title: string; unit: string | null; unit_codes: string[] | null; start_date: string; end_date: string; note: string | null; status: 'active' | 'cancelled' };

export async function fetchCalendarInfo(from: string, to: string): Promise<{ holidays: Holiday[]; events: UnitEvent[]; units: string[]; sections: UnitSection[] }> {
  const [h, e, u, s] = await Promise.all([
    supabase.from('public_holidays').select('*').lte('start_date', to).gte('end_date', from).order('start_date'),
    supabase.from('unit_events').select('*').eq('status', 'active').lte('start_date', to).gte('end_date', from).order('start_date'),
    supabase.from('unit_events').select('unit').eq('status', 'active').not('unit', 'is', null),
    supabase.from('unit_sections').select('*').order('sort_order')
  ]);
  for (const r of [h, e, u, s]) if (r.error) throw r.error;
  return {
    holidays: (h.data as HRow[]).map((r) => ({ id: r.id, name: r.name, start: r.start_date, end: r.end_date, expected: r.expected, note: r.note })),
    events: (e.data as ERow[]).map((r) => ({ id: r.id, category: r.category, title: r.title, unit: r.unit, unitCodes: r.unit_codes ?? [], start: r.start_date, end: r.end_date, note: r.note, status: r.status, tentative: !!(r as { tentative?: boolean }).tentative, sourceRef: (r as { source_ref?: string | null }).source_ref ?? null })),
    // every unit / train name in use, sorted: the order gives each one its colour on every month
    units: [...new Set((u.data as { unit: string | null }[]).map((r) => r.unit?.trim()).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b)),
    sections: (s.data as { code: string; label: string; panel_min: number; field_min: number; essential: boolean }[]).map((r) => ({ code: r.code, label: r.label, panelMin: r.panel_min, fieldMin: r.field_min, essential: r.essential }))
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
export async function saveEvent(v: { id?: string; category: EventCategory; title: string; unit: string | null; unitCodes?: string[]; start: string; end: string; note: string | null }) {
  const unitCodes = TAKES_UNITS_DOWN.includes(v.category) ? v.unitCodes ?? [] : [];
  const row = { category: v.category, title: v.title.trim(), unit: v.unit?.trim() || null, unit_codes: unitCodes, start_date: v.start, end_date: v.end, note: v.note };
  const { error } = v.id ? await supabase.from('unit_events').update(row).eq('id', v.id) : await supabase.from('unit_events').insert(row);
  if (error) throw error;
  dataChanged();
}
export async function cancelEvent(id: string, reason: string) {
  const { error } = await supabase.from('unit_events').update({ status: 'cancelled', cancel_reason: reason }).eq('id', id);
  if (error) throw error;
  dataChanged();
}

/**
 * A shutdown plan's sections down on the calendar: its linked shutdown event gets the sections and the plan's dates,
 * or a new shutdown event is added and linked to the plan. The crews' minimums on those dates follow.
 */
export async function markPlanUnitsDown(plan: { id: string; title: string; start: string; end: string; eventId: string | null }, codes: string[], name: string) {
  const row = { category: 'shutdown' as const, unit_codes: codes, unit: name.slice(0, 40) || null, start_date: plan.start, end_date: plan.end };
  if (plan.eventId) {
    const { data, error } = await supabase.from('unit_events').update(row).eq('id', plan.eventId).eq('status', 'active').select('id');
    if (error) throw error;
    if ((data ?? []).length) { dataChanged(); return; }
  }
  const ins = await supabase.from('unit_events').insert({ ...row, title: 'SD' }).select('id').single();
  if (ins.error) throw ins.error;
  const { error } = await supabase.from('sd_plans').update({ event_id: (ins.data as { id: string }).id }).eq('id', plan.id);
  if (error) throw error;
  dataChanged();
}

/** The unit's shutdowns from today on (five-year plan included), for the five-year view on Unit status. */
export async function fetchShutdownOutlook(from: string): Promise<UnitEvent[]> {
  const { data, error } = await supabase.from('unit_events').select('*').eq('status', 'active').eq('category', 'shutdown').gte('end_date', from).neq('unit_codes', '{}').order('start_date');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: r.id as string, category: r.category as UnitEvent['category'], title: r.title as string, unit: (r.unit as string) ?? null, unitCodes: (r.unit_codes as string[]) ?? [],
    start: r.start_date as string, end: r.end_date as string, note: (r.note as string) ?? null, status: r.status as UnitEvent['status'], tentative: !!r.tentative, sourceRef: (r.source_ref as string) ?? null }));
}
