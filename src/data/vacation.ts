// Annual vacation planning: everything the workspace reads, loaded the same way in the app and on the server (the
// vacation-plan function bundles this file), so the check the Section Head sees and the one recorded at approval
// cannot differ. Writes go through the database functions of migration annual_vacation_planning.
import { supabase } from './supabase';
import { dataChanged } from './changes';
import { fetchManpowerInputs } from './manpower';
import { fetchSickEntries } from './sick';
import { fetchAllSdMembers, fetchSdPlans } from './shutdown';
import { personOn, type MpAbsence, type RulesSource } from '@/core/manpower';
import { evaluateAllocation, initialAllocation, type AllocEval, type AllocRow, type Block, type PlanCtx, type PlanPerson } from '@/core/vacation';
import type { Crew } from '@/core/roster';

export type PlanStatus = 'draft' | 'submitted' | 'approved' | 'published';
export interface AllocState { id: string; version: number; status: 'draft' | 'approved' | 'superseded'; approvedAt: string | null; approvedBy: string | null; updatedAt: string; reopenReason: string | null; snapshot: AllocSnapshot | null }
export interface AllocEvent { id: string; action: string; employeeIds: string[]; note: string | null; actor: string | null; at: string; undoneAt: string | null }
export interface PlanState { id: string; year: number; status: PlanStatus; version: number; allocVersion: number | null; updatedAt: string; note: string | null; publishedAt: string | null; events: { action: string; at: string; note: string | null; blocks: number; version: number }[] }
export interface DayPeriod { employeeId: string | null; start: string; end: string; source: 'agreed' | 'proposed' }
export interface UploadRow { id: string; path: string; fileName: string; mime: string | null; formCode: string | null; status: 'uploaded' | 'read' | 'committed' | 'discarded'; result: unknown; uploadedAt: string }
/** What an approved allocation froze: who stood where, acting Panel and the sick figures it used. */
export interface AllocSnapshot { checkedAt: string; rows: { employeeId: string; group: string; crew: Crew | null; relief: string | null; cycleCrew: Crew | null; acting: boolean; sick: number | null; sickAsOf: string | null }[];
  crews: Record<Crew, { controllers: number; panelGroup: number; acting: number; field: number; panelSlots: number; fieldSlots: number }> }

export interface VacationData {
  year: number;
  people: PlanPerson[];
  alloc: AllocState | null;
  rows: AllocRow[];
  /** The rows to start from when no allocation exists yet (where everyone stands on 1 January). */
  initial: AllocRow[];
  events: AllocEvent[];
  plan: PlanState | null;
  blocks: Block[];
  day: DayPeriod[];
  uploads: UploadRow[];
  other: MpAbsence[];
  shutdowns: PlanCtx['shutdowns'];
  rules: RulesSource;
  /** Existing Morning rotations of the year (Controllers calendar), for the Day Supervisor proposal. */
  morning: { employeeId: string; start: string; end: string }[];
  loadedAt: string;
}

interface RowDb { employee_id: string; grp: AllocRow['group']; crew: Crew | null; relief: AllocRow['relief']; cycle_crew: Crew | null; acting: AllocRow['acting']; note: string | null }
const toRow = (r: RowDb): AllocRow => ({ employeeId: r.employee_id, group: r.grp, crew: r.crew, relief: r.relief, cycleCrew: r.cycle_crew, acting: r.acting, note: r.note });
const toDb = (r: AllocRow) => ({ employee_id: r.employeeId, grp: r.group, crew: r.crew, relief: r.relief, cycle_crew: r.cycleCrew, acting: r.acting, note: r.note });

interface AllocDb { id: string; version: number; status: AllocState['status']; approved_at: string | null; approved_by_name: string | null; updated_at: string; reopen_reason: string | null; snapshot: AllocSnapshot | null }
interface PlanDb { id: string; year: number; status: PlanStatus; version: number; alloc_version: number | null; updated_at: string; note: string | null; published_at: string | null }

/** The allocation part (after each change: small and quick). */
export async function loadAllocPart(year: number): Promise<Pick<VacationData, 'alloc' | 'rows' | 'events'>> {
  const { data, error } = await supabase.from('pv_allocs').select('*').eq('year', year).neq('status', 'superseded').maybeSingle();
  if (error) throw error;
  const a = data as AllocDb | null;
  if (!a) return { alloc: null, rows: [], events: [] };
  const [rowsRes, evRes] = await Promise.all([
    supabase.from('pv_alloc_rows').select('employee_id,grp,crew,relief,cycle_crew,acting,note').eq('alloc_id', a.id),
    supabase.from('pv_alloc_events').select('id,action,employee_ids,note,actor_name,at,undone_at').eq('alloc_id', a.id).order('at', { ascending: false }).limit(40)
  ]);
  if (rowsRes.error) throw rowsRes.error; if (evRes.error) throw evRes.error;
  return {
    alloc: { id: a.id, version: a.version, status: a.status, approvedAt: a.approved_at, approvedBy: a.approved_by_name, updatedAt: a.updated_at, reopenReason: a.reopen_reason, snapshot: a.snapshot },
    rows: (rowsRes.data as RowDb[]).map(toRow),
    events: (evRes.data as { id: string; action: string; employee_ids: string[]; note: string | null; actor_name: string | null; at: string; undone_at: string | null }[])
      .map((e) => ({ id: e.id, action: e.action, employeeIds: e.employee_ids, note: e.note, actor: e.actor_name, at: e.at, undoneAt: e.undone_at }))
  };
}

/** The plan part: status, vacations, Day Supervisor rotation, uploads (after each change). */
export async function loadPlanPart(year: number): Promise<Pick<VacationData, 'plan' | 'blocks' | 'day' | 'uploads'>> {
  const { data, error } = await supabase.from('pv_plans').select('id,year,status,version,alloc_version,updated_at,note,published_at').eq('year', year).maybeSingle();
  if (error) throw error;
  const p = data as PlanDb | null;
  if (!p) return { plan: null, blocks: [], day: [], uploads: [] };
  const [blocksRes, dayRes, upRes, peRes] = await Promise.all([
    supabase.from('pv_plan_blocks').select('id,employee_id,start_date,end_date,source').eq('plan_id', p.id).is('removed_at', null).order('start_date'),
    supabase.from('pv_day_rotation').select('employee_id,start_date,end_date,source').eq('plan_id', p.id).is('removed_at', null).order('start_date'),
    supabase.from('pv_form_uploads').select('id,path,file_name,mime,form_code,status,result,uploaded_at').eq('plan_id', p.id).neq('status', 'discarded').order('uploaded_at', { ascending: false }),
    supabase.from('pv_plan_events').select('action,at,note,blocks,version').eq('plan_id', p.id).order('at', { ascending: false })
  ]);
  for (const r of [blocksRes, dayRes, upRes, peRes]) if (r.error) throw r.error;
  return {
    plan: { id: p.id, year: p.year, status: p.status, version: p.version, allocVersion: p.alloc_version, updatedAt: p.updated_at, note: p.note, publishedAt: p.published_at, events: peRes.data as PlanState['events'] },
    blocks: (blocksRes.data as { id: string; employee_id: string; start_date: string; end_date: string; source: Block['source'] }[]).map((b) => ({ id: b.id, employeeId: b.employee_id, start: b.start_date, end: b.end_date, source: b.source })),
    day: (dayRes.data as { employee_id: string | null; start_date: string; end_date: string; source: DayPeriod['source'] }[]).map((d) => ({ employeeId: d.employee_id, start: d.start_date, end: d.end_date, source: d.source })),
    uploads: (upRes.data as { id: string; path: string; file_name: string; mime: string | null; form_code: string | null; status: UploadRow['status']; result: unknown; uploaded_at: string }[])
      .map((u) => ({ id: u.id, path: u.path, fileName: u.file_name, mime: u.mime, formCode: u.form_code, status: u.status, result: u.result, uploadedAt: u.uploaded_at }))
  };
}

/** Everything for one plan year. */
export async function loadVacation(year: number): Promise<VacationData> {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const [inputs, dirRes, allocPart, planPart, sdPlans, sdMembers, morningRes] = await Promise.all([
    fetchManpowerInputs(from, `${year + 1}-01-31`),
    supabase.from('employee_directory_v').select('id,crew_code,position_code').eq('in_unit12_scope', true).eq('is_active', true),
    loadAllocPart(year), loadPlanPart(year),
    fetchSdPlans(), fetchAllSdMembers(),
    supabase.from('controller_assignments').select('employee_id,start_date,end_date').eq('kind', 'morning_rotation').eq('status', 'active').lte('start_date', to).gte('end_date', from)
  ]);
  for (const r of [dirRes, morningRes]) if (r.error) throw r.error;
  const dir = new Map((dirRes.data as { id: string; crew_code: Crew | null; position_code: string | null }[]).map((r) => [r.id, r]));
  const sick = await fetchSickEntries(inputs.people.map((p) => p.id));
  const people: PlanPerson[] = inputs.people.map((p) => {
    const on = personOn(p, from);
    const d = dir.get(p.id);
    const s = sick.get(p.id);
    return { id: p.id, name: p.name, number: p.employeeNumber, grade: p.grade, position: p.role, employmentType: p.employmentType, takeCharge: p.takeCharge,
      panelQualified: p.panelQualified, actingController: p.actingController, dirCrew: d?.crew_code ?? null,
      crew: on.dayDuty ? on.movedFrom ?? null : on.crew, dayDuty: !!on.dayDuty, placement: p.role === 'vr_controller' ? on.crew : null,
      sick: s ? { days: s.days, asOf: s.asOf } : null };
  }).sort((a, b) => a.name.localeCompare(b.name));
  const planIds = new Set(sdPlans.map((x) => x.id));
  const titles = new Map(sdPlans.map((x) => [x.id, x.title]));
  const shutdowns = sdMembers.filter((m) => planIds.has(m.planId) && m.start <= `${year + 1}-01-31` && m.end >= from).map((m) => ({ employeeId: m.employeeId, start: m.start, end: m.end, title: titles.get(m.planId) ?? 'Shutdown' }));
  // other leave and task releases stay as they are; this plan's own published PV is the plan itself
  const own = planPart.plan ? `pv_plan:${planPart.plan.id}:` : '\u0000';
  const other = inputs.absencesAll.filter((x) => !(x.sourceRef ?? '').startsWith(own));
  return {
    year, people, ...allocPart, ...planPart, initial: initialAllocation(people), other, shutdowns, rules: inputs.rules,
    morning: (morningRes.data as { employee_id: string; start_date: string; end_date: string }[]).map((m) => ({ employeeId: m.employee_id, start: m.start_date, end: m.end_date })),
    loadedAt: new Date().toISOString()
  };
}

/** The rows in use: the saved allocation, or (none yet) where everyone stands. */
export const rowsOf = (d: VacationData) => (d.alloc ? d.rows : d.initial);
export function evaluate(d: VacationData): AllocEval { return evaluateAllocation(d.people, rowsOf(d)); }
export function planCtx(d: VacationData, blocks: Block[] = d.blocks): PlanCtx {
  const rows = rowsOf(d);
  return { year: d.year, people: d.people, rows, alloc: evaluateAllocation(d.people, rows), blocks, other: d.other, shutdowns: d.shutdowns, rules: d.rules };
}

/** The snapshot an approval freezes (built on the server from the same data). */
export function snapshotOf(d: VacationData, ev: AllocEval): AllocSnapshot {
  const rows = rowsOf(d).map((r) => { const p = d.people.find((x) => x.id === r.employeeId);
    return { employeeId: r.employeeId, group: r.group, crew: r.crew, relief: r.relief, cycleCrew: r.cycleCrew, acting: ev.placed.get(r.employeeId)?.acting ?? false, sick: p?.sick?.days ?? null, sickAsOf: p?.sick?.asOf ?? null }; });
  const crews = Object.fromEntries((['A', 'B', 'C', 'D'] as Crew[]).map((c) => { const x = ev.crews[c];
    return [c, { controllers: x.controllers.length, panelGroup: x.panelGroup, acting: x.acting.length, field: x.fieldEligible.length, panelSlots: x.panelSlots, fieldSlots: x.fieldSlots }]; })) as AllocSnapshot['crews'];
  return { checkedAt: new Date().toISOString(), rows, crews };
}

const plain = (e: { message: string }) => new Error(e.message.replace(/^STALE_CHECK:\s*/, ''));
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw plain(error);
  dataChanged();
  return data as T;
}

export const startAllocation = (year: number, rows: AllocRow[]) => rpc<string>('pv_alloc_init', { p_year: year, p_rows: rows.map(toDb) });
export const setAllocation = (year: number, r: AllocRow) =>
  rpc<string>('pv_alloc_set', { p_year: year, p_employee: r.employeeId, p_grp: r.group, p_crew: r.crew, p_relief: r.relief, p_cycle_crew: r.cycleCrew, p_acting: r.acting, p_note: r.note });
export const switchAllocation = (year: number, a: string, b: string) => rpc<string>('pv_alloc_switch', { p_year: year, p_a: a, p_b: b });
export const undoAllocation = (year: number, event?: string) => rpc<string>('pv_alloc_undo', { p_year: year, p_event: event ?? null });
export const reopenAllocation = (year: number, reason: string) => rpc<number>('pv_alloc_reopen', { p_year: year, p_reason: reason });
export const saveBlocks = (year: number, employeeId: string, blocks: Pick<Block, 'start' | 'end' | 'source'>[], uploadId?: string) =>
  rpc<number>('pv_draft_set', { p_year: year, p_employee: employeeId, p_blocks: blocks.map((b) => ({ start: b.start, end: b.end, source: b.source, upload_id: uploadId ?? null })) });
export const submitPlan = (year: number, note: string) => rpc<void>('pv_plan_submit', { p_year: year, p_note: note || null });
export const returnPlan = (year: number, note: string) => rpc<void>('pv_plan_return', { p_year: year, p_note: note });
export const saveDayRotation = (year: number, rows: DayPeriod[]) =>
  rpc<number>('pv_day_rotation_set', { p_year: year, p_rows: rows.map((r) => ({ employee_id: r.employeeId, start: r.start, end: r.end, source: r.source })) });

/** Server check and approval (edge function vacation-plan): the app's own check is never trusted for an approval. */
export interface GateResult { ok: boolean; issues: { level: 'error' | 'warning'; text: string }[]; result?: number; error?: string }
export async function vacationGate(action: 'check_alloc' | 'approve_alloc' | 'check_plan' | 'approve_plan', year: number): Promise<GateResult> {
  const { data, error } = await supabase.functions.invoke('vacation-plan', { body: { action, year } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    throw new Error((body as { error?: string } | null)?.error ?? error.message);
  }
  dataChanged();
  return data as GateResult;
}

/** A completed form, stored privately (manpower staff only), recorded before it is read. */
export async function uploadForm(year: number, file: File): Promise<{ id: string; path: string }> {
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  const path = `${year}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('pv-forms').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw plain(error);
  const id = await rpc<string>('pv_form_upload_add', { p_year: year, p_path: path, p_file_name: file.name, p_mime: file.type || null });
  return { id, path };
}
export const updateUpload = (id: string, status: UploadRow['status'], formCode: string | null, result: unknown) =>
  rpc<void>('pv_form_upload_update', { p_id: id, p_status: status, p_form_code: formCode, p_result: result ?? null });
export async function downloadUpload(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from('pv-forms').download(path);
  if (error) throw plain(error);
  return data;
}

/** The leave records the plan became (for the final plan and its changes after approval). */
export interface PublishedLeave { id: string; employeeId: string; start: string; end: string; status: string; inCurrentPlan: boolean; inOriginalPlan: boolean; sourceRef: string | null; rootId: string; note: string | null }
export async function fetchPublished(year: number): Promise<PublishedLeave[]> {
  const { data, error } = await supabase.from('leave_records').select('id,employee_id,start_date,end_date,status,in_current_plan,in_original_plan,source_ref,root_id,note')
    .eq('plan_year', year).in('absence_type_code', ['annual_leave_planned', 'annual_leave_rescheduled']).order('start_date');
  if (error) throw error;
  return (data as { id: string; employee_id: string; start_date: string; end_date: string; status: string; in_current_plan: boolean; in_original_plan: boolean; source_ref: string | null; root_id: string; note: string | null }[])
    .map((r) => ({ id: r.id, employeeId: r.employee_id, start: r.start_date, end: r.end_date, status: r.status, inCurrentPlan: r.in_current_plan, inOriginalPlan: r.in_original_plan, sourceRef: r.source_ref, rootId: r.root_id, note: r.note }));
}

// ── sick leave, rolling 12 months (Excel: name, Civil ID, days) ─────────────────────────────────────────────────
/** One-way hash of a Civil ID (digits only). The ID itself is never sent or stored. */
export async function civilHash(digits: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ards-civil-v1:${digits}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function fetchCivilLinks(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('employee_civil_ids').select('employee_id,civil_hash');
  if (error) throw error;
  return new Map((data as { employee_id: string; civil_hash: string }[]).map((r) => [r.civil_hash, r.employee_id]));
}
export async function fetchStaffNames(): Promise<{ id: string; names: string[] }[]> {
  const { data, error } = await supabase.from('employee_directory_v').select('id,display_name,official_name,short_name').eq('is_active', true).eq('in_unit12_scope', true);
  if (error) throw error;
  return (data as { id: string; display_name: string; official_name: string | null; short_name: string | null }[]).map((r) => ({ id: r.id, names: [r.display_name, r.official_name, r.short_name].filter(Boolean) as string[] }));
}
export interface SickImportRow { employee_id: string; civil_hash: string; last4: string; days: number; link: boolean }
export const commitSickImport = (v: { fileName: string; fileHash: string; periodStart: string; periodEnd: string; rows: SickImportRow[]; summary: Record<string, unknown> }) =>
  rpc<string>('sick_import_commit', { p_file_name: v.fileName, p_file_hash: v.fileHash, p_period_start: v.periodStart, p_period_end: v.periodEnd, p_rows: v.rows, p_summary: v.summary });
export async function fetchSickImports(): Promise<{ fileName: string; periodStart: string; periodEnd: string; matched: number; unmatched: number; changed: number; by: string | null; at: string }[]> {
  const { data, error } = await supabase.from('sick_imports').select('file_name,period_start,period_end,matched,unmatched,changed,imported_by_name,imported_at').order('imported_at', { ascending: false }).limit(5);
  if (error) throw error;
  return (data as { file_name: string; period_start: string; period_end: string; matched: number; unmatched: number; changed: number; imported_by_name: string | null; imported_at: string }[])
    .map((r) => ({ fileName: r.file_name, periodStart: r.period_start, periodEnd: r.period_end, matched: r.matched, unmatched: r.unmatched, changed: r.changed, by: r.imported_by_name, at: r.imported_at }));
}
