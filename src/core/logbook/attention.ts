// Points that need attention (owner, 27 Nov 2026: "they write a lot of comment; I want in the overview the point that
// need my attention … so I don't have to open the logbook"). Pure, rule-based: nothing leaves the app. From one ARDS log
// (Controller, Control room and Field operator remarks) and that shift's Controller I log it keeps the remarks that name a
// problem, drops routine lines, merges the same point written by several people, places it on a train, and counts how
// many shifts in a row it has been written (the logs before it). Words, not judgement: a point is only as good as the remark.
import type { TrainId } from './board';
import type { StoredLog } from './view';

export type Level = 'high' | 'medium';
export interface AttentionItem { key: string; train: TrainId; level: Level; text: string; tags: string[]; isNew: boolean; shifts: number; since: string; roles: string[] }

const HIGH = /\b(trip(?:ped|led|s)?|leak(?:ing|age|s)?|fire|emergency|not\s+working|broken|not\s+ok|off[- ]?spec|very\s+(?:low|high)|dropped|fail(?:ed|ure|s)?|shut\s*down|stopped|stop)\b/i;
const MEDIUM = /\b(passing|issue|problem|missing|bypass|in\s+(?:w\/s|workshop)|chok(?:e|ed|ing)|alarm|vibration|abnormal|faulty|defect(?:ive)?|to\s+be\s+(?:replaced|repaired|attended|checked|installed|flushed|changed|de-?choked?)|under\s+observation|low|high)\b/i;
const TAG = /\b([A-Z]{1,4})[- ]?(\d{3,4}[A-Z]?)\b/g;
const NOT_TAG = new Set(['KBPD', 'BPD', 'PPM', 'TR', 'U', 'UNIT']);

/** Equipment and instrument tags as written ("TV 607", "TC607", "PSV-537" → "TV-607", "TC-607", "PSV-537"). */
export function tagsOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.toUpperCase().matchAll(TAG)) if (!NOT_TAG.has(m[1])) out.add(`${m[1]}-${m[2]}`);
  return [...out];
}
/** The remark's group says the train; otherwise a 200-series tag is train 2, and the rest is shared (100-series tags
 *  can be train 1 or common, e.g. P-103 serves both trains, so they are not guessed onto train 1). */
const trainOf = (group: string, tags: string[]): TrainId => {
  if (/(train|tr)\s*-?\s*1\b/i.test(group)) return 'TR-1';
  if (/(train|tr)\s*-?\s*2\b/i.test(group)) return 'TR-2';
  return tags.some((x) => /-2\d\d[A-Z]?$/.test(x)) ? 'TR-2' : 'Common';
};
const clean = (s: string) => { const t = s.replace(/\s+/g, ' ').replace(/[\s.,;]+$/, '').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const wordOf = (s: string) => ((HIGH.exec(s) ?? MEDIUM.exec(s))?.[1] ?? '').toLowerCase().replace(/\s+/g, ' ').replace('in w/s', 'in workshop');
/** One point's identity across people and shifts: its most specific tag (the last one written, e.g. the PSV on a heater)
 *  and its problem word, else its first words. "H-201 injection water PSV-537 in workshop" and "INJ WATER PSV-537 STILL
 *  IN W/S" are one point. */
const keyOf = (text: string, train: TrainId) => { const tags = tagsOf(text); return tags.length ? `${train}|${tags[tags.length - 1]}|${wordOf(text)}` : `${train}|${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40)}`; };

interface Raw { key: string; train: TrainId; level: Level; text: string; tags: string[]; role: string }
function pointsOf(logs: (StoredLog | null)[]): Map<string, Raw[]> {
  const m = new Map<string, Raw[]>();
  for (const log of logs) for (const sec of log?.sections ?? []) for (const g of sec.groups) for (const item of g.items) {
    const level: Level | null = HIGH.test(item) ? 'high' : MEDIUM.test(item) ? 'medium' : null;
    if (!level) continue;
    const tags = tagsOf(item), train = trainOf(g.group, tags), text = clean(item), key = keyOf(text, train);
    m.set(key, [...(m.get(key) ?? []), { key, train, level, text, tags, role: sec.role }]);
  }
  return m;
}

/** The points of one shift, high first, then new before carried; `before` = the earlier ARDS logs, newest first. */
export function attentionOf(log: StoredLog, controller: StoredLog | null, before: StoredLog[]): AttentionItem[] {
  const now = pointsOf([log, controller]);
  const past = before.map((l) => new Set(pointsOf([l]).keys()));
  const out: AttentionItem[] = [];
  for (const [key, rs] of now) {
    let n = 0; while (n < past.length && past[n].has(key)) n += 1;
    const caps = (t: string) => (t === t.toUpperCase() ? 1 : 0);                 // prefer normal writing over ALL CAPS, then the fullest
    const text = rs.map((r) => r.text).sort((a, b) => caps(a) - caps(b) || b.length - a.length)[0];
    out.push({ key, train: rs[0].train, level: rs.some((r) => r.level === 'high') ? 'high' : 'medium', text, tags: rs[0].tags, isNew: n === 0, shifts: n + 1,
      since: (n ? before[n - 1] : log).date, roles: [...new Set(rs.map((r) => r.role))] });
  }
  const rank = (x: AttentionItem) => (x.level === 'high' ? 0 : 2) + (x.isNew ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.train.localeCompare(b.train));
}
