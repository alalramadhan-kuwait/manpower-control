// One shutdown, one page (owner, 28 Oct 2026): every Calendar shutdown with its team plan and tracker, and the parts
// that belong to the shutdown itself: the start-up steps (standard hours vs actual) and the shutdown & start-up file.
// A team plan made before shutdowns were on the Calendar (no event) is still a shutdown of its own ("p-<plan id>").
import type { SdPlan } from '@/core/shutdown';
import type { ProfileRow } from '@/core/shutdown/profile';
import type { CutinSpec, PointKey, ReactorKey } from '@/core/shutdown/wave';
import type { DelayReason } from '@/core/shutdown/stages';
import { fetchSdPlans } from './shutdown';
import { supabase } from './supabase';
import { fetchTrackers, type Tracker } from './tracker';

export interface ShutdownEntry {
  key: string; eventId: string | null; category: 'shutdown' | 'outage' | null; plan: SdPlan | null; tracker: Tracker | null;
  title: string; unit: string | null; unitCodes: string[]; start: string; end: string; tentative: boolean; sourceRef: string | null; note: string | null;
}

/** The tracker of a shutdown: the live one (a test or template copy is not the shutdown's record). */
const trackerOf = (list: Tracker[], eventId: string) => list.find((t) => t.eventId === eventId && t.mode === 'live' && t.status === 'active') ?? list.find((t) => t.eventId === eventId && t.mode === 'live') ?? null;

/** Every shutdown, oldest first: the Calendar shutdowns and outages (tentative ones included) and the team plans with no event. */
export async function fetchShutdownIndex(): Promise<ShutdownEntry[]> {
  const [ev, plans, trackers] = await Promise.all([
    supabase.from('unit_events').select('*').eq('status', 'active').in('category', ['shutdown', 'outage']).order('start_date'),
    fetchSdPlans(), fetchTrackers().catch(() => [] as Tracker[])
  ]);
  if (ev.error) throw ev.error;
  const out: ShutdownEntry[] = ((ev.data ?? []) as Record<string, unknown>[]).map((r) => {
    const id = r.id as string;
    return { key: id, eventId: id, category: r.category as 'shutdown' | 'outage', plan: plans.find((p) => p.eventId === id) ?? null, tracker: trackerOf(trackers, id),
      title: r.title as string, unit: (r.unit as string) ?? null, unitCodes: (r.unit_codes as string[]) ?? [], start: r.start_date as string, end: r.end_date as string,
      tentative: !!r.tentative, sourceRef: (r.source_ref as string) ?? null, note: (r.note as string) ?? null };
  });
  for (const p of plans) if (!p.eventId || !out.some((e) => e.eventId === p.eventId))
    out.push({ key: `p-${p.id}`, eventId: null, category: null, plan: p, tracker: null, title: p.title, unit: null, unitCodes: [], start: p.start, end: p.end, tentative: false, sourceRef: null, note: null });
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** A shutdown's name as people say it: the unit, then the title ("Train-2 · SD"). */
export const entryName = (e: Pick<ShutdownEntry, 'unit' | 'title'>) => (e.unit && !e.title.includes(e.unit) ? `${e.unit} · ${e.title}` : e.title);

/** The Calendar events that take unit sections down (shutdowns and outages), for each section's run record. */
export interface DownRow { id: string; category: string; title: string; unit: string | null; unitCodes: string[]; start: string; end: string; note: string | null; tentative: boolean }
export async function fetchDownEvents(): Promise<DownRow[]> {
  const { data, error } = await supabase.from('unit_events').select('id,category,title,unit,unit_codes,start_date,end_date,note,tentative').eq('status', 'active').in('category', ['shutdown', 'outage']).neq('unit_codes', '{}').order('start_date');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: r.id as string, category: r.category as string, title: r.title as string, unit: (r.unit as string) ?? null, unitCodes: (r.unit_codes as string[]) ?? [],
    start: r.start_date as string, end: r.end_date as string, note: (r.note as string) ?? null, tentative: !!r.tentative }));
}

// ── Start-up steps ────────────────────────────────────────────────────────────────────────────────────────────
export type StartupStatus = 'not_started' | 'running' | 'done' | 'not_required';
export interface StartupStep { id: string; seq: number; title: string; stdHours: number | null; procedureRef: string | null; status: StartupStatus;
  startedAt: string | null; doneAt: string | null; reason: string | null; remark: string | null; updatedAt: string | null; updatedBy: string | null;
  /** why it ran over / started late, and why it waited before it (a quick choice and a note) */
  delayReason: DelayReason | null; delayNote: string | null; waitReason: DelayReason | null; waitNote: string | null;
  /** a hold: waiting on something outside the start-up (its own from / to and reason, no plan, never late) */
  kind: 'step' | 'hold';
  /** the SOP's hour table for this step (target profile), its reference, and the finish re-planned from readings */
  profile: ProfileRow[] | null; profileRef: string | null; expectedDoneAt: string | null;
  /** the black oil cut-in conditions this step heats up to (each reactor's bed °F, the R-105 inlet limit) */
  cutin: CutinSpec | null }

export async function fetchStartupSteps(eventId: string): Promise<StartupStep[]> {
  const { data, error } = await supabase.from('sd_startup_step').select('*').eq('event_id', eventId).eq('active', true).order('seq');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: r.id as string, seq: r.seq as number, title: r.title as string, stdHours: r.std_hours == null ? null : Number(r.std_hours),
    procedureRef: (r.procedure_ref as string) ?? null, status: r.status as StartupStatus, startedAt: (r.started_at as string) ?? null, doneAt: (r.done_at as string) ?? null,
    reason: (r.reason as string) ?? null, remark: (r.remark as string) ?? null, updatedAt: (r.updated_at as string) ?? null, updatedBy: (r.updated_by_name as string) ?? null,
    delayReason: (r.delay_reason as DelayReason) ?? null, delayNote: (r.delay_note as string) ?? null, waitReason: (r.wait_reason as DelayReason) ?? null, waitNote: (r.wait_note as string) ?? null, kind: r.kind === 'hold' ? 'hold' : 'step',
    profile: (r.profile as ProfileRow[]) ?? null, profileRef: (r.profile_ref as string) ?? null, expectedDoneAt: (r.expected_done_at as string) ?? null, cutin: (r.cutin as CutinSpec) ?? null }));
}
export async function addStartupStep(eventId: string, v: { seq: number; title: string; stdHours: number | null; procedureRef: string | null; kind?: 'step' | 'hold'; startedAt?: string | null; doneAt?: string | null; remark?: string | null }) {
  const hold = v.kind === 'hold';
  const { error } = await supabase.from('sd_startup_step').insert({ event_id: eventId, seq: v.seq, title: v.title.trim(), std_hours: hold ? null : v.stdHours, procedure_ref: v.procedureRef?.trim() || null, kind: v.kind ?? 'step',
    ...(hold || v.startedAt ? { started_at: v.startedAt ?? null, done_at: v.doneAt ?? null, status: v.doneAt ? 'done' : v.startedAt ? 'running' : 'not_started', remark: v.remark?.trim() || null } : {}) });
  if (error) throw error;
}
export async function setStartupStep(id: string, patch: Partial<{ title: string; std_hours: number | null; procedure_ref: string | null; status: StartupStatus; started_at: string | null; done_at: string | null; reason: string | null; remark: string | null; seq: number; active: boolean; delay_reason: DelayReason | null; delay_note: string | null; wait_reason: DelayReason | null; wait_note: string | null; expected_done_at: string | null; cutin: Record<string, unknown> }>) {
  const { error } = await supabase.from('sd_startup_step').update(patch).eq('id', id);
  if (error) throw error;
}

// ── The shutdown & start-up file ──────────────────────────────────────────────────────────────────────────────
export type FilePart = 'scope' | 'shutdown' | 'handover' | 'startup';
export type DocStatus = 'available' | 'missing' | 'update';
export const FILE_PARTS: { key: FilePart; label: string }[] = [
  { key: 'scope', label: 'SD scope' }, { key: 'shutdown', label: 'Shutdown procedures' }, { key: 'handover', label: 'Handover procedure' }, { key: 'startup', label: 'Start-up procedures' }];
export const DOC_STATUS: Record<DocStatus, string> = { available: 'Available', missing: 'Missing', update: 'Needs update' };
export interface FileDoc { id: string; part: FilePart; seq: number; ref: string | null; title: string; location: string | null; status: DocStatus; steps: string | null; note: string | null; updatedAt: string | null; updatedBy: string | null }

export async function fetchFileDocs(eventId: string): Promise<FileDoc[]> {
  const { data, error } = await supabase.from('sd_file_doc').select('*').eq('event_id', eventId).eq('active', true).order('part').order('seq');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: r.id as string, part: r.part as FilePart, seq: r.seq as number, ref: (r.ref as string) ?? null, title: r.title as string,
    location: (r.location as string) ?? null, status: r.status as DocStatus, steps: (r.steps as string) ?? null, note: (r.note as string) ?? null, updatedAt: (r.updated_at as string) ?? null, updatedBy: (r.updated_by_name as string) ?? null }));
}
export async function saveFileDoc(eventId: string, v: { id?: string; part: FilePart; seq: number; ref: string | null; title: string; location: string | null; status: DocStatus; steps: string | null; note: string | null }) {
  const row = { part: v.part, seq: v.seq, ref: v.ref?.trim() || null, title: v.title.trim(), location: v.location?.trim() || null, status: v.status, steps: v.steps?.trim() || null, note: v.note?.trim() || null };
  const { error } = v.id ? await supabase.from('sd_file_doc').update(row).eq('id', v.id) : await supabase.from('sd_file_doc').insert({ ...row, event_id: eventId });
  if (error) throw error;
}
export async function removeFileDoc(id: string) {
  const { error } = await supabase.from('sd_file_doc').update({ active: false }).eq('id', id);
  if (error) throw error;
}

// ── Panel readings on a step with a target profile ──────────────────────────────────────────────────────────────
export interface PanelReading { id: string; stepId: string; at: string; temp: number; rx: (number | null)[] | null; holding: boolean; reason: DelayReason | null; note: string | null; by: string | null }
export async function fetchReadings(stepIds: string[]): Promise<PanelReading[]> {
  if (!stepIds.length) return [];
  const { data, error } = await supabase.from('sd_startup_reading').select('*').in('step_id', stepIds).eq('active', true).order('at');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: r.id as string, stepId: r.step_id as string, at: r.at as string, temp: Number(r.temp), rx: (r.rx as (number | null)[]) ?? null,
    holding: !!r.holding, reason: (r.reason as DelayReason) ?? null, note: (r.note as string) ?? null, by: (r.updated_by_name as string) ?? null }));
}
export async function addReading(v: { stepId: string; at: string; temp: number; rx: (number | null)[] | null; holding: boolean; reason: DelayReason | null; note: string | null }) {
  const { error } = await supabase.from('sd_startup_reading').insert({ step_id: v.stepId, at: v.at, temp: v.temp, rx: v.rx, holding: v.holding, reason: v.reason, note: v.note?.trim() || null });
  if (error) throw error;
}
export async function removeReading(id: string) {
  const { error } = await supabase.from('sd_startup_reading').update({ active: false }).eq('id', id);
  if (error) throw error;
}

// ── The heat wave: panel temperatures along the reactors, for the cut-in estimate ──────────────────────────────────
export interface WaveRow { id: string; stepId: string; at: string; pts: Partial<Record<PointKey, number>>; beds: Partial<Record<ReactorKey, number>>; note: string | null; by: string | null }
export async function fetchWave(stepIds: string[]): Promise<WaveRow[]> {
  if (!stepIds.length) return [];
  const { data, error } = await supabase.from('sd_wave_reading').select('*').in('step_id', stepIds).eq('active', true).order('at');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: r.id as string, stepId: r.step_id as string, at: r.at as string, pts: (r.pts as WaveRow['pts']) ?? {},
    beds: (r.beds as WaveRow['beds']) ?? {}, note: (r.note as string) ?? null, by: (r.updated_by_name as string) ?? null }));
}
export async function addWave(v: { stepId: string; at: string; pts: WaveRow['pts']; beds: WaveRow['beds']; note: string | null }) {
  const { error } = await supabase.from('sd_wave_reading').insert({ step_id: v.stepId, at: v.at, pts: v.pts, beds: Object.keys(v.beds).length ? v.beds : null, note: v.note?.trim() || null });
  if (error) throw error;
}
export async function removeWave(id: string) {
  const { error } = await supabase.from('sd_wave_reading').update({ active: false }).eq('id', id);
  if (error) throw error;
}
