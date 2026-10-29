// Daily update intelligence · reconciling a report with the tracker (Engine A, 27 Oct 2026).
// Every fact read from the report is matched to its equipment and its step, compared with what the tracker records,
// and turned into a proposal: a step to finish or start, a status line, drums, a new step the tracker lacks, a defect,
// a hold (confirmed · possible · at risk), a planning figure, or information only. Nothing here writes: the person
// applies a proposal through the normal saves (history, names and overwrite protection unchanged).
// Rules: the latest valid information wins, never an older report; the tracker is never moved back; a running step
// is never finished by a location word; cumulative counts take the highest plausible value within the tolerance and
// never get a day's count added; a defect is not a hold; Train-1 conditions never enter Train-2 progress.
import { readReport, type Department, DEPT_SHORT, type Fact } from './parse';
import { stepFor, words, stem } from '../reportImport';
import { sortActs, type TrkActivity, type TrkData, type TrkEquipment, type TrkLog, type TrkReturnItem } from '..';

export interface ReportMeta { department: Department; reportDate: string; shift: 'D' | 'N' | null; reporter: string | null; submittedAt: string }
/** The tolerance for a small difference between two cumulative counts of the same work: initial software settings,
 *  not engineering limits; editable in the tracker's Admin and subject to site validation. */
export interface Tolerance { abs: number; rel: number }
export const DEFAULT_TOLERANCE: Tolerance = { abs: 10, rel: 0.01 };
export const withinTolerance = (a: number, b: number, t: Tolerance = DEFAULT_TOLERANCE) => Math.abs(a - b) <= Math.max(t.abs, t.rel * Math.max(a, b));

export type ProposalType = 'finish_step' | 'start_step' | 'status_line' | 'drums' | 'new_step' | 'defect' | 'hold' | 'hold_release' | 'risk' | 'planning' | 'info' | 'review';
export type ProposalStatus = 'ready' | 'review' | 'conflict' | 'info' | 'applied' | 'dismissed';
export type Classification = 'already_recorded' | 'step_done' | 'step_in_progress' | 'step_pending' | 'new_activity' | 'workflow_change' | 'defect' | 'hold' | 'possible_hold' | 'hold_release'
  | 'risk' | 'unclear' | 'info' | 'quantity' | 'planning' | 'train1' | 'location' | 'readiness';
export const CLASS_LABEL: Record<Classification, string> = { already_recorded: 'Already recorded', step_done: 'Step completed', step_in_progress: 'Step in progress', step_pending: 'Step pending',
  new_activity: 'New activity', workflow_change: 'Workflow change', defect: 'Defect', hold: 'Hold', possible_hold: 'Possible hold', hold_release: 'Hold release', risk: 'Schedule risk',
  unclear: 'Unclear', info: 'Information', quantity: 'Quantity', planning: 'Planning progress', train1: 'Train-1 condition', location: 'Location', readiness: 'Readiness' };

export interface NewStep { title: string; after: string | null; before: string | null; owner: string | null; reason: string; durationH: number | null; opsAction: boolean; scheduleEffect: string }
export interface Proposal {
  id: string; factIds: string[]; tag: string | null; key: string | null; equipmentId: string | null; activityId: string | null; activityName: string | null;
  type: ProposalType; status: ProposalStatus; classification: Classification; title: string; detail: string;
  current: Record<string, unknown>; proposed: Record<string, unknown>; reason: string; evidence: string[]; issues: string[];
  level?: 'confirmed' | 'possible' | 'risk'; eventAt: string; department: Department; newStep?: NewStep;
}
export interface Summary { facts: number; ready: number; review: number; conflicts: number; holds: number; info: number; unmatched: number }
export interface Reconciled { facts: Fact[]; proposals: Proposal[]; summary: Summary; eventAt: string }

const KW = 3 * 36e5;
/** When the reported events happened: the end of the report's shift (day 19:00, night 07:00 next day), never after the
 *  submission; a report without a shift is read as the day's. Older than the tracker's own record → the record wins. */
export function eventAtOf(meta: ReportMeta): string {
  const base = Date.parse(`${meta.reportDate}T00:00:00Z`) - KW;
  const end = meta.shift === 'N' ? base + 31 * 36e5 : base + 19 * 36e5;
  const sub = Date.parse(meta.submittedAt);
  return new Date(Math.min(end, Number.isNaN(sub) ? end : sub)).toISOString();
}

interface Match { kind: 'equipment' | 'valve'; e?: TrkEquipment; item?: TrkReturnItem; tag: string }
const bare = (tag: string) => tag.replace(/-12-/, '-').toUpperCase();
/** A report tag resolved against the tracker: an item (R-12-205), the members of a combined item (E-216 → A and B), a
 *  loop item, or a small part on the put-back list (a valve). Unknown tags are never created. */
export function resolveTag(d: TrkData, tag: string): Match[] {
  const eq = d.equipment.find((x) => x.tag === tag) ?? (d.loopItems ?? []).find((x) => x.tag === tag);
  if (eq) return [{ kind: 'equipment', e: eq, tag: eq.tag }];
  const twins = d.equipment.filter((x) => x.combine && x.tag.startsWith(tag) && /^[A-Z]$/.test(x.tag.slice(tag.length)));
  if (twins.length) return twins.map((e) => ({ kind: 'equipment' as const, e, tag: e.tag }));
  const v = (d.putBack ?? []).find((x) => bare(x.tag) === bare(tag) || bare(x.tag).replace(/\s.*$/, '') === bare(tag));
  if (v) return [{ kind: 'valve', item: v, tag: v.tag }];
  // a part the tracker does not follow on its own (P-12-205-E-02): the item it belongs to
  const part = tag.match(/^([A-Z]{1,3}-12-\d{3})-(?:E|TK|F|ST|EJ)-\d{2}[A-Z]?$/);
  if (part) return resolveTag(d, part[1]);
  return [];
}

const keyOf = (e: TrkEquipment) => e.barchartKey ?? e.tag;
const linesOf = (d: TrkData, key: string) => sortActs(d.activities.filter((a) => a.key === key && a.tracked && !a.detail && a.group !== 'Operations' && !a.outOfScope));
const later = (iso: string | null | undefined, at: number) => !!iso && Date.parse(iso) > at;
const fmt = (iso: string) => new Date(Date.parse(iso) + KW).toISOString().slice(0, 16).replace('T', ' ');
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const overlap = (phrase: string, name: string) => { const p = words(phrase).map(stem), n = words(name).map(stem); return p.length ? p.filter((w) => n.includes(w)).length / p.length : 0; };
const WORKFLOW = /\b(re-?(test|inspect\w*|tub\w*|work|clean\w*|do|weld\w*|blast\w*)|additional|extra|again|replace\w*|rectif\w*|rework|new (elements?|tubes?|bundle|gasket))\b/i;
/** Work families (owner, 27 Oct 2026: no micro-tracking): a reported sub-item (trays cleaning, collector ring, diffuser,
 *  buffing, DPT …) belongs to the item's step of the same family and only marks that step running; it never adds a step. */
const FAMILIES: [string, RegExp][] = [
  ['scaffold', /\b(scaffold\w*|erect\w*)\b/i],
  ['cleaning', /\b(clean\w*|hydro\s?blast\w*|hydro\s?jet\w*|h\/?blast\w*|buff\w*|de-?chok\w*|jack\s?hammer\w*|vacuum\w*|dump\w*|flush\w*|steam\w*|wash\w*|pigging|scrap\w*|grinding)\b/i],
  ['inspection', /\b(inspect\w*|dye penetrant|dpt|ndt|radiograph\w*|ultrasonic|eddy current|iris|thickness|visual|offer\w*|clear\w*)\b/i],
  ['loading', /\b(load\w*|charg\w*)\b/i],
  ['repair', /\b(repair\w*|retub\w*|weld\w*|replac\w*|rectif\w*|rework|machining|overhaul\w*|fabricat\w*)\b/i],
  ['boxup', /\b(box[\s-]?up|fix(ing)? back|re-?fix\w*|re-?install\w*|install\w*|assembl\w*|tighten\w*|de-?blind\w*|connect\w*)\b/i],
  ['opening', /\b(remov\w*|drop\w*|dismantl\w*|open\w*|pull(ed)? out|disconnect\w*|blind\w*|insulation)\b/i]];
// a scaffolding note in brackets on a real step ("Shell pull out (scaffolding modification as required)") is not its family
const familyOf = (text: string): string | null => { const t = text.replace(/\([^)]*scaffold[^)]*\)?/gi, ' '); return FAMILIES.find(([, re]) => re.test(t))?.[0] ?? null; };
/** A step's family is its last work word ("Burner cleaning (Burner No. 6 tip) rectification" is a repair) */
const stepFamily = (name: string): string | null => {
  const t = name.replace(/\([^)]*scaffold[^)]*\)?/gi, ' '); let best: string | null = null, at = -1;
  for (const [k, re] of FAMILIES) { const m = t.match(re); if (m && (m.index ?? 0) >= at) { best = k; at = m.index ?? 0; } }
  return best;
};
const BARE_TAG = /^[A-Z]{1,3}-\d{2}-\d{3,4}[A-Z]?$/;
/** A clause about a part of the work, never the whole step: a pass, a numbered item, one piece, a side, the balance. */
const PARTIAL = /\b(pass(es)?|no\.?|nos\.?|one|two|three|four|\d+\s*(of|out of|nos|pcs)|partial\w*|part(s|ly)?|pieces?|pcs|side|half|remaining|balance|some|\d+\s+(pending|remaining|left|to go)|\d+\s*\/\s*\d+)\b/i;
/** A new step's name from the clause: the words as reported, without the trailing state words. */
const stepTitle = (text: string, phrase: string) => (/\s,|,$/.test(phrase) || words(phrase).length < 2 ? sentence(text.replace(/[,;]?\s*\b(in progress|under way|completed?|done|started|finished|pending|to start)\b\s*$/i, '').trim()) : sentence(phrase));
/** Families whose steps are about one object (owner, 27 Oct 2026: a collector ring repair is not the thermowell bracket
 *  repair): a report joins such a step only when it names the same object or the step is general ("Repair if required").
 *  Cleaning and inspection sub-items still join their family's step whatever they name (no micro-tracking). */
const OBJECT_FAMILIES = new Set(['repair', 'opening', 'boxup']);
const FILLER = new Set(['if', 'required', 'requir', 'possible', 'possibl', 'need', 'needed', 'any', 'per', 'work', 'job', 'progress', 'done', 'complet', 'pend', 'pending', 'start', 'start', 'from', 'into', 'out', 'back', 'item', 'equipment', 'side']);
const objectWords = (text: string) => words(text).filter((w) => !FAMILIES.some(([, re]) => re.test(w))).map(stem).filter((w) => !FILLER.has(w) && w.length > 2);
// "preparation" and "prepare", "collector" and "collect": the same object word
const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
const shares = (xs: string[], ys: string[]) => xs.some((x) => ys.some((y) => sameWord(x, y)));
const fitsFamilyStep = (fam: string, report: string, step: string) => {
  if (!OBJECT_FAMILIES.has(fam)) return true;
  const st = objectWords(step), rp = objectWords(report);
  return st.length === 0 || rp.length === 0 || shares(rp, st);
};
const INSPECTION_SCOPE = /\b(rtj|ring[\s-]?(type )?joints?|flanges? (faces?|inspection|grooves?)|grooves?|gasket (face|seat))\b/i;
const OPS_ACTION = /\b(handover|hand over|blind|gas test|permit|clearance|isolat|purge|n2|nitrogen|process)\b/i;

export interface ReconcileOptions { tolerance?: Tolerance; now?: number; /** proposals already in the database for this tracker (open or applied): the same change is not proposed twice */ existing?: { type: ProposalType; key: string | null; activityId: string | null; status: ProposalStatus; proposed: Record<string, unknown>; department: Department; reportDate: string }[] }

/** The report read against the tracker: every fact classified and, where the tracker should change, a proposal. */
export function reconcile(d: TrkData & { log?: TrkLog[] }, text: string, meta: ReportMeta, opts: ReconcileOptions = {}): Reconciled {
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE;
  const eventAt = eventAtOf(meta); const at = Date.parse(eventAt);
  const { facts } = readReport(text);
  const out: Proposal[] = []; let n = 0;
  const pid = () => `p${++n}`;
  const dept = DEPT_SHORT[meta.department];
  const mk = (p: Omit<Proposal, 'id' | 'eventAt' | 'department' | 'evidence' | 'issues'> & { evidence?: string[]; issues?: string[] }): Proposal =>
    ({ id: pid(), eventAt, department: meta.department, evidence: p.evidence ?? [], issues: p.issues ?? [], ...p });
  const quote = (f: Fact) => `${dept} ${meta.reportDate}${meta.shift ? ` ${meta.shift}` : ''}: "${f.raw}"`;

  // ── planning figures and Train-1 conditions: never equipment work ──
  for (const f of facts.filter((x) => x.kind === 'planning')) out.push(mk({ factIds: [f.id], tag: null, key: null, equipmentId: null, activityId: null, activityName: null, type: 'planning', status: 'ready',
    classification: 'planning', title: `Maintenance Planning: plan ${f.planning!.planned}% · actual ${f.planning!.actual}%`, detail: `Official figure of ${meta.reportDate}; stored apart from the tracker's own progress.`,
    current: {}, proposed: { planned: f.planning!.planned, actual: f.planning!.actual, reportDate: meta.reportDate }, reason: 'Official departmental progress', evidence: [quote(f)] }));
  for (const f of facts.filter((x) => x.kind === 'reading' || x.scope === 'train1')) if (x1(f)) out.push(mk({ factIds: [f.id], tag: f.scope === 'train1' ? null : f.tags[0] ?? null, key: null, equipmentId: null, activityId: null, activityName: null, type: 'info', status: 'info',
    classification: f.scope === 'train1' ? 'train1' : 'info', title: f.scope === 'train1' ? 'Train-1 condition (not Train-2 work)' : 'Process reading (information)', detail: f.text,
    current: {}, proposed: {}, reason: 'A reported condition, kept as written; not a step, not a readiness or safety conclusion', evidence: [quote(f)] }));
  function x1(f: Fact) { return f.kind === 'reading' || f.kind === 'planning' ? true : f.scope === 'train1'; }

  // ── equipment facts, grouped by tag ──
  const work = facts.filter((f) => f.kind !== 'planning' && f.kind !== 'reading' && f.scope !== 'train1');
  const byTag = new Map<string, Fact[]>();
  // a line naming two kinds of item ("E-12-205 / P-12-205: tube inlet flange …"): the first is what it is about; a later one takes
  // the line only when one of its steps names the same thing (owner's report, 29 Oct 2026: a pump never starts a filter
  // step from an exchanger's flange); otherwise the line is a note on it
  const alsoNamed: [string, Fact][] = [];
  const namesWorkOf = (t: string, f: Fact) => {
    const ow = objectWords(f.text); if (!ow.length) return true;
    return resolveTag(d, t).some((m) => m.kind !== 'equipment' || linesOf(d, keyOf(m.e!)).some((a) => shares(ow, objectWords(a.activity))));
  };
  for (const f of work) {
    if (!f.tags.length) byTag.set('', [...(byTag.get('') ?? []), f]);
    f.tags.forEach((t, i) => { if (i > 0 && t.split('-')[0] !== f.tags[0].split('-')[0] && !namesWorkOf(t, f)) alsoNamed.push([t, f]); else byTag.set(t, [...(byTag.get(t) ?? []), f]); });
  }
  for (const [t, f] of alsoNamed) out.push(mk({ factIds: [f.id], tag: t, key: null, equipmentId: null, activityId: null, activityName: null, type: 'info', status: 'info', classification: 'info',
    title: `${t}: named with ${f.tags[0]} · ${f.text}`, detail: `The line is about ${f.tags[0]}; none of ${t}'s steps names this work, so nothing changes on ${t}.`, current: {}, proposed: {}, reason: 'Second tag of a line', evidence: [quote(f)] }));
  for (const [tag, fs] of byTag) {
    if (!tag) { for (const f of fs) if (!/^\s*$/.test(f.text)) out.push(f.tagsText && !/^note\b/i.test(f.text)
      ? mk({ factIds: [f.id], tag: null, key: null, equipmentId: null, activityId: null, activityName: null, type: 'info', status: 'info', classification: 'info', title: `${f.tagsText}: ${f.text}`, detail: 'Not an item of this tracker; kept as a note of the report.', current: {}, proposed: {}, reason: 'Note under a heading', evidence: [quote(f)] })
      : /^note\b/i.test(f.text)
      ? mk({ factIds: [f.id], tag: null, key: null, equipmentId: null, activityId: null, activityName: null, type: 'info', status: 'info', classification: 'info', title: sentence(f.text.replace(/^note\s*[:\-–]?\s*/i, '')), detail: 'A general note of the report, kept as written.', current: {}, proposed: {}, reason: 'Note', evidence: [quote(f)] })
      : mk({ factIds: [f.id], tag: null, key: null, equipmentId: null, activityId: null, activityName: null, type: 'review', status: 'review', classification: 'unclear',
      title: 'No equipment named', detail: f.text, current: {}, proposed: {}, reason: 'The line names no tag: say which item it is about, or leave it', evidence: [quote(f)] })); continue; }
    // an IAT (hot-work permit item) named by its number: its line is kept with it as information
    if (tag.startsWith('IAT-')) {
      const no = tag.slice(4); const iat = (d.iats ?? []).find((x) => x.iatNo === no || x.iatNo.endsWith(no.slice(-5)));
      for (const f of fs) out.push(mk({ factIds: [f.id], tag: iat ? `IAT ${iat.iatNo} · ${iat.tag}` : `IAT ${no}`, key: null, equipmentId: null, activityId: null, activityName: null, type: 'info', status: 'info', classification: iat ? 'info' : 'unclear',
        title: iat ? `IAT ${iat.iatNo} (${iat.tag}, ${iat.status}): ${f.text}` : `IAT ${no} is not in this tracker: ${f.text}`, detail: iat ? 'Hot-work item: its status is followed on the Hot work tab; this report is linked to it.' : 'No IAT with this number in the tracker.', current: iat ? { status: iat.status } : {}, proposed: {}, reason: 'IAT line', evidence: [quote(f)] }));
      continue;
    }
    const matches = resolveTag(d, tag);
    if (!matches.length) { out.push(mk({ factIds: fs.map((f) => f.id), tag, key: null, equipmentId: null, activityId: null, activityName: null, type: 'review', status: 'review', classification: 'unclear',
      title: `${tag} is not in this tracker`, detail: fs.map((f) => f.text).join(' · '), current: {}, proposed: {}, reason: 'Unknown tag: equipment is never created from a report (another unit, a typo, or a part not tracked)', evidence: fs.map(quote) })); continue; }
    for (const m of matches) {
      if (m.kind === 'valve') { for (const f of fs) out.push(mk({ factIds: [f.id], tag: m.tag, key: null, equipmentId: null, activityId: null, activityName: null, type: 'info', status: 'info', classification: f.kind === 'location' ? 'location' : 'info',
        title: `${m.tag} (put-back list · ${m.item!.status}): ${f.text}`, detail: 'A small part on the put-back list: its status is kept there (removed → serviced → installed); this report is linked to it.', current: { status: m.item!.status }, proposed: {}, reason: 'Valve work is followed on the put-back list, not as equipment steps', evidence: [quote(f)] })); continue; }
      const e = m.e!; const key = keyOf(e);
      if (!e.tracked) { out.push(mk({ factIds: fs.map((f) => f.id), tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'info', status: 'info', classification: 'info', title: `${e.tag} is off the tracker / out of scope`, detail: fs.map((f) => f.text).join(' · '), current: { disabled: e.disabledReason }, proposed: {}, reason: 'Kept as information only', evidence: fs.map(quote) })); continue; }
      const acts = linesOf(d, key);
      const noteAt = (d.log ?? []).filter((l) => l.kind === 'equipment' && l.ref === e.tag && l.field === 'note').map((l) => l.at).sort().pop();
      // the status line (owner, 28 Oct 2026: least text): what is in progress now; if nothing is, what was done
      const runParts: string[] = [], doneParts: string[] = [];
      const addStatus = (f: Fact) => { if (f.kind === 'quantity' || INSPECTION_SCOPE.test(f.text) || BARE_TAG.test(f.text) || (words(f.text).length <= 2 && !objectWords(f.text).length)) return; (f.state === 'in_progress' || f.kind === 'hold' || f.kind === 'risk' ? runParts : doneParts).push(f.text); };
      // steps this report already finishes are not matched again; a family still running (another clause) is not finished
      const claimed = new Set<string>();
      const famRunning = new Set(fs.filter((f) => f.state === 'in_progress').map((f) => familyOf(f.text)).filter(Boolean));
      // what is done first, then what is running: a finished step frees the next one for the running clause
      const ordered = [...fs.filter((f) => f.state === 'done'), ...fs.filter((f) => f.state !== 'done')];
      for (const f of ordered) {
        if (BARE_TAG.test(f.text)) continue;
        const ev = [quote(f)];
        const nounOnly = f.phrase;
        // facts about several unnamed valves or parts: which ones is not known → a person decides, nothing is attributed
        if (/\b(\d+|two|three|four|five|six|several|all)\s+(control valves?|valves?|psvs?|spools?|elements?)\b/i.test(f.text) && !/\b[A-Z]{1,3}-(?:12-)?\d{3}/.test(f.text)) {
          out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'review', status: 'review', classification: 'unclear', title: `${e.tag}: ${f.text}`,
            detail: 'Which parts are not named: match them to their records by tag, or keep as a note. Nothing is assigned to this item on its own.', current: {}, proposed: {}, reason: 'Identifiers not given', evidence: ev }));
          continue;
        }
        if (f.kind === 'location') {
          const st = stepFor(nounOnly, acts);
          if (st && /workshop|site|shift|transfer|send|return/i.test(st.activity) && !st.actualFinish) {
            out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: st.id, activityName: st.activity, type: 'finish_step', status: later(st.updatedAt, at) ? 'conflict' : 'ready', classification: 'step_done',
              title: `${e.tag}: ✓ ${st.activity}`, detail: f.text, current: { actualStart: st.actualStart, actualFinish: st.actualFinish }, proposed: { actualFinish: eventAt }, reason: 'The report says the part was moved; the step is the move itself', evidence: ev,
              issues: later(st.updatedAt, at) ? ['the step changed after the report'] : [] }));
          } else out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'info', status: 'info', classification: 'location', title: `${e.tag}: ${f.text}`,
            detail: 'Where the part is. A location never completes a repair or an installation: those are reported as their own work.', current: {}, proposed: {}, reason: 'Component location kept apart from repair status', evidence: ev }));
          addStatus(f); continue;
        }
        if (f.kind === 'readiness') {
          // the step that records an offer / clearance / inspection: the first of them not finished
          const offer = acts.find((a) => /offer|ready for|clearance|inspection/i.test(a.activity) && !a.actualFinish) ?? acts.find((a) => /offer|ready for|clearance|inspection/i.test(a.activity)) ?? null;
          out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: offer?.id ?? null, activityName: offer?.activity ?? null, type: offer && !offer.actualFinish ? 'review' : 'info', status: offer && !offer.actualFinish ? 'review' : 'info', classification: 'readiness',
            title: `${e.tag}: ${sentence(f.text)}`, detail: offer ? `Step "${offer.activity}" ${offer.actualFinish ? 'is already finished' : offer.actualStart ? 'is running' : 'has not started'}: an offer or a clearance is recorded on that step by a person; an acceptance is never assumed.` : 'Readiness as reported; inspection acceptance, handover and a formal clearance are not assumed from it.',
            current: offer ? { actualStart: offer.actualStart, actualFinish: offer.actualFinish } : {}, proposed: {}, reason: 'Readiness is not acceptance', evidence: ev }));
          addStatus(f); continue;
        }
        if (f.kind === 'hold' || f.kind === 'risk') {
          const level = f.holdLevel ?? 'possible';
          const st = stepFor(nounOnly, acts) ?? acts.find((a) => a.actualStart && !a.actualFinish) ?? null;
          const same = e.pendingReason && overlap(f.text, e.pendingReason) >= 0.5;
          out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: st?.id ?? null, activityName: st?.activity ?? null, type: level === 'confirmed' ? 'hold' : 'risk', level,
            status: same ? 'info' : level === 'confirmed' ? 'ready' : 'review', classification: level === 'confirmed' ? 'hold' : level === 'possible' ? 'possible_hold' : 'risk',
            title: `${e.tag}: ${level === 'confirmed' ? 'Hold' : level === 'possible' ? 'Possible hold' : 'At risk'} · ${f.text}`,
            detail: level === 'confirmed' ? `Work stopped or blocked${st ? ` on "${st.activity}"` : ''}. Applying sets the item's pending reason (the hold starts at the report's time; the release is recorded when it comes).` : `${level === 'possible' ? 'An unresolved condition may stop the work' : 'A problem that may affect later work'}${st ? ` on "${st.activity}"` : ''}: watched, nothing is changed.`,
            current: { pendingReason: e.pendingReason }, proposed: level === 'confirmed' ? { pendingReason: sentence(f.text).slice(0, 120) } : {}, reason: same ? 'The tracker already records this hold' : `Reported by ${dept}`, evidence: ev }));
          addStatus(f); continue;
        }
        if (f.kind === 'hold_release') {
          out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'hold_release', status: e.pendingReason ? 'ready' : 'info', classification: 'hold_release', title: `${e.tag}: hold released · ${f.text}`,
            detail: e.pendingReason ? `Clears the pending reason "${e.pendingReason}".` : 'No hold is recorded on this item.', current: { pendingReason: e.pendingReason }, proposed: { pendingReason: null }, reason: `Reported by ${dept}`, evidence: ev }));
          addStatus(f); continue;
        }
        if (f.kind === 'defect') {
          const rel = acts.filter((a) => !a.actualFinish && overlap(nounOnly.replace(/\b(no\.?|number)\s*\d+\b/i, ''), a.activity) > 0);
          const fix = sentence(nounOnly.replace(/found|broken|damaged|cracked|failed|rejected|leaking|bent|missing/gi, '').replace(/\s+/g, ' ').trim());
          out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: rel[0]?.id ?? null, activityName: rel[0]?.activity ?? null, type: 'defect', status: 'review', classification: 'defect',
            title: `${e.tag}: defect · ${f.text}`, detail: `${rel.length ? `Related step: "${rel[0].activity}". ` : ''}Proposed: a rectification step "${fix} rectification" after ${rel[0]?.activity ?? 'the current work'}; whether it needs a repair, a spare or an inspection decision is for the Engineer. Not a hold: the work continues unless a hold is reported.`,
            current: {}, proposed: { event: f.text, newStep: `${fix} rectification` }, reason: 'Unexpected finding', evidence: ev,
            newStep: { title: `${fix} rectification`, after: rel[0]?.activity ?? null, before: null, owner: DEPT_SHORT[meta.department], reason: f.text, durationH: null, opsAction: OPS_ACTION.test(f.text), scheduleEffect: rel.length ? `may extend "${rel[0].activity}"; duration not known` : 'not known' } }));
          addStatus(f); continue;
        }
        if (f.kind === 'quantity' || (f.qty?.some((q) => q.mode === 'cumulative') && f.kind === 'work')) {
          const q = f.qty!.find((x) => x.mode === 'cumulative')!; const daily = f.qty!.find((x) => x.mode === 'daily');
          const sc = d.engine?.scopes.find((s) => s.key === key && s.scope === 'removal');
          if (q.unit === 'drum' && sc) {
            const es = (d.engine?.entries ?? []).filter((x) => x.scopeId === sc.id && x.kind !== 'transfer' && x.verify !== 'rejected');
            const current = es.reduce((t, x) => t + x.qty, 0);
            const local = new Date(at + KW); const hm = local.getUTCHours() * 60 + local.getUTCMinutes();
            const shift = meta.shift ?? (hm > 7 * 60 && hm <= 19 * 60 ? 'D' : 'N');
            const shiftDate = meta.reportDate;
            const same = es.find((x) => x.kind === 'removal' && x.shiftDate === shiftDate && x.shift === shift);
            const dailyNote = daily ? ` · today ${daily.value} ${daily.unit}s reported (a day's count, never added to the total)` : '';
            if (q.value > current) out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'drums', status: 'ready', classification: 'quantity', title: `${e.tag}: ${q.value.toLocaleString()} drums (tracker ${current.toLocaleString()})`,
              detail: `Adds ${q.value - current} to reach the reported total${dailyNote}.`, current: { total: current }, proposed: { total: q.value, add: q.value - current, scopeId: sc.id, shift, shiftDate, corrects: same?.id ?? null, method: es.find((x) => x.kind === 'removal')?.method ?? 'other' }, reason: 'Cumulative count up to the report', evidence: [quote(f)] }));
            else if (withinTolerance(q.value, current, tol)) out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'info', status: 'info', classification: 'already_recorded', title: `${e.tag}: ${q.value.toLocaleString()} drums · tracker ${current.toLocaleString()} (within tolerance)`,
              detail: `Difference ${current - q.value} within ${tol.abs} / ${tol.rel * 100}%: the higher count is kept${dailyNote}.`, current: { total: current }, proposed: {}, reason: 'Minor reporting difference', evidence: [quote(f)] }));
            else out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'review', status: 'conflict', classification: 'quantity', title: `${e.tag}: ${q.value.toLocaleString()} drums reported, tracker ${current.toLocaleString()}`,
              detail: `Lower by ${current - q.value}, beyond the tolerance: a counter reset, a change of scope or a wrong figure? The tracker keeps its count until a person decides${dailyNote}.`, current: { total: current }, proposed: {}, reason: 'Significant difference', evidence: [quote(f)], issues: ['reported total below the tracker'] }));
          } else out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'info', status: 'info', classification: 'quantity', title: `${e.tag}: ${q.value.toLocaleString()} ${q.unit}s`, detail: 'A quantity with no count kept for it in the tracker: recorded as information.', current: {}, proposed: {}, reason: 'No measured scope', evidence: [quote(f)] }));
          if (f.kind === 'quantity') { addStatus(f); continue; }
        }
        // ── work: a step of the tracker, or work it lacks ──
        if (f.state === 'info') { addStatus(f); out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'info', status: 'info', classification: 'info', title: `${e.tag}: ${f.text}`, detail: 'No state word: kept as information.', current: {}, proposed: {}, reason: 'Information only', evidence: ev })); continue; }
        const st = stepFor(nounOnly, acts.filter((a) => !claimed.has(a.id)));
        addStatus(f);
        if (st) {
          const changed = later(st.updatedAt, at);
          if (f.state === 'done') {
            if (st.actualFinish) out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: st.id, activityName: st.activity, type: 'info', status: 'info', classification: 'already_recorded', title: `${e.tag}: ✓ ${st.activity} (recorded ${fmt(st.actualFinish)})`, detail: f.text, current: { actualFinish: st.actualFinish }, proposed: {}, reason: 'Already finished in the tracker', evidence: ev }));
            // "All burners removed" names the burner cleaning step but is not its work: a part of it, never its finish
            else if (stepFamily(st.activity) && familyOf(f.text) !== stepFamily(st.activity)) {
              if (!st.actualStart) { claimed.add(st.id); out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: st.id, activityName: st.activity, type: 'start_step', status: changed ? 'conflict' : 'ready', classification: 'step_in_progress',
                title: `${e.tag}: ▶ ${st.activity}`, detail: `"${sentence(f.text)}" is part of this step: it starts; it finishes when the step's own work is reported done.`, current: { actualStart: null }, proposed: { actualStart: eventAt }, reason: `${dept} reports part of the step`, evidence: ev, issues: changed ? [`the step changed in the tracker after the report (${fmt(st.updatedAt!)})`] : [] })); }
              else out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: st.id, activityName: st.activity, type: 'info', status: 'info', classification: 'already_recorded', title: `${e.tag}: ${f.text} · part of ▶ ${st.activity}`,
                detail: 'Part of the running step; it finishes when the step\'s own work is reported done.', current: { actualStart: st.actualStart }, proposed: {}, reason: 'Part of a running step', evidence: ev }));
            }
            else { claimed.add(st.id); out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: st.id, activityName: st.activity, type: 'finish_step', status: changed ? 'conflict' : 'ready', classification: 'step_done', title: `${e.tag}: ✓ ${st.activity}`, detail: f.text,
              current: { actualStart: st.actualStart, actualFinish: null }, proposed: { actualStart: st.actualStart ?? eventAt, actualFinish: eventAt }, reason: `${dept} reports it done`, evidence: ev, issues: changed ? [`the step changed in the tracker after the report (${fmt(st.updatedAt!)})`] : [] })); }
          } else if (f.state === 'in_progress') {
            if (st.actualFinish) out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: st.id, activityName: st.activity, type: 'info', status: 'conflict', classification: 'already_recorded', title: `${e.tag}: "${st.activity}" reported running, tracker has it finished ${fmt(st.actualFinish)}`, detail: f.text, current: { actualFinish: st.actualFinish }, proposed: {}, reason: 'The tracker is further than the report (an older report, or a finish to check)', evidence: ev, issues: ['tracker further than the report'] }));
            else if (st.actualStart) out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: st.id, activityName: st.activity, type: 'info', status: 'info', classification: 'already_recorded', title: `${e.tag}: ▶ ${st.activity} (running since ${fmt(st.actualStart)})`, detail: f.text, current: { actualStart: st.actualStart }, proposed: {}, reason: 'Already running in the tracker', evidence: ev }));
            else out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: st.id, activityName: st.activity, type: 'start_step', status: changed ? 'conflict' : 'ready', classification: 'step_in_progress', title: `${e.tag}: ▶ ${st.activity}`, detail: f.text,
              current: { actualStart: null }, proposed: { actualStart: eventAt }, reason: `${dept} reports it in progress`, evidence: ev, issues: changed ? [`the step changed in the tracker after the report (${fmt(st.updatedAt!)})`] : [] }));
          } else {
            // pending / planned
            if (st.actualStart) out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: st.id, activityName: st.activity, type: 'info', status: 'conflict', classification: 'step_pending', title: `${e.tag}: "${st.activity}" reported ${f.state === 'planned' ? 'to start' : 'pending'}, tracker has it ${st.actualFinish ? 'finished' : 'running'}`, detail: f.text, current: { actualStart: st.actualStart, actualFinish: st.actualFinish }, proposed: {}, reason: 'The tracker is further than the report: check which is right (nothing is moved back)', evidence: ev, issues: ['tracker further than the report'] }));
            else out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: st.id, activityName: st.activity, type: 'info', status: 'info', classification: 'step_pending', title: `${e.tag}: ${st.activity} · ${f.state === 'planned' ? 'to start' : 'pending'}`, detail: f.text, current: { actualStart: null }, proposed: {}, reason: 'Matches the tracker: not started', evidence: ev }));
          }
          continue;
        }
        // no step of that name
        if (f.state === 'pending' || f.state === 'planned') { out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'info', status: 'info', classification: 'step_pending', title: `${e.tag}: ${f.text}`, detail: 'Planned work with no step of that name yet: added when it starts, if the Engineer agrees.', current: {}, proposed: {}, reason: 'Not started', evidence: ev })); continue; }
        // an inspection-scope remark (RTJ ring joints, flange faces, grooves): information on the item, never a work step of its own
        if (INSPECTION_SCOPE.test(f.text)) {
          out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'info', status: 'info', classification: 'info', title: `${e.tag}: inspection scope · ${f.text}`,
            detail: 'A remark on the inspection scope (RTJ / flanges), kept with the item; the inspection worklist and the IATs carry the findings. Not a step of this item\'s work.', current: {}, proposed: {}, reason: 'General inspection remark', evidence: ev }));
          continue;
        }
        // a sub-item of a work family → the item's step of that family, marked running (no new step)
        const fam = familyOf(f.text);
        // the same step reported done twice in one report (two lines): one proposal, both quotes
        const stAll = stepFor(nounOnly, acts);
        if (stAll && claimed.has(stAll.id) && f.state === 'done') { const prev = out.find((p) => p.type === 'finish_step' && p.activityId === stAll.id); if (prev) { prev.factIds.push(f.id); prev.evidence.push(...ev); continue; } }
        // the work reported done and its step already finished in the tracker ("loading preparation completed" after
        // Prepare for loading ✓): already recorded; it never starts the family's next step
        if (fam && f.state === 'done') {
          const ow = objectWords(nounOnly); const fin = ow.length ? acts.find((a) => a.actualFinish && stepFamily(a.activity) === fam && shares(ow, objectWords(a.activity))) : undefined;
          if (fin) { out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: fin.id, activityName: fin.activity, type: 'info', status: 'info', classification: 'already_recorded',
            title: `${e.tag}: ✓ ${fin.activity} (recorded ${fmt(fin.actualFinish!)})`, detail: `"${sentence(f.text)}" is already recorded on this step.`, current: { actualFinish: fin.actualFinish }, proposed: {}, reason: 'Already recorded', evidence: ev })); continue; }
        }
        const openActs = acts.filter((a) => !claimed.has(a.id));
        let famSteps = fam ? openActs.filter((a) => stepFamily(a.activity) === fam && fitsFamilyStep(fam, nounOnly, a.activity)) : [];
        // a part removed or fitted for its repair ("quench pipe one piece removed" with a quench pipe repair step): that repair step
        let via: string | null = null;
        if (fam && OBJECT_FAMILIES.has(fam) && !famSteps.some((a) => !a.actualFinish)) {
          const other = openActs.filter((a) => { const g = stepFamily(a.activity); return g !== fam && g !== null && OBJECT_FAMILIES.has(g) && !a.actualFinish && shares(objectWords(nounOnly), objectWords(a.activity)); });
          if (other.length) { famSteps = other; via = stepFamily(other[0].activity); }
        }
        const byFit = (xs: TrkActivity[]) => [...xs].sort((a, b) => overlap(nounOnly, b.activity) - overlap(nounOnly, a.activity));
        const famStep = byFit(famSteps.filter((a) => a.actualStart && !a.actualFinish))[0] ?? byFit(famSteps.filter((a) => !a.actualStart))[0] ?? null;
        if (famStep) {
          const changed = later(famStep.updatedAt, at); const what = via ?? fam;
          const issues = changed ? [`the step changed in the tracker after the report (${fmt(famStep.updatedAt!)})`] : [];
          // the whole work of the step reported done ("loading preparation completed"), not a part of it ("basket cleaning
          // done", "pass 2 done"): the step finishes. A part done while the step has not started: the step starts.
          const whole = !PARTIAL.test(f.text) && (objectWords(nounOnly).length === 0 || shares(objectWords(nounOnly), objectWords(famStep.activity)));
          // another clause of the same family still running keeps the step open only when it is the family's last open step
          const blocked = famRunning.has(fam!) && famSteps.filter((a) => !a.actualFinish).length <= 1;
          if (f.state === 'done' && !blocked && !via && whole) {
            // the family's work reported done: the step finishes (and starts, if the start was never recorded)
            claimed.add(famStep.id);
            out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: famStep.id, activityName: famStep.activity, type: 'finish_step', status: changed ? 'conflict' : 'ready', classification: 'step_done',
              title: `${e.tag}: ✓ ${famStep.activity}`, detail: `"${sentence(f.text)}" completes this ${what} step.`, current: { actualStart: famStep.actualStart, actualFinish: null }, proposed: { actualStart: famStep.actualStart ?? eventAt, actualFinish: eventAt }, reason: `${dept} reports the ${what} done`, evidence: ev, issues }));
          } else if (!famStep.actualStart) out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: famStep.id, activityName: famStep.activity, type: 'start_step', status: changed ? 'conflict' : 'ready', classification: 'step_in_progress',
            title: `${e.tag}: ▶ ${famStep.activity}`, detail: `"${sentence(f.text)}" starts this step. It finishes when the whole ${what} work is reported done.`,
            current: { actualStart: null }, proposed: { actualStart: eventAt }, reason: `${dept} reports ${what} work on the item`, evidence: ev, issues }));
          else out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: famStep.id, activityName: famStep.activity, type: 'info', status: 'info', classification: 'already_recorded',
            title: `${e.tag}: ${f.text} · part of ▶ ${famStep.activity}`, detail: `${what} in progress since ${fmt(famStep.actualStart!)}; this sub-item is noted, not a step of its own.`, current: { actualStart: famStep.actualStart }, proposed: {}, reason: 'Sub-item of a running step', evidence: ev }));
          continue;
        }
        // a family with every step finished: more of the same work is a workflow change (re-test, additional cleaning); any
        // other sub-item with no step of its family on the item is noted, never a step of its own
        // an object family naming another object (collector ring, not the thermowell brackets): a step to suggest, below
        const otherObject = !!fam && OBJECT_FAMILIES.has(fam) && objectWords(nounOnly).length > 0 && acts.some((a) => stepFamily(a.activity) === fam && !a.actualFinish);
        if (fam && !otherObject && !(famSteps.length && WORKFLOW.test(f.text))) {
          out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'info', status: 'info', classification: 'info', title: `${e.tag}: ${f.text}`,
            detail: famSteps.length ? `${fam} already finished on this item; noted.` : `${fam} work noted on the item (no ${fam} step in its plan; sub-items are not tracked one by one).`, current: {}, proposed: {}, reason: 'Sub-item noted', evidence: ev }));
          continue;
        }
        const near = acts.filter((a) => overlap(nounOnly, a.activity) >= 0.5).sort((a, b) => overlap(nounOnly, b.activity) - overlap(nounOnly, a.activity));
        if (near.length) {
          const a = near[0];
          out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: a.id, activityName: a.activity, type: 'review', status: 'review', classification: 'already_recorded', title: `${e.tag}: "${f.text}" — part of "${a.activity}"?`,
            detail: `The existing step can represent this work${a.actualFinish ? ' (finished)' : a.actualStart ? ' (running)' : ' (not started)'}: keep it as a note on that step rather than a new one.`, current: { actualStart: a.actualStart, actualFinish: a.actualFinish }, proposed: { note: f.text }, reason: 'Avoid a duplicate step', evidence: ev }));
          continue;
        }
        const running = acts.find((a) => a.actualStart && !a.actualFinish), lastDone = [...acts].reverse().find((a) => a.actualFinish), next = acts.find((a) => !a.actualStart);
        const change = WORKFLOW.test(f.text);
        out.push(mk({ factIds: [f.id], tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'new_step', status: 'review', classification: change ? 'workflow_change' : 'new_activity',
          title: `${e.tag}: new step "${stepTitle(f.text, nounOnly)}" (${f.state === 'done' ? 'done' : 'in progress'})`,
          detail: `Not in the tracker. Suggested after "${(running ?? lastDone)?.activity ?? 'the start'}"${next ? ` and before "${next.activity}"` : ''}; ${change ? 'a change of the planned sequence: the P6 baseline stays, completed steps stay' : 'extra work reported by the field'}. Duration not estimated.`,
          current: {}, proposed: { title: stepTitle(f.text, nounOnly), state: f.state, after: (running ?? lastDone)?.id ?? null }, reason: `${dept} reports work the tracker has no step for`, evidence: ev,
          newStep: { title: stepTitle(f.text, nounOnly), after: (running ?? lastDone)?.activity ?? null, before: next?.activity ?? null, owner: DEPT_SHORT[meta.department], reason: f.text, durationH: null, opsAction: OPS_ACTION.test(f.text), scheduleEffect: change ? 'may move what follows; the forecast re-runs once the step is in' : 'none expected' } }));
      }
      // one consolidated status line per item: the report's words, unless the tracker says the same or more, or was changed later
      const tk = (x: string) => words(x).map(stem);
      const parts0 = runParts.length ? runParts : doneParts;
      const parts = parts0.filter((x, i) => !parts0.some((y, j) => j !== i && (j < i || tk(y).length > tk(x).length) && tk(x).every((w) => tk(y).includes(w))));
      if (parts.length) {
        const line = sentence(parts.join('; ')).replace(/\.$/, '').slice(0, 160);
        const toks = (x: string) => [...words(x).map(stem), ...(x.match(/\d+/g) ?? [])];
        const subset = !!e.remark && toks(line).every((w) => toks(e.remark!).includes(w));
        if ((e.remark ?? '').trim().toLowerCase() !== line.toLowerCase()) out.push(mk({ factIds: fs.map((f) => f.id), tag: e.tag, key, equipmentId: e.id, activityId: null, activityName: null, type: 'status_line',
          status: later(noteAt, at) ? 'conflict' : subset ? 'info' : 'ready', classification: subset ? 'already_recorded' : 'info', title: `${e.tag}: status "${line}"`, detail: e.remark ? `Now: "${e.remark}"` : 'No status line yet',
          current: { remark: e.remark }, proposed: { remark: line }, reason: later(noteAt, at) ? 'The status was changed after this report' : subset ? 'The tracker status already says this and more' : `The latest words of ${dept}`, evidence: fs.map(quote), issues: later(noteAt, at) ? ['status changed after the report'] : [] }));
      }
    }
  }
  // ── the same change already proposed or applied from another report: linked, not repeated ──
  for (const p of out) {
    const dup = (opts.existing ?? []).find((x) => x.type === p.type && x.key === p.key && x.activityId === p.activityId && (p.type !== 'status_line' || x.proposed.remark === p.proposed.remark) && (p.type !== 'drums' || x.proposed.total === p.proposed.total) && (p.type !== 'planning' || x.proposed.reportDate === p.proposed.reportDate) && x.status !== 'dismissed');
    if (dup && p.status !== 'info') { p.status = dup.status === 'applied' ? 'info' : 'info'; p.classification = 'already_recorded'; p.reason = `${dup.status === 'applied' ? 'Applied' : 'Already proposed'} from the ${DEPT_SHORT[dup.department]} report of ${dup.reportDate}`; p.evidence.push(`linked to the ${DEPT_SHORT[dup.department]} report of ${dup.reportDate}`); }
  }
  // the same statement from two departments in one submission is one proposal with both sources
  const seen = new Map<string, Proposal>(); const merged: Proposal[] = [];
  for (const p of out) {
    const k = p.type === 'info' || p.type === 'review' ? `${p.type}|${p.tag}|${p.title}|${p.detail}` : `${p.type}|${p.key}|${p.activityId}|${JSON.stringify(p.proposed)}`;
    const prev = seen.get(k); if (prev) { prev.factIds.push(...p.factIds); prev.evidence.push(...p.evidence.filter((e) => !prev.evidence.includes(e))); continue; }
    seen.set(k, p); merged.push(p);
  }
  const summary: Summary = { facts: facts.length, ready: merged.filter((p) => p.status === 'ready').length, review: merged.filter((p) => p.status === 'review').length, conflicts: merged.filter((p) => p.status === 'conflict').length,
    holds: merged.filter((p) => p.type === 'hold' || p.type === 'risk').length, info: merged.filter((p) => p.status === 'info').length, unmatched: merged.filter((p) => p.classification === 'unclear').length };
  return { facts, proposals: merged, summary, eventAt };
}

/** Facts and proposals of one item, for its sheet: the latest reported status, the current confirmed step, the latest
 *  completed work, outstanding work, issues, and what is proposed. */
export function latestFor<T extends Proposal>(d: TrkData, tag: string, proposals: T[]): { status: string | null; current: TrkActivity | null; done: TrkActivity | null; outstanding: TrkActivity[]; issues: T[]; proposed: T[] } {
  const e = d.equipment.find((x) => x.tag === tag); if (!e) return { status: null, current: null, done: null, outstanding: [], issues: [], proposed: [] };
  const acts = linesOf(d, keyOf(e));
  const mine = proposals.filter((p) => p.tag === tag);
  const status = mine.filter((p) => p.type === 'status_line').sort((a, b) => Date.parse(b.eventAt) - Date.parse(a.eventAt))[0]?.proposed.remark as string | undefined;
  return { status: status ?? e.remark ?? null, current: acts.find((a) => a.actualStart && !a.actualFinish) ?? null, done: [...acts].reverse().find((a) => a.actualFinish) ?? null, outstanding: acts.filter((a) => !a.actualFinish),
    issues: mine.filter((p) => ['defect', 'hold', 'risk', 'hold_release'].includes(p.type) && p.status !== 'dismissed'), proposed: mine.filter((p) => ['ready', 'review', 'conflict'].includes(p.status)) };
}
