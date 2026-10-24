// Loop diagrams (trk_drawing + private bucket trk-drawings). Read like the tracker (logins and its engineer links);
// attach / withdraw: Section Head, Coordinator, Engineer. Rows are never deleted: a new revision supersedes, a wrong
// upload is withdrawn with a reason (both in trk_log).
import type { TrkDrawing } from '@/core/tracker/drawings';
import type { LoopFix } from '@/core/tracker/schematic';
import { supabase } from './supabase';

const BUCKET = 'trk-drawings';
interface Row { id: string; tracker_id: string; point_id: string | null; items: string[]; sheet: string; rev: string; source: string; title: string | null; path: string; mime: string; note: string | null;
  status: TrkDrawing['status']; uploaded_by_name: string | null; uploaded_at: string; closed_at: string | null; closed_by_name: string | null; closed_reason: string | null }
const toDrawing = (r: Row): TrkDrawing => ({ id: r.id, trackerId: r.tracker_id, pointId: r.point_id, items: r.items ?? [], sheet: r.sheet, rev: r.rev, source: r.source, title: r.title, path: r.path,
  mime: r.mime, note: r.note, status: r.status, uploadedBy: r.uploaded_by_name, uploadedAt: r.uploaded_at, closedAt: r.closed_at, closedBy: r.closed_by_name, closedReason: r.closed_reason });

export async function fetchDrawings(trackerId: string): Promise<TrkDrawing[]> {
  const { data, error } = await supabase.from('trk_drawing').select('id,tracker_id,point_id,items,sheet,rev,source,title,path,mime,note,status,uploaded_by_name,uploaded_at,closed_at,closed_by_name,closed_reason')
    .eq('tracker_id', trackerId).order('uploaded_at', { ascending: false }).limit(500);
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toDrawing);
}

/** The file, as a local URL for the viewer (the request carries the login or the engineer link). */
export async function drawingFile(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error('The drawing could not be loaded.');
  return URL.createObjectURL(data);
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' };
export async function attachDrawing(trackerId: string, file: File, v: { pointId: string | null; items: string[]; sheet: string; rev: string; source: string; title?: string | null; note?: string | null }) {
  const path = `${trackerId}/${crypto.randomUUID()}.${EXT[file.type] ?? 'bin'}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  const { error } = await supabase.from('trk_drawing').insert({ tracker_id: trackerId, point_id: v.pointId, items: v.items, sheet: v.sheet.trim(), rev: v.rev.trim(), source: v.source.trim(),
    title: v.title?.trim() || null, note: v.note?.trim() || null, path, mime: file.type });
  if (error) throw error;
}

export async function withdrawDrawing(id: string, reason: string) {
  const { error } = await supabase.rpc('trk_drawing_withdraw', { p_id: id, p_reason: reason });
  if (error) throw error;
}

// ── corrections to the auto-generated schematics (trk_loop_fix) ─────────────────────────────────────────────
interface FixRow { id: string; point_id: string; op: LoopFix['op']; target: string | null; a: string | null; b: string | null; line: string | null; kind: LoopFix['kind']; text: string | null;
  sheet: string | null; reason: string | null; status: LoopFix['status']; by_name: string | null; at: string }
export async function fetchLoopFixes(trackerId: string): Promise<LoopFix[]> {
  const { data, error } = await supabase.from('trk_loop_fix').select('id,point_id,op,target,a,b,line,kind,text,sheet,reason,status,by_name,at').eq('tracker_id', trackerId).order('at').limit(2000);
  if (error) throw error;
  return ((data ?? []) as FixRow[]).map((r) => ({ id: r.id, pointId: r.point_id, op: r.op, target: r.target, a: r.a, b: r.b, line: r.line, kind: r.kind, text: r.text, sheet: r.sheet, reason: r.reason, status: r.status, by: r.by_name, at: r.at }));
}
export async function addLoopFix(trackerId: string, pointId: string, v: Partial<Pick<LoopFix, 'op' | 'target' | 'a' | 'b' | 'line' | 'kind' | 'text' | 'sheet' | 'reason'>> & { op: LoopFix['op'] }) {
  const t = (x?: string | null) => (x?.trim() ? x.trim() : null);
  const { error } = await supabase.from('trk_loop_fix').insert({ tracker_id: trackerId, point_id: pointId, op: v.op, target: t(v.target), a: t(v.a), b: t(v.b), line: t(v.line), kind: v.kind ?? null, text: t(v.text), sheet: t(v.sheet), reason: t(v.reason) });
  if (error) throw error;
}
export async function withdrawLoopFix(id: string, reason: string) {
  const { error } = await supabase.rpc('trk_loop_fix_withdraw', { p_id: id, p_reason: reason });
  if (error) throw error;
}
