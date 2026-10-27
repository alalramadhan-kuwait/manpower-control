// Daily update intelligence · reading a pasted departmental report (Engine A, 27 Oct 2026).
// A report is split into statements (one per line, "TAG(S): text"), each statement into facts (one per activity,
// defect, hold, quantity or reading), with the plant's abbreviations spelled out and the state of each fact read from
// its words. Pure text work: nothing here knows the tracker; the matching and the reconciliation are in reconcile.ts.
// Pasted text is data: it is never run, and a line the rules cannot read stays "unclear" for a person.

export type Department = 'ops_engineer' | 'ops_supervisor' | 'shift_ops' | 'mech_maint' | 'planning' | 'inspection' | 'other';
export const DEPARTMENTS: [Department, string][] = [['ops_engineer', 'Operations Engineer'], ['ops_supervisor', 'Operations Supervisor'], ['shift_ops', 'Shift Operations'],
  ['mech_maint', 'Mechanical Maintenance'], ['planning', 'Maintenance Planning'], ['inspection', 'Inspection'], ['other', 'Other']];
export const DEPT_SHORT: Record<Department, string> = { ops_engineer: 'Ops Eng.', ops_supervisor: 'Ops Sup.', shift_ops: 'Shift Ops', mech_maint: 'Mech. Maint.', planning: 'Planning', inspection: 'Inspection', other: 'Other' };

/** The site's short forms, spelled out before a statement is read (the original text is kept as written). */
export const ABBREVIATIONS: [RegExp, string][] = [
  [/\bi\s*\/\s*p\b/gi, 'in progress'], [/\bw\s*\/\s*s\b/gi, 'workshop'], [/\bWS\b/g, 'workshop'], [/\bHB\b/g, 'hydroblasting'], [/\bHJ\b/g, 'hydrojetting'],
  [/\bDPT\b/g, 'dye penetrant test'], [/\bDP\b(?=\s*(done|to be|pending|completed|i\/p|in progress|test))/gi, 'dye penetrant test'], [/\bLPT\b/g, 'dye penetrant test'],
  [/\bCVs?\b/g, 'control valve'], [/\bC\/V\b/g, 'control valve'], [/\bIAT\b/g, 'IAT'], [/\bPMR\b/g, 'PMR'], [/\bHT\b(?=\s|$)/g, 'hydrotest'], [/\bH\/T\b/g, 'hydrotest'],
  [/\bNDT\b/g, 'NDT'], [/\bRT\b(?=\s|$)/g, 'radiography'], [/\bUT\b(?=\s|$)/g, 'ultrasonic test'], [/\bPSV\b/g, 'PSV'], [/\bmanway\b/gi, 'manway'], [/\bscaff\b/gi, 'scaffold'],
  // Arabic: the common words of a plant update
  [/\bتم\b|\bمنجز\b|\bانتهى\b|\bمكتمل\b/g, 'done'], [/\bجاري\b|\bقيد\b|\bمستمر\b/g, 'in progress'], [/\bمتوقف\b|\bتوقف\b/g, 'stopped'], [/\bبانتظار\b|\bفي انتظار\b/g, 'waiting for'],
  [/\bسيبدأ\b|\bلم يبدأ\b/g, 'to start'], [/\bعطل\b|\bمكسور\b|\bتالف\b/g, 'found broken'], [/\bجاهز\b/g, 'ready'], [/\bفحص\b/g, 'inspection'], [/\bتنظيف\b/g, 'cleaning'], [/\bبراميل\b/g, 'drums']];
export function expand(text: string): string { let t = text; for (const [re, to] of ABBREVIATIONS) t = t.replace(re, to); return t; }

/** Plant tags as the reports write them, resolved to the tracker's form (E-216 A/B → E-12-216A, E-12-216B; R-201/203/204 → three reactors;
 *  HV-12-546A as it is). The "12-" unit part is optional in the report. */
const TAG = /\b([A-Z]{1,3})-(?:12-)?(\d{3})\s*([A-Z])?((?:\s*\/\s*(?:[A-Z]|\d{3}[A-Z]?))*)\b/g;
export function tagsIn(text: string): { raw: string; tags: string[]; index: number }[] {
  const out: { raw: string; tags: string[]; index: number }[] = [];
  for (const m of text.matchAll(TAG)) {
    const [raw, pre, num, letter, more] = m; const tags: string[] = [];
    const rest = (more ?? '').split('/').map((s) => s.trim()).filter(Boolean);
    if (letter && rest.every((r) => /^[A-Z]$/.test(r))) for (const l of [letter, ...rest]) tags.push(`${pre}-12-${num}${l}`);
    else { tags.push(`${pre}-12-${num}${letter ?? ''}`); for (const r of rest) tags.push(/^\d{3}/.test(r) ? `${pre}-12-${r}` : `${pre}-12-${num}${r}`); }
    out.push({ raw, tags: [...new Set(tags)], index: m.index ?? 0 });
  }
  return out;
}

export interface Statement { line: number; raw: string; tagsText: string; tags: string[]; text: string; header: boolean }
const HEADER = /^(unit-?\s?\d+|train-?\s?\d+\s*(shutdown|sd)?\s*(report|update|status)?|(daily|shift)?\s*(shutdown|sd)?\s*(report|update)|date\b|time\b|from\b|regards|dear|hi\b|hello|good (morning|evening|afternoon))/i;
/** The pasted text as statements: a line that starts with tag(s) is about them; a line without one continues the
 *  statement above (a wrapped line or a second bullet), unless it is a heading. */
export function segment(text: string): Statement[] {
  const rows = text.split(/\r?\n/).map((r) => r.replace(/[⁠​*_]/g, '').replace(/^\s*(?:[-•·⁠▪➢>]+|\d+[.)])\s*/, '').trim());
  const out: Statement[] = [];
  rows.forEach((raw, i) => {
    if (!raw) return;
    const found = tagsIn(raw).filter((t) => t.index <= 2);
    if (found.length) {
      const head = found[0];
      // "R-205: text", "R-205 - text", "R-205 text"
      let rest = raw.slice(head.index + head.raw.length).replace(/^\s*[:\-–—]\s*/, '').trim();
      // more tags right after the first ("E-204 & E-205: …")
      const tags = [...head.tags];
      for (const t of tagsIn(rest)) if (t.index <= 3 || /^[\s&,+/]*$/.test(rest.slice(0, t.index))) { tags.push(...t.tags); rest = rest.slice(t.index + t.raw.length).replace(/^\s*[:\-–—&,]\s*/, '').trim(); }
      out.push({ line: i + 1, raw, tagsText: raw.slice(0, raw.length - rest.length).trim().replace(/[:\-–—\s]+$/, ''), tags: [...new Set(tags)], text: rest, header: false });
      return;
    }
    // a heading is short ("Train-2 Shutdown Report", a date); a long line that starts like one carries content
    if ((HEADER.test(raw) && raw.split(/\s+/).length <= 6) || /^\d{1,2}[:.]\d{2}/.test(raw) || /^\d{1,2}\/\d{1,2}/.test(raw)) { out.push({ line: i + 1, raw, tagsText: '', tags: [], text: raw, header: true }); return; }
    const prev = out[out.length - 1];
    // a wrapped line continues the item above; a line of its own ("Train-1: …", a planning line, a heading-like label) does not
    const own = /^[A-Za-z][\w\s-]{0,24}:/.test(raw) || TRAIN1.test(raw) || /planned\s*:?\s*\d/i.test(raw);
    if (prev && !prev.header && prev.tags.length && !own) out.push({ line: i + 1, raw, tagsText: prev.tagsText, tags: prev.tags, text: raw, header: false });
    else out.push({ line: i + 1, raw, tagsText: '', tags: [], text: raw, header: false });
  });
  return out;
}

export type FactState = 'done' | 'in_progress' | 'pending' | 'planned' | 'info';
export type FactKind = 'work' | 'quantity' | 'defect' | 'hold' | 'hold_release' | 'risk' | 'location' | 'readiness' | 'reading' | 'planning' | 'info';
export type Scope = 'train2' | 'train1' | 'common' | 'unknown';
export interface Fact {
  id: string; line: number; raw: string; tagsText: string; tags: string[];
  /** the clause as written (short forms spelled out), and its work phrase without the state words */
  text: string; phrase: string; state: FactState; kind: FactKind;
  qty?: { value: number; unit: string; mode: 'cumulative' | 'daily' | 'reading' }[];
  planning?: { planned: number; actual: number };
  holdLevel?: 'confirmed' | 'possible' | 'risk';
  scope: Scope; confidence: number;
}

const DONE = /\b(done|completed?|finished|complete|over|cleared|closed|accepted|ok(?:ay)?|dropped|removed|erected|installed|fixed|transferred|shifted|pulled out|opened|boxed[\s-]?up|de-?blinded|re-?installed|refixed|re-?fixed)\b/i;
const RUN = /\b(in progress|ongoing|on-?going|continuing|under\s+\w+|being\s+\w+|started|running|i\/p)\b/i;
const PEND = /\b(to be (done|carried out|started|completed|installed|fixed)|pending|yet to (start|be)|not (yet )?(started|done)|awaiting|waiting|to start|will (be |start)|planned|to follow|next|scheduled|due)\b/i;
const DEFECT = /\b(found (broken|damaged|cracked|leaking|bent|missing|chok(ed|ing)|corroded|eroded)|broken|damaged|cracked?|leak(ing|age)?|bent|missing|failed|failure|not ok|rejected|defect(ive)?|heavy (corrosion|erosion|scaling)|pitting|holes?)\b/i;
const HOLD = /\b(stopped (due to|because|for)|on hold|held up|hold|cannot (proceed|start|continue)|no (available|spares?|material|tubes?|manpower|crane|scaffold)|not available|unavailable|blocked|waiting for (spares?|material|inspection|crane|scaffold|permit|gas test|clearance|handover|iat|workshop|contractor))\b/i;
const RELEASE = /\b(hold (released|lifted|cleared|removed)|resumed|restarted|spares? (received|arrived|available)|material (received|arrived))\b/i;
const RISK = /\b(under review|subject to|may (affect|delay|not)|might|if (available|required|needed)|availability|at risk|likely|expected (delay|late)|concern|to be confirmed|tbc)\b/i;
const LOCATION = /\b(at (the )?(instrument |inst\.? |mech\.? |mechanical )?(workshop|site|yard|store|vendor)|shifted to (site|workshop|yard)|sent to (workshop|vendor|site)|in (the )?workshop|returned to site|back (to|at) site)\b/i;
const READINESS = /\b(ready for (inspection|handover|box[\s-]?up|loading|startup|start-up)|offered (for|to) (inspection|process|operations?)|under inspection|clearance (cleared|given|obtained)|cleared by (operations|process|inspection)|inspection (cleared|accepted|ok))\b/i;
const READING = /\b(\d[\d,.]*\s*(psig|psi|barg|bar|kg\/cm2|°\s?[fc]|deg\s?[fc]|degf|degc|ppm|%\s*lel|rpm))\b|\b(pressuri[sz]ed|depressuri[sz]ed|temperature|bed temp|heating|cooling|lined up|lineup|circulat|start-?up|commission)/i;
const TRAIN1 = /\btrain-?\s?1\b|\btr-?1\b|\bhp loop\b|\bunit start|\bstartup\b/i;
const QTY = /(?:total(?:ly)?\s*(?:of\s*)?)?(\d[\d,]*)\s*(drums?|bags?|m3|tons?|nos?\.?|pcs|pieces|tubes?|trays?|valves?|elements?|bolts?|flanges?|joints?|spools?)\b/gi;
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,;:.-]+|[\s,;:.]+$/g, '');

/** One statement → its facts: clauses split at ". ", ";" and " / " (not inside "No. 6" or a number), each read for its
 *  state and kind. Quantities: "1972 drums" is a cumulative total, "today 124" the day's count, kept apart. */
export function factsOf(s: Statement, scope: Scope = 'unknown'): Fact[] {
  const spelled = expand(s.text);
  // a planning line: "Planned 51.01%, Actual 51.01%"
  const pl = spelled.match(/plan(?:ned)?\s*(?:progress|completion)?\s*[:=]?\s*([\d.]+)\s*%.*?actual\s*(?:progress|completion)?\s*[:=]?\s*([\d.]+)\s*%/i);
  if (pl) return [{ id: `${s.line}:p`, line: s.line, raw: s.raw, tagsText: s.tagsText, tags: s.tags, text: clean(spelled), phrase: 'planning progress', state: 'info', kind: 'planning', planning: { planned: +pl[1], actual: +pl[2] }, scope: 'common', confidence: 0.95 }];
  const clauses = spelled.split(/(?<=[a-z\d)%])(?<!\b[Nn]o)\.\s+(?=[A-Za-z0-9])|;\s*|\s+\/\s+(?=[A-Z][a-z])/).map(clean).filter(Boolean);
  const train1 = TRAIN1.test(s.raw) || (scope === 'train1');
  return clauses.map((c, n): Fact => {
    const id = `${s.line}:${n}`;
    const base = { id, line: s.line, raw: s.raw, tagsText: s.tagsText, tags: s.tags, text: c };
    const qty: Fact['qty'] = [];
    for (const m of c.matchAll(QTY)) {
      const before = c.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
      qty.push({ value: +m[1].replace(/,/g, ''), unit: m[2].toLowerCase().replace(/s$/, ''), mode: /today|this shift|shift/i.test(before) ? 'daily' : 'cumulative' });
    }
    // "today 124" without a unit after the total
    const today = c.match(/\btoday\s*:?\s*(\d[\d,]*)\b/i);
    if (today && qty.length && !qty.some((q) => q.mode === 'daily')) qty.push({ value: +today[1].replace(/,/g, ''), unit: qty[0].unit, mode: 'daily' });
    const reading = READING.test(c) && !DONE.test(c.replace(READING, '')) && !/drums?|hydro(blast|jet)|clean/i.test(c);
    if (reading || (train1 && !s.tags.length)) return { ...base, phrase: clean(c), state: 'info', kind: 'reading', qty: qty.length ? qty.map((q) => ({ ...q, mode: 'reading' as const })) : undefined, scope: train1 ? 'train1' : scope, confidence: 0.8 };
    // "to be done" is pending, not done; "to start" is planned
    const stateOf = (): FactState => {
      if (RELEASE.test(c)) return 'info';
      const pm = c.match(PEND);
      if (pm && (/\b(done|completed?|started|carried out|installed|fixed|start)\b/i.test(pm[0]) || !DONE.test(c.replace(PEND, '')))) return /\b(to start|planned|scheduled|will)\b/i.test(c) ? 'planned' : 'pending';
      return DONE.test(c) ? 'done' : RUN.test(c) ? 'in_progress' : pm ? 'pending' : 'info';
    };
    let state = stateOf();
    // "to be done" after a done part: "buffing done, DPT to be done" is split by the caller at ","; here one clause
    let kind: FactKind = 'work'; let holdLevel: Fact['holdLevel'];
    if (RELEASE.test(c)) kind = 'hold_release';
    else if (HOLD.test(c)) { kind = 'hold'; holdLevel = 'confirmed'; }
    else if (DEFECT.test(c)) kind = 'defect';
    else if (RISK.test(c)) { kind = 'risk'; holdLevel = /under review|availability|subject to|tbc|to be confirmed/i.test(c) ? 'possible' : 'risk'; }
    else if (LOCATION.test(c) && !/\b(repair|clean|dye|test|inspect)\w*\s+(done|in progress|completed)/i.test(c)) kind = 'location';
    else if (READINESS.test(c)) kind = 'readiness';
    else if (qty.length && qty.some((q) => q.mode === 'cumulative') && !/\b[a-z]{4,}\b.*\b(done|in progress|completed)\b/i.test(c.replace(QTY, ''))) kind = 'quantity';
    if (kind === 'hold' && state === 'info') state = 'pending';
    if (kind === 'defect' && !DONE.test(c.replace(DEFECT, ''))) state = 'info';
    const phrase = clean(c.replace(QTY, '').replace(/\btoday\s*:?\s*\d[\d,]*\b/i, '').replace(DONE, ' ').replace(RUN, ' ').replace(PEND, ' ').replace(/\b(is|are|was|were|has been|have been|now|also|still|the|a|an)\b/gi, ' '));
    const confidence = kind === 'work' && state !== 'info' ? 0.85 : kind === 'quantity' ? 0.9 : kind === 'defect' || kind === 'hold' ? 0.8 : 0.6;
    return { ...base, phrase: phrase || clean(c), state, kind, qty: qty.length ? qty : undefined, holdLevel, scope: train1 ? 'train1' : scope, confidence };
  });
}

/** Every fact of a pasted report, numbered by line; the statements without any tag are kept as unmatched facts. */
export function readReport(text: string): { statements: Statement[]; facts: Fact[] } {
  const statements = segment(text);
  const facts: Fact[] = [];
  let scope: Scope = 'unknown';
  for (const s of statements) {
    if (s.header) { if (TRAIN1.test(s.raw)) scope = 'train1'; else if (/train-?\s?2|tr-?2/i.test(s.raw)) scope = 'train2'; continue; }
    // a clause split at "," or " and " only when every part carries a state ("spools removed and hydroblasting done";
    // "jackhammering and vacuuming in progress" stays one)
    const stated = (p: string) => DONE.test(expand(p)) || RUN.test(expand(p)) || PEND.test(expand(p));
    const pieces = s.text.split(/(?<=[a-z\d)%])(?<!\b[Nn]o)[.;]\s+(?=[A-Za-z0-9])/).flatMap((part) => {
      const byComma = part.split(/,\s*(?=[A-Za-z])/);
      const xs = byComma.length > 1 && byComma.every(stated) ? byComma : [part];
      return xs.flatMap((x) => { const byAnd = x.split(/\s+and\s+(?=[a-z])/i); return byAnd.length > 1 && byAnd.every(stated) ? byAnd : [x]; });
    });
    for (const [k, p] of pieces.entries()) facts.push(...factsOf({ ...s, text: p }, scope).map((f, n) => ({ ...f, id: `${s.line}:${k}:${n}` })));
  }
  return { statements, facts };
}

/** A stable fingerprint of a submission (the same text pasted again is recognised before any work is done). */
export function fingerprint(text: string, meta: { department: string; reportDate: string; shift: string | null }): string {
  const s = `${meta.department}|${meta.reportDate}|${meta.shift ?? ''}|${text.replace(/\s+/g, ' ').trim().toLowerCase()}`;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 0x01000193) >>> 0; h2 = (h2 + s.charCodeAt(i) * (i + 1)) >>> 0; }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
