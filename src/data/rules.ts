// Rules page data: every organization rule with its current value, its allowed range and its history. Changes go only
// through `app_rule_set` (Section Head, reason required, kept in the history). `loadAppRules` writes the rules kept in
// `app_rules` into the numbers the app computes with; the app and every server check call it before computing.
// Server-safe: no browser storage here (the device cache is in rulesClient.ts).
import { supabase } from './supabase';
import { dataChanged } from './changes';
import { applyRuleValues, RULE_DEFS, type RuleBounds, type RuleDef, type RuleValue } from '@/core/rules';

export interface RuleRow {
  key: string; def: RuleDef; title: string; value: RuleValue; bounds: RuleBounds;
  updatedAt: string | null; updatedBy: string | null;
}
export interface RuleChange { id: string; key: string; oldValue: RuleValue | null; newValue: RuleValue; reason: string; by: string | null; at: string }

type Raw = { key: string; grp: string; sort: number; value: RuleValue | null; bounds: RuleBounds; updated_by_name: string | null; updated_at: string | null };

/** Read the rules kept in `app_rules` and apply them. Never throws: a missing table keeps the numbers in code. */
export async function loadAppRules(): Promise<Record<string, RuleValue | null>> {
  const { data, error } = await supabase.from('app_rules').select('key,value');
  if (error || !data) return {};
  const values = Object.fromEntries((data as { key: string; value: RuleValue | null }[]).map((r) => [r.key, r.value]));
  applyRuleValues(values);
  return values;
}

/** Every rule with its value, wherever it is kept, in page order. */
export async function fetchRules(): Promise<RuleRow[]> {
  const [rules, modes, sections, checks, ctl] = await Promise.all([
    supabase.from('app_rules').select('key,grp,sort,value,bounds,updated_by_name,updated_at').order('sort'),
    supabase.from('operating_modes').select('code,label,controller_min,panel_min,field_min,sort_order,is_active').order('sort_order'),
    supabase.from('unit_sections').select('code,label,panel_min,field_min,sort_order').order('sort_order'),
    supabase.from('validation_rules').select('code,params,enabled'),
    supabase.from('controller_rules').select('shift_cover_max_days').eq('id', 1).maybeSingle()
  ]);
  for (const r of [rules, modes, sections, checks, ctl]) if (r.error) throw r.error;
  const raw = new Map(((rules.data ?? []) as Raw[]).map((r) => [r.key, r]));
  const vr = new Map(((checks.data ?? []) as { code: string; params: Record<string, unknown>; enabled: boolean }[]).map((r) => [r.code, r]));
  const p = (code: string, k: string) => (vr.get(code)?.params?.[k] ?? null) as number | string | null;
  const out: RuleRow[] = [];
  for (const def of RULE_DEFS) {
    const r = raw.get(def.key);
    if (!r) continue;
    const row = (key: string, title: string, value: RuleValue): RuleRow => ({ key, def, title, value, bounds: r.bounds ?? {}, updatedAt: r.updated_at, updatedBy: r.updated_by_name });
    if (def.key === 'crew.mode') {
      for (const m of (modes.data ?? []) as { code: string; label: string; controller_min: number; panel_min: number; field_min: number }[])
        out.push(row(`crew.mode.${m.code}`, `${m.label}: minimum crew`, { controller: m.controller_min, panel: m.panel_min, field: m.field_min }));
    } else if (def.key === 'crew.section') {
      for (const s of (sections.data ?? []) as { code: string; label: string; panel_min: number; field_min: number }[])
        out.push(row(`crew.section.${s.code}`, `${s.label}: section minimum`, { panel: s.panel_min, field: s.field_min }));
    } else if (def.key === 'ctl.cover_max') out.push(row(def.key, def.label, { days: (ctl.data as { shift_cover_max_days: number | null } | null)?.shift_cover_max_days ?? null }));
    else if (def.key === 'chk.consecutive') out.push(row(def.key, def.label, { max: p('max_consecutive_duty_days', 'max') }));
    else if (def.key === 'chk.change_rest') out.push(row(def.key, def.label, { hours: p('shift_type_change_rest', 'hours') }));
    else if (def.key === 'chk.min_rest') out.push(row(def.key, def.label, { hours: vr.get('min_rest_hours')?.enabled ? p('min_rest_hours', 'hours') : null }));
    else if (def.key === 'chk.shift_times') { const t = vr.get('shift_times')?.params ?? {}; out.push(row(def.key, def.label, Object.fromEntries(def.fields.map((f) => [f.name, (t[f.name] ?? null) as number | string | null])))); }
    else out.push(row(def.key, def.label, (r.value ?? {}) as RuleValue));
  }
  return out;
}

/** The Section Head changes one rule. The server checks the range and keeps the change with the reason. */
export async function setRule(key: string, value: RuleValue, reason: string) {
  const { error } = await supabase.rpc('app_rule_set', { p_key: key, p_value: value, p_reason: reason.trim() });
  if (error) throw error;
  const values = await loadAppRules();
  dataChanged();
  return values;
}

export async function fetchRuleChanges(key?: string): Promise<RuleChange[]> {
  let q = supabase.from('app_rule_changes').select('id,key,old_value,new_value,reason,by_name,at').order('at', { ascending: false }).limit(200);
  if (key) q = q.eq('key', key);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as { id: string; key: string; old_value: RuleValue | null; new_value: RuleValue; reason: string; by_name: string | null; at: string }[])
    .map((r) => ({ id: r.id, key: r.key, oldValue: r.old_value, newValue: r.new_value, reason: r.reason, by: r.by_name, at: r.at }));
}

