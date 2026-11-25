// The Unit log overview (owner, 25 Nov 2026: "card for each section; if I click it I see the drawing related"; limits
// from the owner's library, kept as written). Pure: from one ARDS shift log, that shift's Controller I log, the day's
// lab results, the limit library and the open overrides, it works out every check, each section's counts and the
// handover lines. Nothing is guessed:
//   bad   beyond the IOW standard (or critical) limit, or an open trip override   ●
//   off   outside the normal range                                                 ▲
//   chk   a value to check before trusting it (negative ΔP; one heater's skins copying the other's)   ⚑
//   grey  the library has a limit for it but the log / lab has no value            ○
//   ok    inside every limit
import { iowBand, keyMatches, limitBand, limitState, plainNumber, type Limit, type LimitMatch } from './limits';
import { eventsIn, kuwaitParts, tagsIn, type StoredLog, type StoredSample } from './view';

export type St = 'bad' | 'off' | 'chk' | 'grey' | 'ok';
export type TrainId = 'TR-1' | 'TR-2' | 'Common';
export type SectionId = 'feed' | 'heat' | 'rx' | 'gas' | 'sep' | 'frac';
export interface Override { id: string; train: TrainId; item: string; tags: string | null; reason: string | null; moc: string | null; startedOn: string | null; expiresOn: string | null; source: string | null }
export interface Check { paramId: string; section: SectionId | null; train: TrainId; label: string; value: string | null; unit: string; band: string; state: St; limit: Limit; note: string | null }

const RANK: Record<St, number> = { bad: 0, off: 1, chk: 2, grey: 3, ok: 4 };
export const worstOf = (xs: St[]): St => xs.reduce<St>((w, x) => (RANK[x] < RANK[w] ? x : w), 'ok');

/** Library section letter → the tile it belongs to (K utilities has no tile yet). */
export function sectionOf(l: Limit): SectionId | null {
  if (l.paramId === 'H103-SKIN') return 'heat';
  if (l.paramId === 'P103B-SPD') return 'feed';
  return ({ A: 'feed', B: 'heat', C: 'heat', D: 'rx', E: 'rx', F: 'gas', H: 'gas', G: 'sep', I: 'frac', J: 'frac' } as Record<string, SectionId>)[l.section.trim()[0]] ?? null;
}
/** Shared equipment (fractionator side) is one "Common" train. */
const commonParam = (l: Limit) => /^[IJ]/.test(l.section.trim()) && l.paramId !== 'P103B-SPD';
const COMMON_EQ = /^(T-10[2-5]|V-115|V-11[79]|E-1(08|17|18|12))\b/i;
export function trainOfEquipment(eq: string | null): TrainId | null {
  const e = (eq ?? '').trim().toUpperCase();
  if (COMMON_EQ.test(e)) return 'Common';
  const m = /-(?:12-)?([12])\d\d/.exec(e);
  return m ? (m[1] === '1' ? 'TR-1' : 'TR-2') : null;
}
const hasNumericLimit = (l: Limit) => l.normalLo !== null || l.normalHi !== null || !!iowBand(l.iowStd) || !!iowBand(l.iowCrit);
/** The library's traffic light in board terms (critical counts as a breach and is named in the note). */
const toSt = (x: ReturnType<typeof limitState>): St => (x === 'breach' || x === 'critical' ? 'bad' : x === 'off' ? 'off' : 'ok');
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export interface BoardInput { log: StoredLog; controller: StoredLog | null; lab: StoredSample[]; limits: Map<string, Limit>; matches: LimitMatch[]; overrides: Override[] }

/** Every check for one shift: one per limit and train (or Common). */
export function checksOf({ log, lab, limits, matches }: BoardInput): Check[] {
  const out: Check[] = [];
  const dayLab = lab.filter((s) => kuwaitParts(s.collectedAt)?.date === log.date);
  for (const l of limits.values()) {
    if (l.status === 'retired' || !hasNumericLimit(l)) continue;
    const ms = matches.filter((m) => m.paramId === l.paramId);
    const trains: TrainId[] = commonParam(l) ? ['Common'] : ['TR-1', 'TR-2'];
    const base = { paramId: l.paramId, section: sectionOf(l), label: l.description, unit: l.unit ?? '', band: limitBand(l) + (l.status === 'verify' ? ' (verify)' : ''), limit: l };
    const lm = ms.find((m) => m.kind === 'lab');
    if (lm && lm.kind === 'lab') {
      const hits = dayLab.flatMap((s) => s.results.filter((r) => r.component.trim().toUpperCase() === lm.component.trim().toUpperCase() && (s.material ?? '').trim().toUpperCase() === lm.material.trim().toUpperCase())
        .map((r) => ({ s, r, train: trainOfEquipment(s.equipment) })));
      const seen = new Set<TrainId>();
      for (const h of hits) {
        const train = h.train ?? 'Common'; seen.add(train);
        const st = toSt(limitState(h.r.value, l));
        out.push({ ...base, train, value: h.r.value, unit: h.r.unit ?? base.unit, state: st, note: `${h.s.equipment ?? ''} ${kuwaitParts(h.s.collectedAt)?.time ?? ''}`.trim() });
      }
      for (const t of trains) if (!seen.has(t)) out.push({ ...base, train: t, value: null, state: 'grey', note: 'no sample that day' });
      continue;
    }
    const rm = ms.filter((m) => m.kind === 'reading' || m.kind === 'reading_sum');
    if (!rm.length) { for (const t of trains) out.push({ ...base, train: t, value: null, state: 'grey', note: 'not in the e-logbook' }); continue; }
    for (const t of trains) {
      const side = t === 'TR-2' ? 'tr2' : 'tr1';
      const states: St[] = []; let shown: string | null = null; let shownSt: St = 'ok'; let shownX = -Infinity; let missing = 0; let found = 0; let note: string | null = null;
      for (const m of rm) {
        const rs = log.readings.filter((r) => keyMatches(m.key, r.key));
        if (m.kind === 'reading_sum') {
          const vals = rs.map((r) => plainNumber(r[side]));
          if (!rs.length || vals.some((v) => v === null)) { missing += 1; continue; }
          found += 1; const sum = (vals as number[]).reduce((a, b) => a + b, 0);
          shown = fmt(sum); states.push(toSt(limitState(sum, l, m.scale ?? 1))); note = `${rs.length} passes: ${vals.join(' + ')}`;
          continue;
        }
        for (const r of rs) {
          const v = r[side]; const x = plainNumber(v);
          if (x === null) { missing += 1; continue; }
          found += 1;
          let st: St = toSt(limitState(x, l, m.scale ?? 1));
          if (x < 0 && /ΔP|DP/.test(l.description + l.paramId)) { st = 'chk'; note = `${v} is negative: check the transmitter`; }
          states.push(st);
          // show the worst value; among equals, the highest
          if (shown === null || RANK[st] < RANK[shownSt] || (st === shownSt && x > shownX)) { shown = (m.scale ?? 1) === 1 ? v : fmt(x * (m.scale ?? 1)); shownSt = st; shownX = x; }
        }
      }
      let st: St = found ? worstOf(states) : 'grey';
      if (found && missing && st === 'ok') { st = 'grey'; note = `${missing} of ${found + missing} not read`; }
      else if (found && missing) note = `${note ? `${note} · ` : ''}${missing} of ${found + missing} not read`;
      out.push({ ...base, train: t, value: shown, state: st, note: found ? note : 'not in this log' });
    }
  }
  return copiedSkins(log, out);
}

/** A charge heater whose pass skins all sit within 2 °F of the recycle gas heater's: likely copied, check the entry. */
function copiedSkins(log: StoredLog, checks: Check[]): Check[] {
  const passes = (pair: string, side: 'tr1' | 'tr2') => [1, 2, 3, 4].map((p) => plainNumber(log.readings.find((r) => r.key === `PASS${p}SKINTEMPH12${pair}`)?.[side] ?? null));
  for (const side of ['tr1', 'tr2'] as const) {
    const a = passes('101201', side), b = passes('102202', side);
    if (a.every((x, k) => x !== null && b[k] !== null && Math.abs(x - (b[k] as number)) <= 2)) {
      const c = checks.find((x) => x.paramId === 'H1-SKIN' && x.train === (side === 'tr1' ? 'TR-1' : 'TR-2'));
      if (c && RANK[c.state] > RANK.chk) { c.state = 'chk'; c.note = 'every pass within 2 °F of the recycle gas heater: check the entry'; }
    }
  }
  return checks;
}

export interface SectionSummary { id: SectionId; bad: number; off: number; chk: number; grey: number; greyIow: number; state: St }
/** Counts per section; with `train`, only that train's checks (and its overrides). */
export function summarize(checks: Check[], overrides: Override[], train?: TrainId): Record<SectionId, SectionSummary> {
  const ids: SectionId[] = ['feed', 'heat', 'rx', 'gas', 'sep', 'frac'];
  return Object.fromEntries(ids.map((id) => {
    const cs = checks.filter((c) => c.section === id && (!train || c.train === train));
    const greyParams = new Set(cs.filter((c) => c.state === 'grey').map((c) => c.paramId));
    const greyIow = [...greyParams].filter((p) => { const l = cs.find((c) => c.paramId === p)!.limit; return !!iowBand(l.iowStd) || !!iowBand(l.iowCrit); }).length;
    const ov = id === 'gas' ? overrides.filter((o) => (!train || o.train === train) && /C-?(12-)?[12]01|compressor/i.test(o.item)).length : 0;
    const s = { id, bad: cs.filter((c) => c.state === 'bad').length + ov, off: cs.filter((c) => c.state === 'off').length, chk: cs.filter((c) => c.state === 'chk').length, grey: greyParams.size, greyIow };
    const state: St = s.bad ? 'bad' : s.off ? 'off' : s.chk ? 'chk' : s.grey ? 'grey' : 'ok';
    return [id, { ...s, state }];
  })) as Record<SectionId, SectionSummary>;
}

// ── Events (trips, leaks) from the remarks, one per incident: remarks naming the same tag or the same time are one
export interface Incident { word: string; train: TrainId | null; time: string | null; tags: string[]; texts: string[] }
const timeOf = (t: string) => { const m = /\b(\d{1,2})[:.](\d{2})\b/.exec(t); return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null; };
const trainOfGroup = (g: string): TrainId | null => (/(train|tr)\s*-?\s*1\b/i.test(g) ? 'TR-1' : /(train|tr)\s*-?\s*2\b/i.test(g) ? 'TR-2' : null);
export function incidentsOf(log: StoredLog, controller: StoredLog | null): Incident[] {
  const evs = eventsIn([...log.sections, ...(controller?.sections ?? [])]).map((e) => ({ ...e, word: /^trip/i.test(e.word) ? 'Trip' : e.word, time: timeOf(e.text), tags: tagsIn(e.text), train: trainOfGroup(e.group) }));
  const groups: (typeof evs)[] = [];
  for (const e of evs) {
    const g = groups.find((x) => x.some((y) => y.word === e.word && ((e.time && y.time === e.time) || e.tags.some((t) => y.tags.includes(t)))));
    if (g) g.push(e); else groups.push([e]);
  }
  // a later remark can join two groups (one shares the time, the other the tag)
  for (let k = 0; k < groups.length; k++) for (let j = groups.length - 1; j > k; j--) {
    const a = groups[k], b = groups[j];
    if (a.some((x) => b.some((y) => x.word === y.word && ((x.time && x.time === y.time) || x.tags.some((t) => y.tags.includes(t)))))) { a.push(...b); groups.splice(j, 1); }
  }
  return groups.map((g) => ({ word: g[0].word, train: g.find((x) => x.train)?.train ?? null, time: g.find((x) => x.time)?.time ?? null, tags: [...new Set(g.flatMap((x) => x.tags))], texts: g.map((x) => x.text) }));
}

// ── Handover (spec §8): most serious first; one line per train, then common, then overrides
export interface HandoverLine { key: string; items: { st: St; text: string }[] }
const short = (c: Check) => `${c.label.replace(/\s*\(.*?\)\s*/g, ' ').trim()} ${c.value ?? ''}${c.unit && c.value ? ` ${c.unit}` : ''}`.trim();
export function handover(input: BoardInput, checks: Check[]): HandoverLine[] {
  const lines: HandoverLine[] = [];
  const ov = input.overrides.map((o) => ({ st: 'bad' as St, text: `${o.train} ${o.item}${o.reason ? ` (${o.reason})` : ''}${o.startedOn ? ` since ${o.startedOn.slice(8, 10)}/${o.startedOn.slice(5, 7)}` : ''} · ${o.expiresOn ? `expires ${o.expiresOn}` : 'expiry not set'}${o.moc ? '' : ', MOC not set'}` }));
  if (ov.length) lines.push({ key: 'Override', items: ov });
  const sev = (c: Check) => c.state === 'bad' || c.state === 'off';
  const both = new Set(checks.filter((c) => c.state === 'bad' && c.train === 'TR-1' && checks.some((d) => d.paramId === c.paramId && d.train === 'TR-2' && d.state === 'bad')).map((c) => c.paramId));
  if (both.size) lines.push({ key: 'Both', items: [...both].map((p) => { const c = checks.find((x) => x.paramId === p)!; return { st: 'bad' as St, text: `${short(c)} beyond IOW ${c.limit.iowStd ?? ''}${c.limit.action ? ` · ${c.limit.action}` : ''}` }; }) });
  const inc = incidentsOf(input.log, input.controller);
  for (const t of ['TR-1', 'TR-2', 'Common'] as TrainId[]) {
    const items: { st: St; text: string }[] = [];
    for (const e of inc.filter((x) => x.train === t)) items.push({ st: 'bad', text: `${e.word}: ${e.tags[0] ?? ''}${e.time ? ` ${e.time}` : ''} · ${e.texts[0]}` });
    for (const c of checks.filter((x) => x.train === t && sev(x) && !both.has(x.paramId)).sort((a, b) => RANK[a.state] - RANK[b.state])) items.push({ st: c.state, text: short(c) });
    for (const c of checks.filter((x) => x.train === t && x.state === 'chk')) items.push({ st: 'chk', text: `${c.label}: ${c.note ?? 'check'}` });
    if (items.length) lines.push({ key: t, items });
  }
  // an incident the remarks don't place on a train is shown on its own, never guessed onto one
  const loose = inc.filter((x) => !x.train);
  if (loose.length) lines.push({ key: 'Unit', items: loose.map((e) => ({ st: 'bad' as St, text: `${e.word}: ${e.tags[0] ?? ''}${e.time ? ` ${e.time}` : ''} · ${e.texts[0]}` })) });
  return lines;
}

/** The WhatsApp brief (spec §8 format): key facts only. */
export function whatsappText(log: StoredLog, lines: HandoverLine[]): string {
  const d = new Date(`${log.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const head = `*ARDS – Shift Handover ${log.shift ?? ''} ${d}*`;
  const pick = (k: string) => lines.find((l) => l.key === k);
  const one = (k: string, label: string) => { const l = pick(k); return `• ${label}: ${l ? l.items.slice(0, 2).map((x) => x.text).join('; ') : 'normal'}`; };
  const ov = pick('Override');
  return [head, one('TR-1', 'TR-1'), one('TR-2', 'TR-2'), ...(pick('Both') ? [one('Both', 'Both trains')] : []), one('Common', 'Common'), `• Overrides open: ${ov ? `${ov.items.length} – ${ov.items.map((x) => x.text.split(' (')[0]).join('; ')}` : '0'}`].join('\n');
}
