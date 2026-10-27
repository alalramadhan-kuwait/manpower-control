// Update intelligence of the tracker: the pasted reports, their findings and proposals, the official Planning progress.
// Reading a report is done in the app (core/tracker/intel); this file stores what was read and applies a proposal a
// person accepted through the tracker's own saves (setActivity, setEquipment, addQtyEntry, addEngStep, addEvent), so
// the history, the names and the overwrite protection are the same as for any update.
import { supabase } from './supabase';
import { dataChanged } from './changes';
import { addEngStep, addEvent, addQtyEntry, setActivity, setEquipment, setOrder, type TrackerData } from './tracker';
import { fingerprint, reconcile, type Department, type PlanningRecord, type Proposal, type ProposalStatus, type ProposalType, type Reconciled, type ReportMeta, type Tolerance } from '@/core/tracker/intel';
import { sortActs } from '@/core/tracker';

export interface ReportRow { id: string; department: Department; reportDate: string; shift: 'D' | 'N' | null; reporter: string | null; body: string; status: 'read' | 'applied' | 'partial' | 'failed'; summary: Record<string, number>; submittedBy: string | null; submittedAt: string }
export interface ProposalRow extends Proposal { reportId: string; reportDate: string; reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null; appliedAt: string | null; appliedRef: string | null; createdAt: string }
export interface IntelData { reports: ReportRow[]; proposals: ProposalRow[]; planning: PlanningRecord[] }

type PRow = { id: string; report_id: string; fact_ids: string[]; tag: string | null; equipment_key: string | null; equipment_id: string | null; activity_row: string | null; activity_name: string | null; type: ProposalType; classification: Proposal['classification']; level: Proposal['level'] | null;
  title: string; detail: string | null; reason: string | null; evidence: string[]; issues: string[]; current: Record<string, unknown>; proposed: Record<string, unknown>; new_step: Proposal['newStep'] | null; event_at: string; status: ProposalStatus;
  reviewed_by_name: string | null; reviewed_at: string | null; review_note: string | null; applied_at: string | null; applied_ref: string | null; created_at: string; trk_report?: { report_date: string; department: Department } | null };
const toProposal = (r: PRow): ProposalRow => ({ id: r.id, reportId: r.report_id, reportDate: r.trk_report?.report_date ?? r.event_at.slice(0, 10), factIds: r.fact_ids ?? [], tag: r.tag, key: r.equipment_key, equipmentId: r.equipment_id, activityId: r.activity_row, activityName: r.activity_name,
  type: r.type, classification: r.classification, level: r.level ?? undefined, title: r.title, detail: r.detail ?? '', reason: r.reason ?? '', evidence: r.evidence ?? [], issues: r.issues ?? [], current: r.current ?? {}, proposed: r.proposed ?? {}, newStep: r.new_step ?? undefined,
  eventAt: r.event_at, department: r.trk_report?.department ?? 'other', status: r.status, reviewedBy: r.reviewed_by_name, reviewedAt: r.reviewed_at, reviewNote: r.review_note, appliedAt: r.applied_at, appliedRef: r.applied_ref, createdAt: r.created_at });

/** The reports of the last weeks, every open proposal and the applied / dismissed ones of the last days, the planning history. */
export async function fetchIntel(trackerId: string, days = 14): Promise<IntelData> {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const [r, p, pl] = await Promise.all([
    supabase.from('trk_report').select('*').eq('tracker_id', trackerId).gte('submitted_at', since).order('submitted_at', { ascending: false }).limit(200),
    supabase.from('trk_proposal').select('*, trk_report(report_date, department)').eq('tracker_id', trackerId).or(`status.in.(ready,review,conflict,info),created_at.gte.${since}`).order('created_at', { ascending: false }).limit(2000),
    supabase.from('trk_planning_progress').select('*').eq('tracker_id', trackerId).order('report_date').order('revision')]);
  const err = [r, p, pl].find((x) => x.error)?.error; if (err) throw err;
  return {
    reports: (r.data as { id: string; department: Department; report_date: string; shift: 'D' | 'N' | null; reporter: string | null; body: string; status: ReportRow['status']; summary: Record<string, number>; submitted_by_name: string | null; submitted_at: string }[])
      .map((x) => ({ id: x.id, department: x.department, reportDate: x.report_date, shift: x.shift, reporter: x.reporter, body: x.body, status: x.status, summary: x.summary ?? {}, submittedBy: x.submitted_by_name, submittedAt: x.submitted_at })),
    proposals: (p.data as PRow[]).map(toProposal),
    planning: (pl.data as { id: string; report_date: string; cutoff: string | null; planned_pct: number; actual_pct: number; source: string; revision: number; supersedes: string | null; created_at: string }[])
      .map((x) => ({ id: x.id, reportDate: x.report_date, cutoff: x.cutoff, planned: Number(x.planned_pct), actual: Number(x.actual_pct), source: x.source, revision: x.revision, supersedes: x.supersedes, createdAt: x.created_at })),
  };
}

/** The tracker's tolerance for cumulative counts (settings), the software defaults until the site validates them. */
export const toleranceOf = (d: TrackerData): Tolerance => ({ abs: Number((d.settings as { qtyTolAbs?: number }).qtyTolAbs ?? 10), rel: Number((d.settings as { qtyTolRel?: number }).qtyTolRel ?? 0.01) });

/** Read a pasted report against the tracker (no write): the proposals to review. */
export function readAgainst(d: TrackerData, text: string, meta: ReportMeta, intel: IntelData): Reconciled {
  const existing = intel.proposals.filter((p) => p.status !== 'dismissed').map((p) => ({ type: p.type, key: p.key, activityId: p.activityId, status: p.status, proposed: p.proposed, department: p.department, reportDate: p.reportDate }));
  return reconcile(d, text, meta, { tolerance: toleranceOf(d), existing });
}

/** Store a submission: the report as pasted, its facts and proposals. The same text submitted again returns the first
 *  submission untouched (fingerprint), so nothing is read twice. */
export async function submitReport(d: TrackerData, text: string, meta: ReportMeta, r: Reconciled): Promise<{ reportId: string; duplicate: boolean }> {
  const fp = fingerprint(text, meta);
  const { data: dup } = await supabase.from('trk_report').select('id').eq('tracker_id', d.tracker.id).eq('fingerprint', fp).maybeSingle();
  if (dup) return { reportId: (dup as { id: string }).id, duplicate: true };
  const scope = r.facts.some((f) => f.scope === 'train1') && !r.facts.some((f) => f.scope !== 'train1') ? 'train1' : r.facts.some((f) => f.scope === 'train2') ? 'train2' : 'unknown';
  const { data: rep, error } = await supabase.from('trk_report').insert({ tracker_id: d.tracker.id, department: meta.department, report_date: meta.reportDate, shift: meta.shift, reporter: meta.reporter || null, scope, body: text, fingerprint: fp, summary: r.summary }).select('id').single();
  if (error) throw error;
  const reportId = (rep as { id: string }).id;
  if (r.facts.length) {
    const { error: e1 } = await supabase.from('trk_finding').insert(r.facts.map((f) => ({ tracker_id: d.tracker.id, report_id: reportId, fact_id: f.id, line: f.line, tag: f.tags[0] ?? null, equipment_key: null, kind: f.kind, state: f.state, statement: f.text, phrase: f.phrase, event_at: r.eventAt, qty: f.qty ?? null, scope: f.scope, confidence: f.confidence })));
    if (e1) throw e1;
  }
  if (r.proposals.length) {
    const { error: e2 } = await supabase.from('trk_proposal').insert(r.proposals.map((p) => ({ tracker_id: d.tracker.id, report_id: reportId, fact_ids: p.factIds, tag: p.tag, equipment_key: p.key, equipment_id: p.equipmentId, activity_row: p.activityId, activity_name: p.activityName,
      type: p.type, classification: p.classification, level: p.level ?? null, title: p.title, detail: p.detail, reason: p.reason, evidence: p.evidence, issues: p.issues, current: p.current, proposed: p.proposed, new_step: p.newStep ?? null, event_at: p.eventAt, status: p.status })));
    if (e2) throw e2;
  }
  dataChanged();
  return { reportId, duplicate: false };
}

/** The review of one proposal: dismissed (with a note), or marked applied with the reference of what was written. */
export async function reviewProposal(id: string, status: 'applied' | 'dismissed', note: string | null, appliedRef: string | null = null) {
  const { error } = await supabase.from('trk_proposal').update({ status, review_note: note, applied_ref: appliedRef }).eq('id', id);
  if (error) throw error;
  dataChanged();
}

/** Apply an accepted proposal through the tracker's own saves; returns what was written (kept on the proposal). */
export async function applyProposal(d: TrackerData, p: ProposalRow, edit: { remark?: string; title?: string; pendingReason?: string } = {}): Promise<string> {
  const marker = `${p.department} report ${p.reportDate}`;
  let ref = '';
  switch (p.type) {
    case 'finish_step': {
      if (!p.activityId) throw new Error('No step on this proposal.');
      await setActivity(p.activityId, { actual_start: (p.proposed.actualStart as string) ?? p.eventAt, actual_finish: p.proposed.actualFinish as string, time_reason: marker });
      ref = `activity ${p.activityId} finished ${p.proposed.actualFinish}`; break; }
    case 'start_step': {
      if (!p.activityId) throw new Error('No step on this proposal.');
      await setActivity(p.activityId, { actual_start: p.proposed.actualStart as string, time_reason: marker });
      ref = `activity ${p.activityId} started ${p.proposed.actualStart}`; break; }
    case 'status_line': {
      if (!p.equipmentId) throw new Error('No item on this proposal.');
      const remark = (edit.remark ?? (p.proposed.remark as string)).trim();
      await setEquipment(p.equipmentId, { remark });
      ref = `status "${remark}"`; break; }
    case 'drums': {
      const x = p.proposed as { scopeId: string; add: number; total: number; shift: 'D' | 'N'; shiftDate: string; corrects: string | null; method: 'free_fall' | 'vacuum' | 'cone' | 'other' };
      await addQtyEntry(x.scopeId, { shiftDate: x.shiftDate, shift: x.shift, kind: x.corrects ? 'correction' : 'removal', method: x.method, qty: x.add, corrects: x.corrects, remark: `${marker}: total ${x.total}`, source: 'plant_report', verified: true });
      ref = `drums +${x.add} to ${x.total}`; break; }
    case 'new_step': case 'defect': {
      if (!p.key) throw new Error('No item on this proposal.');
      const title = (edit.title ?? p.newStep?.title ?? (p.proposed.title as string) ?? '').trim();
      if (!title) throw new Error('Give the step a name.');
      const order = sortActs(d.activities.filter((a) => a.key === p.key && a.tracked && !a.detail && a.group !== 'Operations')).map((a) => a.id);
      const after = (p.proposed.after as string | null) ?? (p.activityId && order.includes(p.activityId) ? p.activityId : null);
      const id = await addEngStep(d.tracker.id, p.key, title, order, after);
      if (p.type === 'new_step' && p.proposed.state === 'done') await setActivity(id, { actual_start: p.eventAt, actual_finish: p.eventAt, time_reason: marker });
      else if (p.type === 'new_step' && p.proposed.state === 'in_progress') await setActivity(id, { actual_start: p.eventAt, time_reason: marker });
      if (p.type === 'defect') await addEvent(d.tracker.id, 'other', `${p.tag}: ${p.proposed.event as string}`, p.key);
      ref = `step ${id} "${title}"${p.type === 'defect' ? ' + issue' : ''}`; break; }
    case 'hold': {
      if (!p.equipmentId) throw new Error('No item on this proposal.');
      const reason = (edit.pendingReason ?? (p.proposed.pendingReason as string)).trim();
      await setEquipment(p.equipmentId, { pending_reason: reason });
      ref = `hold "${reason}"`; break; }
    case 'hold_release': {
      if (!p.equipmentId) throw new Error('No item on this proposal.');
      await setEquipment(p.equipmentId, { pending_reason: null });
      ref = 'hold released'; break; }
    case 'planning': {
      const x = p.proposed as { planned: number; actual: number; reportDate: string };
      ref = await addPlanning(d.tracker.id, { reportDate: x.reportDate, planned: x.planned, actual: x.actual, source: 'Maintenance Planning', reportId: p.reportId });
      break; }
    default: throw new Error('This proposal is information only.');
  }
  await reviewProposal(p.id, 'applied', null, ref);
  return ref;
}

/** An official Planning figure for a day; a second figure for the same day is a new revision pointing at the first. */
export async function addPlanning(trackerId: string, v: { reportDate: string; planned: number; actual: number; source: string; cutoff?: string | null; reportId?: string | null }): Promise<string> {
  const { data: prev } = await supabase.from('trk_planning_progress').select('id, revision').eq('tracker_id', trackerId).eq('report_date', v.reportDate).order('revision', { ascending: false }).limit(1);
  const last = (prev as { id: string; revision: number }[] | null)?.[0] ?? null;
  const { error } = await supabase.from('trk_planning_progress').insert({ tracker_id: trackerId, report_date: v.reportDate, cutoff: v.cutoff ?? null, planned_pct: v.planned, actual_pct: v.actual, source: v.source, report_id: v.reportId ?? null, revision: last ? last.revision + 1 : 1, supersedes: last?.id ?? null }).select('id').single();
  if (error) throw error;
  dataChanged();
  return `planning ${v.reportDate} r${last ? last.revision + 1 : 1}: ${v.planned} / ${v.actual}`;
}

export { setOrder };
