// Stage I operating modes: modes (minimums per crew) and the periods they apply. Every write is audited in the database.
import { supabase } from './supabase';
import { dataChanged } from './changes';
import type { OperatingMode, OperationPeriod, OperationPlan } from '@/core/modes';

interface ModeRow { code: string; label: string; controller_min: number; panel_min: number; panel_grade14_min: number; field_min: number; is_default: boolean; is_active: boolean; note: string | null; sort_order: number }
export interface PeriodRow { id: string; mode_code: string; start_date: string; end_date: string; note: string | null; status: 'active' | 'cancelled'; created_at: string; cancel_reason: string | null }

const toMode = (r: ModeRow): OperatingMode => ({ code: r.code, label: r.label, controllerMin: r.controller_min, panelMin: r.panel_min, panelGrade14Min: r.panel_grade14_min, fieldMin: r.field_min, isDefault: r.is_default, isActive: r.is_active, note: r.note });
export const toPeriod = (r: PeriodRow): OperationPeriod => ({ id: r.id, modeCode: r.mode_code, start: r.start_date, end: r.end_date, note: r.note, status: r.status });

function plain(error: { message: string; code?: string }): Error {
  if (error.message.includes('op_no_overlap')) return new Error('Another period already covers some of these dates. Change or cancel it first.');
  if (error.message.includes('om_grade14_within_panel')) return new Error('Panel Grade 14+ cannot be more than the Panel minimum.');
  if (error.code === '23505' || /duplicate key/.test(error.message)) return new Error('A mode with this name already exists.');
  if (/row-level security/.test(error.message)) return new Error('Only the Section Head can change operating modes.');
  return new Error(error.message);
}

/** Modes, and active periods overlapping from..to (all periods when no range is given). */
export async function fetchOperationPlan(from?: string, to?: string): Promise<{ plan: OperationPlan; periods: PeriodRow[] }> {
  let pq = supabase.from('operation_periods').select('*').order('start_date');
  if (from && to) pq = pq.eq('status', 'active').lte('start_date', to).gte('end_date', from);
  const [m, p] = await Promise.all([supabase.from('operating_modes').select('*').order('sort_order').order('label'), pq]);
  if (m.error) throw m.error; if (p.error) throw p.error;
  const periods = p.data as PeriodRow[];
  return { plan: { modes: (m.data as ModeRow[]).map(toMode), periods: periods.map(toPeriod) }, periods };
}

const codeOf = (label: string) => label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'mode';

export async function saveMode(v: { code?: string; label: string; controllerMin: number; panelMin: number; panelGrade14Min: number; fieldMin: number; note: string | null; isActive?: boolean }) {
  const row = { label: v.label.trim(), controller_min: v.controllerMin, panel_min: v.panelMin, panel_grade14_min: v.panelGrade14Min, field_min: v.fieldMin, note: v.note, ...(v.isActive !== undefined ? { is_active: v.isActive } : {}) };
  const { error } = v.code ? await supabase.from('operating_modes').update(row).eq('code', v.code) : await supabase.from('operating_modes').insert({ ...row, code: codeOf(v.label) });
  if (error) throw plain(error);
  dataChanged();
}
export async function schedulePeriod(v: { modeCode: string; start: string; end: string; note: string | null }) {
  const { error } = await supabase.from('operation_periods').insert({ mode_code: v.modeCode, start_date: v.start, end_date: v.end, note: v.note });
  if (error) throw plain(error);
  dataChanged();
}
export async function cancelPeriod(id: string, reason: string) {
  const { error } = await supabase.from('operation_periods').update({ status: 'cancelled', cancel_reason: reason }).eq('id', id);
  if (error) throw plain(error);
  dataChanged();
}
