// Daily shutdown report import (Section Head): the plant's WhatsApp report is pasted, read into items, and turned into a
// list of proposed changes that the Section Head checks and confirms in the app. Nothing here writes; the app applies
// the ticked changes through the normal saves (status line, step times with a reason, drum entries), so the history,
// the names and the overwrite protection are the same as for any other update.
// Rules: the tracker is never moved back (a step already further on, or an item changed after the report, is kept);
// drums only go up, as the difference to the report's total, once per report; the P6 plan is never touched.
import { sortActs, type TrkActivity, type TrkData, type TrkEquipment, type TrkLog } from '.';
import type { TrkQtyEntry } from './qty';

export interface ReportLine { raw: string; tags: string[]; text: string; drums: number | null }
export interface Report { at: string | null; title: string; lines: ReportLine[]; other: string[] }

const KW = 3 * 36e5;
/** "7:00 pm 24/10" (Kuwait time) → ISO; the year is the tracker's (passed in). */
function reportTime(text: string, year: number): string | null {
  const m = text.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?\s+(\d{1,2})\/(\d{1,2})/i) ?? null;
  if (!m) return null;
  let h = +m[1]; const min = +m[2]; const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
  return new Date(Date.UTC(year, +m[5] - 1, +m[4], h, min) - KW).toISOString();
}

/** "R-201", "E-216 A/B", "V-202 / V-210", "E-204 / E-205" → plant tags (E-12-216A, E-12-216B …). */
export function tagsOf(head: string): string[] {
  const out: string[] = [];
  for (const part of head.split(/\s*\/\s*(?=[A-Z]{1,2}-)/)) {
    const m = part.trim().match(/^([A-Z]{1,2})-(?:12-)?(\d{3})\s*([A-Z](?:\s*\/\s*[A-Z])*)?$/);
    if (!m) continue;
    const letters = m[3] ? m[3].split(/\s*\/\s*/) : [''];
    for (const l of letters) out.push(`${m[1]}-12-${m[2]}${l}`);
  }
  return out;
}

/** The report as items: one line per bullet, "TAG(S): text", drums picked from "204 drums". */
export function parseReport(text: string, year = new Date().getFullYear()): Report {
  const rows = text.split(/\r?\n/).map((r) => r.replace(/[⁠​*_]/g, '').replace(/^\s*[-•·⁠]+\s*/, '').trim()).filter(Boolean);
  const at = reportTime(text, year);
  const lines: ReportLine[] = []; const other: string[] = [];
  for (const raw of rows) {
    const m = raw.match(/^([A-Z]{1,2}-\d{3}[A-Z0-9\s/-]*?)\s*:\s*(.+)$/);
    const tags = m ? tagsOf(m[1].trim()) : [];
    if (!m || !tags.length) { if (!/report|unit-?12|^\d/i.test(raw)) other.push(raw); continue; }
    const d = m[2].match(/(\d[\d,]*)\s*drums?/i);
    lines.push({ raw, tags, text: m[2].replace(/\s+/g, ' ').replace(/\.\s*$/, '').trim(), drums: d ? +d[1].replace(/,/g, '') : null });
  }
  return { at, title: rows.find((r) => /report/i.test(r)) ?? 'Shutdown report', lines, other };
}

export type Change =
  | { kind: 'remark'; id: string; tag: string; equipmentId: string; from: string | null; to: string; on: boolean; note?: string }
  | { kind: 'start' | 'finish'; id: string; tag: string; activity: TrkActivity; at: string; on: boolean; note?: string }
  | { kind: 'drums'; id: string; tag: string; scopeId: string; total: number; current: number; add: number; corrects: string | null; method: TrkQtyEntry['method']; shift: 'D' | 'N'; shiftDate: string; on: boolean; note?: string };
export interface Skipped { tag: string; text: string; why: string }
export interface ImportPlan { at: string; marker: string; changes: Change[]; skipped: Skipped[] }

export const words = (s: string) => s.toLowerCase().replace(/\bw\/s\b/g, 'workshop').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'for', 'all', 'with', 'using', 'under', 'start'].includes(w));
export const stem = (w: string) => w.replace(/(ing|ion|ed|s)$/, '').replace(/(.)\1$/, '$1');
/** the step a phrase names: every main word of the phrase in the step's name (pass numbers must match); one only */
export function stepFor(phrase: string, acts: TrkActivity[]): TrkActivity | null {
  const ws = words(phrase.replace(/pass[\s-]*\d/i, 'pass')).map(stem); if (!ws.length) return null;
  const num = phrase.match(/pass[\s-]*(\d)/i)?.[1];
  const score = (a: TrkActivity) => { const aw = words(a.activity).map(stem); return (!num || new RegExp(`pass\\s*${num}\\b`, 'i').test(a.activity)) ? ws.filter((w) => aw.includes(w)).length : 0; };
  const all = acts.filter((a) => score(a) === ws.length);
  if (all.length === 1) return all[0];
  // several steps carry the words ("Dump catalyst", "Dump ceramic balls"): the one running now is the one meant
  if (all.length > 1) { const run = all.filter((a) => a.actualStart && !a.actualFinish); return run.length === 1 ? run[0] : null; }
  // one word of the phrase missing (the item's own name: "Compressor shifted to w/s" → "Shift to workshop"), at least two found
  const near = acts.filter((a) => ws.length >= 3 && score(a) === ws.length - 1);
  // several: the one with the fewest other words ("Shift to workshop" before "Shift back from workshop")
  const len = (a: TrkActivity) => words(a.activity).length; const min = Math.min(...near.map(len));
  const best = near.filter((a) => len(a) === min);
  return best.length === 1 ? best[0] : null;
}
const DONE = /^(.*?)\s*\b(done|completed?|finished)\b/i, DONE_VERB = /\b(pulled out|opened|erected|removed|installed|dropped|shifted)\b/i;
const RUN = /^(.*?)\s*\b(i\/p|in progress|started)\b/i, UNDER = /^under\s+(.+)$/i, LATER = /^(.*?)\s+to start\b/i;
/** the status line as the tracker writes it: "Drilling I/P (204 drums)" */
const tidy = (t: string) => t.replace(/\.?\s*(\d[\d,]*)\s*drums?/i, ' ($1 drums)').replace(/\s+\(/, ' (').replace(/\.\s*$/, '').trim();

/** What the report would change in the tracker, each change tickable; what it would not, and why. */
export function planImport(d: TrkData & { log?: TrkLog[] }, r: Report, nowIso = new Date().toISOString()): ImportPlan {
  const at = r.at ?? nowIso; const atMs = Date.parse(at);
  const loc = new Date(atMs + KW).toISOString();
  const marker = `Report ${loc.slice(8, 10)}/${loc.slice(5, 7)} ${loc.slice(11, 16)}`;
  const changes: Change[] = []; const skipped: Skipped[] = [];
  const later = (iso: string | null | undefined) => !!iso && Date.parse(iso) > atMs;
  for (const ln of r.lines) for (const tag of ln.tags) {
    const e = d.equipment.find((x) => x.tag === tag) ?? d.equipment.find((x) => x.combine && x.tag.startsWith(tag));
    if (!e) { skipped.push({ tag, text: ln.text, why: 'not in this tracker' }); continue; }
    if (!e.tracked) { skipped.push({ tag, text: ln.text, why: 'off the tracker / out of scope' }); continue; }
    const key = e.barchartKey ?? e.tag;
    const acts = sortActs(d.activities.filter((a) => a.key === key && a.tracked && !a.detail && a.group !== 'Operations'));
    const text = tidy(ln.text); let further: string | null = null;
    // steps: "… done / pulled out / erected" finishes the step it names; "… I/P" or "under …" starts it — only forward
    const dm = text.match(DONE), dv = text.match(DONE_VERB), rm = text.match(RUN) ?? (text.match(UNDER) ? [text, text.match(UNDER)![1], ''] as unknown as RegExpMatchArray : null), lm = text.match(LATER);
    if (lm) { const st = stepFor(lm[1], acts); if (st && (st.actualStart || st.actualFinish)) further = `tracker further: "${st.activity}" already ${st.actualFinish ? 'finished' : 'started'}`; }
    else if (dm || dv) {
      const st = stepFor(dm ? dm[1] : text, acts);
      if (st?.actualFinish && acts.some((a) => a !== st && a.actualStart && acts.indexOf(a) > acts.indexOf(st))) further = `tracker further: after "${st.activity}" the next work has started`;
      if (st && !st.actualFinish) { if (later(st.updatedAt)) skipped.push({ tag, text: st.activity, why: 'step changed after the report' }); else changes.push({ kind: 'finish', id: `f:${st.id}`, tag, activity: st, at, on: true }); }
    } else if (rm) {
      const st = stepFor(rm[1], acts);
      if (st?.actualFinish) further = `tracker further: "${st.activity}" already finished`;
      else if (st && !st.actualStart) {
        if (later(st.updatedAt)) skipped.push({ tag, text: st.activity, why: 'step changed after the report' });
        else {
          changes.push({ kind: 'start', id: `s:${st.id}`, tag, activity: st, at, on: true });
          // the same step one number earlier (pass 3 before pass 4) still running: finished by now
          const prev = acts.find((a) => a !== st && a.actualStart && !a.actualFinish && /\d/.test(a.activity) && a.activity.replace(/\d+/g, '#') === st.activity.replace(/\d+/g, '#'));
          if (prev && !later(prev.updatedAt)) changes.push({ kind: 'finish', id: `f:${prev.id}`, tag, activity: prev, at, on: true, note: 'the next one has started' });
        }
      }
    }
    // status line: the report's words — unless the tracker already says more, or was changed after the report
    if ((e.remark ?? '').trim().toLowerCase() !== text.toLowerCase()) {
      const noteAt = (d.log ?? []).filter((l) => l.kind === 'equipment' && l.ref === e.tag && l.field === 'note').map((l) => l.at).sort().pop();
      const toks = (x: string) => [...words(x).map(stem), ...(x.match(/\d+/g) ?? [])];
      const subset = !!e.remark && toks(text).every((w) => toks(e.remark!).includes(w));
      const why = later(noteAt) ? 'status changed after the report' : further ?? (subset ? 'tracker status already says this and more' : undefined);
      changes.push({ kind: 'remark', id: `r:${tag}`, tag, equipmentId: e.id, from: e.remark, to: text, on: !why, note: why });
    }
    // drums: up to the report's total, once per report
    if (ln.drums !== null) {
      const sc = d.engine?.scopes.find((s) => s.key === key && s.scope === 'removal');
      if (!sc) { skipped.push({ tag, text: `${ln.drums} drums`, why: 'no drum count kept for this item' }); continue; }
      const es = (d.engine?.entries ?? []).filter((x) => x.scopeId === sc.id && x.kind !== 'transfer' && x.verify !== 'rejected');
      const current = es.reduce((t, x) => t + x.qty, 0);
      if (es.some((x) => x.remark?.includes(marker))) { skipped.push({ tag, text: `${ln.drums} drums`, why: 'this report is already entered' }); continue; }
      if (ln.drums <= current) { skipped.push({ tag, text: `${ln.drums} drums`, why: `tracker already has ${current}` }); continue; }
      const method: TrkQtyEntry['method'] = /drill/i.test(ln.text) ? 'other' : (es.find((x) => x.kind === 'removal')?.method ?? 'other');
      // the shift the report closes: up to 19:00 the day shift of that date, before 07:00 the night before
      const local = new Date(atMs + KW); const hm = local.getUTCHours() * 60 + local.getUTCMinutes();
      const shift: 'D' | 'N' = hm > 7 * 60 && hm <= 19 * 60 ? 'D' : 'N';
      const shiftDate = new Date(atMs + KW - (hm <= 7 * 60 ? 864e5 : 0)).toISOString().slice(0, 10);
      // one entry per shift and method: a second figure in the same shift is a correction of the first
      const same = es.find((x) => x.kind === 'removal' && x.shiftDate === shiftDate && x.shift === shift && x.method === method);
      changes.push({ kind: 'drums', id: `d:${sc.id}`, tag, scopeId: sc.id, total: ln.drums, current, add: ln.drums - current, corrects: same?.id ?? null, method, shift, shiftDate, on: true });
    }
  }
  for (const o of r.other) skipped.push({ tag: '—', text: o, why: 'not an item line' });
  return { at, marker, changes, skipped };
}
export type { TrkEquipment };
