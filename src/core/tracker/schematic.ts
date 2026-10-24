// Auto-generated loop schematics. Built each time from what the records say — the loop (name, detail, items), its
// field procedure, the blind list and the P&ID line-up — never from guesses: a connection is drawn only when a record
// names both ends; anything a record does not give (line numbers, valve positions along the pipe, fill / drain points)
// is listed as unknown. Connections found in the line-up are "verified" (P&ID read) or "unchecked" (Train-2 lines
// generated from Train 1); the rest come from the loop record or procedure. People's corrections (trk_loop_fix) are
// applied on top and shown as theirs. The SVG is shown in the drawing viewer, labelled as not a verified P&ID.
// Drawing rules: .claude/skills/refinery-process-diagram/SKILL.md (mandatory for every generated process diagram).
import { luKeys, type LuStream, type TrkPoint, type TrkPointStep } from './index';

export type NodeKind = 'vessel' | 'reactor' | 'exchanger' | 'heater' | 'pump' | 'compressor' | 'column' | 'filter' | 'valve' | 'instrument' | 'pass' | 'junction' | 'item';
export type Basis = 'verified' | 'unchecked' | 'record' | 'user' | 'user_verified';
export type MarkKind = 'fill' | 'drain' | 'vent' | 'isolation' | 'blind' | 'before';
export type Role = 'active' | 'bypass' | 'standby' | 'injection';
export type ItemState = 'active' | 'standby' | 'closed' | 'open' | 'known' | 'unresolved';
export interface SNode { key: string; tag: string; kind: NodeKind; via: string[]; user?: string;
  /** set by a correction (trk_loop_node): a label, a state from a named source (valve closed per SOP step 2…) */ label?: string; state?: ItemState; stateSource?: string;
  /** a junction drawn for a point on a line: the item it stands for in the line-up (header of H-201 → H-201) */ matchAs?: string }
/** an item's correction (trk_loop_node) */
export interface LoopItem { id: string; pointId: string; tag: string; label: string | null; state: ItemState; source: string; status: 'active' | 'withdrawn'; by: string | null }
export interface SLink { key: string; a: string; b: string; basis: Basis; lines: string[]; sheets: string[]; source: string; user?: string;
  /** the side / nozzle named in the record at each end (T/S, S/S, O/L, I/L, vapour, inlet…) */ aSide?: string | null; bSide?: string | null;
  /** the line-up gives the opposite direction */ conflict?: string;
  /** the line-up's service when it says more than the route (e.g. a bypass) */ service?: string;
  /** set by a correction: active route, bypass, standby (isolated) branch, injection */ role?: Role }
export interface SMark { key: string; kind: MarkKind; text: string; source: string; user?: string; verifiedSheet?: string }
export type Verification = 'Verified' | 'Unverified' | 'Unknown';
export interface Schematic { ref: string; title: string; nodes: SNode[]; links: SLink[]; extra: string[]; marks: SMark[]; notes: string[]; unknown: string[]; sources: string[]; removed: number;
  /** diagram type (skill §3) */ type: 'Neutralization loop diagram';
  /** overall status (skill §17): Verified only when every connection is verified and nothing is unknown */ status: Verification;
  counts: { verified: number; unverified: number; unknown: number };
  /** generated-diagram revision: changes when the data behind it changes (not the source documents' revision) */ revision: string }
export interface LoopFix { id: string; pointId: string; op: 'remove' | 'add_link' | 'add_mark' | 'note'; target: string | null; a: string | null; b: string | null; line: string | null;
  kind: MarkKind | null; text: string | null; sheet: string | null; reason: string | null; status: 'active' | 'withdrawn'; by: string | null; at: string; role?: Role | null }

export const SCHEMATIC_LABEL = 'Auto-generated process schematic — Reference only — Not a verified P&ID';
export const GENERATOR_VERSION = 'schematic 2.0';

// ── tags in the records ────────────────────────────────────────────────────────────────────────────────────────
const EQ = /\b(EA|EJ|TK|[VEHRPCTF])-(?:12-)?(\d{3}[A-Z]?(?:\/(?:\d{3}|[A-Z]))*)(?![\d-])/g;
const VALVE = /\b(MOV|XV|KV|FV|LV|TV|PV|HV|SDV|NRV)-(\d{2,4}[A-Z]?(?:\/[A-Z])*)\b/g;
const PLANT = /\b12-[A-Z]{2}-\d{4}\b/g;
const SIDE = /^\s*(T\/S|S\/S|O\/L|I\/L|tube side|shell side|vapour|discharge|inlet|outlet|passes)\b/i;
/** the key a tag is matched on: E-12-229 → E-229 (the line-up form) */
export const tagKey = (t: string) => t.trim().toUpperCase().replace(/^([A-Z]{1,3})-12-(\d)/, '$1-$2');
const kindOf = (tag: string): NodeKind => {
  if (tag.startsWith('J:')) return 'junction';
  if (/^B\/V\b/.test(tag)) return 'valve';
  const p = tag.split('-')[0];
  if (/^(MOV|XV|KV|FV|LV|TV|PV|HV|SDV|NRV)$/.test(p)) return 'valve';
  if (/^(FT|FE|PT|TT|LT|PDT)/.test(p) || p.includes('/')) return 'instrument';
  return ({ V: 'vessel', TK: 'vessel', R: 'reactor', E: 'exchanger', EA: 'exchanger', H: 'heater', P: 'pump', C: 'compressor', T: 'column', F: 'filter' } as Record<string, NodeKind>)[p] ?? 'item';
};
/** equipment tags in a text, in order, with the side word after each ("E-202 T/S"); "V-206/207" gives both */
function tagsIn(text: string, valves = false): { tag: string; side: string | null; at: number }[] {
  const out: { tag: string; side: string | null; at: number }[] = [];
  const add = (tag: string, at: number, end: number) => { const m = text.slice(end).match(SIDE); out.push({ tag, side: m ? m[1].replace(/tube side/i, 'T/S').replace(/shell side/i, 'S/S') : null, at }); };
  for (const m of text.matchAll(EQ)) {
    const [first, ...rest] = m[2].split('/');
    const base = first.match(/^\d{3}/)![0];
    add(`${m[1]}-${first}`, m.index!, m.index! + m[0].length);
    for (const r of rest) if (/^\d{3}$/.test(r)) add(`${m[1]}-${r}`, m.index! + 1, m.index! + m[0].length);   // V-206/207
    if (rest.length && rest.every((r) => /^[A-Z]$/.test(r))) { out.pop(); add(`${m[1]}-${base}${first.slice(3)}/${rest.join('/')}`, m.index!, m.index! + m[0].length); }   // E-210A/B
  }
  if (valves) for (const m of text.matchAll(VALVE)) { const end = m.index! + m[0].length; const s = text.slice(end).match(SIDE); out.push({ tag: m[0], side: s ? s[1] : null, at: m.index! }); }
  for (const m of text.matchAll(PLANT)) out.push({ tag: m[0], side: null, at: m.index! });
  return out.sort((x, y) => x.at - y.at);
}
/** an instrument group named in the loop's title, e.g. "FT/FV-681…684" */
const groupIn = (text: string) => text.match(/\b[A-Z]{2,3}(?:\/[A-Z]{2,3})*-\d{3,4}(?:\s*(?:…|\.\.\.)\s*\d{3,4})?\b/)?.[0] ?? null;
/** a numbered range in a group (FT/FV-681…684 → the four passes 681, 682, 683, 684); null when not a short range */
const passesOf = (g: string) => { const m = g.match(/^(.+)-(\d{3,4})\s*(?:…|\.\.\.)\s*(\d{3,4})$/); if (!m) return null; const a = +m[2], b = +m[3];
  return b > a && b - a < 8 ? Array.from({ length: b - a + 1 }, (_, i) => `${m[1]}-${a + i}`) : null; };

// ── connections stated in the records ──────────────────────────────────────────────────────────────────────────
interface Raw { a: { tag: string; side: string | null }; b: { tag: string; side: string | null }; source: string }
function chains(text: string, source: string): Raw[] {
  const out: Raw[] = [];
  if (text.includes('→')) {
    const segs = text.split('→').map((x) => { const ts = tagsIn(x, true); return ts.length ? ts.filter((t) => t.at <= ts[0].at + 1) : []; });
    for (let i = 0; i + 1 < segs.length; i++) for (const a of segs[i]) for (const b of segs[i + 1]) out.push({ a, b, source });
    return out;
  }
  for (const m of text.matchAll(/ to /g)) {
    const left = text.slice(0, m.index!).split(/[,(:;]/).pop() ?? '';
    const right = text.slice(m.index! + 4);
    const as = tagsIn(left, true); const bs = tagsIn(right, true);
    if (!as.length || !bs.length || bs[0].at > 3) continue;
    const b = bs[0];
    const via: { tag: string; side: string | null }[] = [];
    const colon = right.slice(b.at).match(/^[^:,(]*:\s*(.*)$/);
    if (colon) via.push(...tagsIn(colon[1]));
    const thr = text.match(/through\s+(.*)$/i); if (thr) via.push(...tagsIn(thr[1]).slice(0, 1));
    for (const a of as) { let prev: { tag: string; side: string | null } = a; for (const v of via) { out.push({ a: prev, b: v, source }); prev = v; } out.push({ a: prev, b, source }); }
  }
  return out;
}

// ── field procedure: fill, drain, vent and boundary points (verbatim) ─────────────────────────────────────────
function marksOf(steps: TrkPointStep[]): SMark[] {
  const out: SMark[] = [];
  const split = (s: string) => s.split(/,\s*/).map((x) => x.trim().replace(/[.;]$/, '')).filter((x) => x.length > 1);
  for (const st of [...steps].sort((x, y) => x.seq - y.seq)) {
    const src = `Procedure step ${st.seq}${st.source && st.source !== 'Added on site' ? ` (${st.source})` : ''}`; const t = st.text;
    let found = false;
    for (const m of t.matchAll(/(soda ash|drain|overflow)\s+hoses?\s+on\s+(.+?)(?=[,;]\s*(?:soda ash|drain|overflow|N2)\s+hoses?\b|$)/gi)) {
      const kind: MarkKind = /soda/i.test(m[1]) ? 'fill' : /overflow/i.test(m[1]) ? 'vent' : 'drain';
      for (const x of split(m[2])) out.push({ key: `mark:${kind}:${x}`, kind, text: x, source: src }); found = true;
    }
    const clear = t.match(/clear soda ash at\s+(.+?)(?::|\s*,\s*(?:each|vents?|drains?|filling)\b|$)/i);
    if (clear) { for (const x of split(clear[1])) out.push({ key: `mark:vent:${x}`, kind: 'vent', text: `Clear soda ash at ${x}`, source: src }); found = true; }
    const dx = t.match(/drained to DX(?: from|:)\s*(.+)$/i);
    if (dx) { for (const x of split(dx[1])) out.push({ key: `mark:drain:${x}`, kind: 'drain', text: `${x} (to DX before filling)`, source: src }); found = true; }
    if (!found && st.phase === 'before' && /\b(closed|isolated|blinds?|B\/M|dropped|removed|wedge)\b/i.test(t)) out.push({ key: `mark:isolation:${t}`, kind: 'isolation', text: t, source: src });
    else if (!found && st.phase !== 'after') out.push({ key: `mark:before:${t}`, kind: 'before', text: st.phase === 'fill' ? `While filling: ${t}` : t, source: src });
  }
  return out;
}

/** one item under two names: E-210 ~ E-210A/B, P-203 ~ P-203A/B; never P-103A ~ P-103B */
const own = (x: string) => { const k = luKeys(x); return k.length > 1 ? k.slice(1) : k; };
const same = (x: string, y: string) => own(x).some((k) => luKeys(y).includes(k)) || own(y).some((k) => luKeys(x).includes(k));
/** one connection per pair; the sides named in any of the records that give it are kept */
const dedupe = (ls: SLink[]) => { const by = new Map<string, SLink>(); for (const l of ls) { const o = by.get(l.key); if (!o) by.set(l.key, { ...l }); else { o.aSide ??= l.aSide; o.bSide ??= l.bSide; } } return [...by.values()]; };
const uniq = <T>(xs: T[], k: (x: T) => string) => { const s = new Set<string>(); return xs.filter((x) => (s.has(k(x)) ? false : (s.add(k(x)), true))); };

/** The schematic of one loop from the records, with people's corrections applied. */
export function buildSchematic(p: Pick<TrkPoint, 'id' | 'ref' | 'name' | 'detail' | 'items' | 'requires' | 'method'>, d: { points?: Pick<TrkPoint, 'kind' | 'ref' | 'name'>[]; steps?: TrkPointStep[]; lineup?: LuStream[]; fixes?: LoopFix[]; items?: LoopItem[] }): Schematic {
  const steps = (d.steps ?? []).filter((s) => s.pointId === p.id); const lu = d.lineup ?? [];
  const fixes = (d.fixes ?? []).filter((f) => f.pointId === p.id && f.status === 'active');
  const sources = ['Loop record'];
  // connections: the loop's name, detail and items; the fill steps only when those give none
  let raw = [...chains(p.name, 'Loop name'), ...(p.detail ? chains(p.detail, 'Loop detail') : []), ...p.items.flatMap((i) => chains(i, 'Loop items'))];
  let fromFill = false;
  if (!raw.length) { raw = steps.filter((s) => s.phase === 'fill').flatMap((s) => chains(s.text, `Procedure step ${s.seq}`)); fromFill = raw.length > 0; }
  if (steps.length) sources.push(`Field procedure (${steps.length} steps)`);
  // the loop's own instruments (FT/FV-681…684) sit on the lines into the item the fill reaches ("… to H-201 inlet")
  const group = groupIn(p.name); const nodes = new Map<string, SNode>();
  // a junction (J:…) or a descriptive name ("Injection water manifold") keeps its spelling; tags are matched in line-up form
  const node = (tag: string, side: string | null, user?: string) => { const k = tag.startsWith('J:') ? tag.trim() : tagKey(tag); const shown = tag.startsWith('J:') || /\s/.test(tag.trim()) ? tag.trim() : tagKey(tag);
    const n = nodes.get(k) ?? { key: k, tag: shown, kind: kindOf(shown), via: [], user };
    if (side && !n.via.includes(side)) n.via.push(side); nodes.set(k, n); return k; };
  let links: SLink[] = [];
  const ends = (r: Raw) => [node(r.a.tag, r.a.side), node(r.b.tag, r.b.side)] as const;
  for (const r of raw) { const [a, b] = ends(r); if (a !== b) links.push({ key: `link:${a}>${b}`, a, b, basis: 'record', lines: [], sheets: [], source: r.source, aSide: r.a.side, bSide: r.b.side }); }
  // the loop's own instruments (FT/FV-681…684) are on the feed lines into the item the fill reaches. A numbered range
  // is one pass each (skill §5.7: passes are not merged); where the feed splits into the passes is not recorded, so
  // the split is drawn as an unresolved junction.
  const passNotes: string[] = [];
  if (group && fromFill && !nodes.has(tagKey(group))) {
    const into = [...new Set(raw.filter((r) => /inlet|passes/i.test(r.b.side ?? '')).map((r) => tagKey(r.b.tag)))];
    const passes = passesOf(group);
    if (into.length === 1 && passes) {
      const t = into[0], j = 'J:split';
      nodes.set(j, { key: j, tag: 'Split not recorded', kind: 'junction', via: [] });
      links = links.flatMap((l) => (l.b === t ? [{ ...l, b: j, key: `link:${l.a}>${j}`, bSide: null }] : [l]));
      passes.forEach((ps, i) => { const k = node(ps, null); nodes.get(k)!.kind = 'pass';
        links.push({ key: `link:${j}>${k}`, a: j, b: k, basis: 'record', lines: [], sheets: [], source: 'Loop name (one pass per instrument number)' },
          { key: `link:${k}>${t}`, a: k, b: t, basis: 'record', lines: [], sheets: [], source: 'Loop name / fill step', bSide: `pass ${i + 1} inlet` }); });
      passNotes.push(`${group}: one pass per number (${passes.length} passes) into ${t}; where the common feed splits into the passes, and the order of the instruments on each pass, are not recorded.`);
    } else if (into.length) { const g = node(group, 'feed lines'); nodes.get(g)!.kind = 'instrument';
      links = links.flatMap((l) => (into.includes(l.b) ? [{ ...l, b: g, key: `link:${l.a}>${g}` }] : [l]));
      for (const t of into) links.push({ key: `link:${g}>${t}`, a: g, b: t, basis: 'record', lines: [], sheets: [], source: 'Loop name (instruments on the feed lines)', bSide: 'inlet' }); }
  }
  links = dedupe(links);
  // a direct connection that the records also give through other items is the same route: keep the longer one
  const reach = (a: string, b: string, skip: string) => { const seen = new Set([a]); const q = [a];
    while (q.length) { const x = q.shift()!; for (const l of links) if (l.a === x && l.key !== skip && !seen.has(l.b)) { if (l.b === b) return true; seen.add(l.b); q.push(l.b); } } return false; };
  links = links.filter((l) => !reach(l.a, l.b, l.key));
  // the same item named two ways (E-210 and E-210A/B): one item, the more specific name
  for (const k of [...nodes.keys()]) { const more = [...nodes.keys()].filter((o) => o !== k && luKeys(o)[0] === k && luKeys(o).length > 1);
    if (more.length !== 1) continue; const into = nodes.get(more[0])!; for (const v of nodes.get(k)!.via) if (!into.via.includes(v)) into.via.push(v);
    nodes.delete(k); links = links.map((l) => { const a2 = l.a === k ? into.key : l.a, b2 = l.b === k ? into.key : l.b; return { ...l, a: a2, b: b2, key: `link:${a2}>${b2}` }; }).filter((l) => l.a !== l.b); }
  links = dedupe(links);
  // the loop's items when no connection is stated; otherwise listed apart (place on the route not recorded)
  const itemTags = p.items.flatMap((i) => tagsIn(i, true).map((t) => t.tag)).concat(p.items.length ? [] : tagsIn(`${p.name} ${p.detail ?? ''}`).map((t) => t.tag));
  const extra: string[] = [];
  for (const t of uniq(itemTags, tagKey)) { if (nodes.has(tagKey(t)) || nodes.has(luKeys(tagKey(t))[0]) || [...nodes.keys()].some((k) => luKeys(k).includes(tagKey(t)))) continue; if (!links.length) node(t, null); else extra.push(tagKey(t)); }
  for (const i of p.items) if (!tagsIn(i, true).length && !extra.includes(i)) extra.push(i);
  // corrections to the route come first, so a connection a person adds is checked against the line-up like any other
  let removed = 0;
  for (const f of fixes) {
    if (f.op === 'remove' && f.target && !f.target.startsWith('mark:')) {
      const n0 = nodes.size + links.length;
      if (f.target.startsWith('node:')) { const k = f.target.slice(5); nodes.delete(k); links = links.filter((l) => l.a !== k && l.b !== k); }
      links = links.filter((l) => l.key !== f.target);
      removed += n0 - (nodes.size + links.length);
    }
    if (f.op === 'add_link' && f.a && f.b) {
      const a = node(f.a, null, f.by ?? 'user'), b = node(f.b, null, f.by ?? 'user');
      const was = links.find((l) => l.a === a && l.b === b);   // a correction of a generated link keeps the sides it named
      links = links.filter((l) => l !== was);
      links.push({ key: `link:${a}>${b}`, a, b, basis: f.sheet ? 'user_verified' : 'user', lines: f.line ? [f.line] : [], sheets: f.sheet ? [f.sheet] : [], source: `Correction by ${f.by ?? 'user'}`, user: f.by ?? 'user', role: f.role ?? undefined, aSide: was?.aSide, bSide: was?.bSide });
    }
  }
  // items with a stated state or label (trk_loop_node): a valve closed per the SOP, a standby pump, a header
  const itemFixes = (d.items ?? []).filter((x) => x.pointId === p.id && x.status === 'active');
  for (const it of itemFixes) { const k = node(it.tag, null); const n = nodes.get(k)!;
    n.label = it.label ?? undefined; n.state = it.state; n.stateSource = it.source;
    if (n.kind === 'junction') { const first = tagsIn(it.label ?? '')[0]; n.matchAs = first && first.at === 0 ? first.tag : undefined; } }   // "H-201 inlet header" stands for H-201
  if (itemFixes.length) sources.push(`Item corrections (${itemFixes.length})`);
  // line-up: line numbers and how far each connection is checked
  let luHits = 0;
  for (const l of links) {
    // a junction is a point on a line: it is matched as the item it stands for, or else through the items on either side
    const endsOf = (k: string, from: boolean): string[] => { const n = nodes.get(k); if (n?.kind !== 'junction') return [k]; if (n.matchAs) return [n.matchAs];
      return links.filter((o) => (from ? o.b === k : o.a === k)).map((o) => (from ? o.a : o.b)).filter((x) => nodes.get(x)?.kind !== 'junction'); };
    const A = endsOf(l.a, true), B = endsOf(l.b, false);
    const ss = lu.filter((s) => A.some((x) => same(s.from, x)) && B.some((y) => same(s.to, y)));
    const back = lu.filter((s) => B.some((y) => same(s.from, y)) && A.some((x) => same(s.to, x)));
    if (!ss.length && back.length && l.basis === 'record') l.conflict = `The loop record gives ${l.a} → ${l.b}; the P&ID line-up gives ${l.b} → ${l.a} (${[...new Set(back.flatMap((s) => s.lineNos))].join(', ') || 'no line no.'}). Shown as recorded: direction to be checked.`;
    if (!ss.length) continue; luHits++;
    const lb: Basis = ss.some((s) => s.conf === 'ok') ? 'verified' : 'unchecked';
    if (!(l.basis === 'user_verified' && lb !== 'verified')) l.basis = lb;   // a person's sheet check stands over an unchecked line-up entry
    l.lines = [...new Set([...l.lines, ...ss.flatMap((s) => s.lineNos)])]; l.sheets = [...new Set([...l.sheets, ...ss.flatMap((s) => s.sheets)])];
    l.source = l.user ? `Correction by ${l.user} · P&ID line-up` : 'P&ID line-up';
    const svc = ss.map((s) => s.fluid ?? '').find((f) => /bypass/i.test(f)); if (svc) l.service = svc;
  }
  if (luHits) sources.push(`P&ID line-up (${luHits} connection${luHits > 1 ? 's' : ''})`);
  // fill / drain / vent / boundary points
  let marks = marksOf(steps);
  const blinds = (p.requires ?? []).map((r) => { const b = (d.points ?? []).find((x) => x.kind === 'blind' && x.ref === r); return { key: `mark:blind:${r}`, kind: 'blind' as const, text: `${r}${b?.name ? ` · ${b.name}` : ''}`, source: 'Blind list' }; });
  if (blinds.length) sources.push(`Blind list (${blinds.length})`);
  marks = uniq([...blinds, ...marks], (m) => m.key);
  const notes = steps.filter((s) => s.phase === 'after').map((s) => s.text);
  // corrections to the points and notes
  for (const f of fixes) {
    if (f.op === 'remove' && f.target && f.target.startsWith('mark:')) { const n0 = marks.length; marks = marks.filter((m) => m.key !== f.target); removed += n0 - marks.length; }
    if (f.op === 'add_mark' && f.kind && f.text) marks.push({ key: `fix:${f.id}`, kind: f.kind, text: f.text, source: `Correction by ${f.by ?? 'user'}`, user: f.by ?? 'user', verifiedSheet: f.sheet ?? undefined });
    if (f.op === 'note' && f.text) notes.push(`${f.text} (${f.by ?? 'user'})`);
  }
  if (fixes.length) sources.push(`Corrections (${fixes.length})`);
  // what the records do not give
  const unknown: string[] = [];
  const nolu = links.filter((l) => l.basis === 'record');
  if (!nodes.size) unknown.push('No equipment is named in the loop record: the route is not known.');
  else if (!links.length) unknown.push('The route between the items is not recorded: items are shown without connections.');
  const tagOf = (k: string) => (nodes.get(k)?.kind === 'junction' ? 'the split' : nodes.get(k)?.tag ?? k);
  if (nolu.length) unknown.push(`Line numbers not in the P&ID line-up (left off the drawing) for: ${nolu.map((l) => `${tagOf(l.a)} → ${tagOf(l.b)}`).join(', ')}.`);
  if (links.some((l) => l.basis === 'unchecked')) unknown.push('Some line-up connections are Train-2 lines generated from Train 1 and not yet checked on the Train-2 sheet.');
  if (!steps.length) unknown.push('No field procedure is recorded: fill, drain, vent and isolation points are not known.');
  else {
    if (!marks.some((m) => m.kind === 'fill')) unknown.push('Fill (soda ash in) points are not recorded in the procedure.');
    if (!marks.some((m) => m.kind === 'drain' || m.kind === 'vent')) unknown.push('Drain / vent points are not recorded in the procedure.');
  }
  if (!blinds.length) unknown.push('No boundary blinds are linked to this loop.');
  if (marks.some((m) => m.kind !== 'before')) unknown.push('Where each valve, blind, fill and drain point sits along the pipe is not recorded: they are listed beside the route, not drawn on it.');
  if (extra.length) unknown.push('Items listed under "Also in this loop" have no recorded place on the route.');
  unknown.unshift(...passNotes, ...links.filter((l) => l.conflict).map((l) => `Source conflict — ${l.conflict}`));
  const ex = [...nodes.values()].filter((n) => n.kind === 'exchanger' && n.via.includes('T/S') && n.via.includes('S/S'));
  for (const n of ex) unknown.push(`${n.tag}: both tube and shell sides are named in this loop; the circuits are separate and are not joined through the exchanger.`);
  const verified = links.filter((l) => l.basis === 'verified' || l.basis === 'user_verified').length;
  const counts = { verified, unverified: links.length - verified, unknown: unknown.length };
  const status: Verification = !nodes.size ? 'Unknown' : verified === links.length && links.length > 0 && !unknown.length ? 'Verified' : 'Unverified';
  const model = { nodes: [...nodes.values()], links, extra, marks, notes };
  return { ref: p.ref, title: p.name, ...model, unknown, sources, removed, type: 'Neutralization loop diagram', status, counts, revision: hash(JSON.stringify(model) + GENERATOR_VERSION) };
}
/** short stable hash (FNV-1a) for the generated-diagram revision */
function hash(x: string) { let h = 0x811c9dc5; for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

// ── drawing (SVG) ──────────────────────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wrap = (s: string, chars: number) => { const out: string[] = []; let cur = '';
  for (const w of s.split(/\s+/)) { if ((cur + ' ' + w).trim().length > chars && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur); return out; };
export const LINK_STYLE: Record<Basis, { color: string; dash: string; width: number; label: string; level: Verification }> = {
  verified: { color: '#0f172a', dash: '', width: 2.8, label: 'Verified — in the P&ID line-up, sheet read', level: 'Verified' },
  user_verified: { color: '#6d28d9', dash: '', width: 2.8, label: 'Verified by a person on the P&ID sheet named', level: 'Verified' },
  unchecked: { color: '#b45309', dash: '12 5', width: 2.4, label: 'Unverified — line-up, Train-2 generated from Train 1', level: 'Unverified' },
  record: { color: '#475569', dash: '3 4', width: 2.2, label: 'Unverified — loop record / procedure only, line not in line-up', level: 'Unverified' },
  user: { color: '#6d28d9', dash: '9 3 2 3', width: 2.2, label: 'Unverified — added by a person, not checked on a P&ID', level: 'Unverified' },
};
/** a connection's role, when a correction gives one: colour and weight (the line pattern still shows verification) */
export const ROLE_STYLE: Record<Role, { color: string; width: number; label: string; tag: string }> = {
  active: { color: '#0f172a', width: 4, label: 'Active flow path', tag: '' },
  bypass: { color: '#1d4ed8', width: 2.2, label: 'Bypass branch', tag: 'bypass' },
  standby: { color: '#94a3b8', width: 1.8, label: 'Standby / isolated branch (not part of the active loop)', tag: 'standby — isolated' },
  injection: { color: '#0e7490', width: 2.2, label: 'Injection water', tag: 'injection water' },
};
const MARK_STYLE: Record<MarkKind, { color: string; title: string }> = {
  before: { color: '#334155', title: 'Procedure steps (before / while filling)' },
  blind: { color: '#b91c1c', title: 'Boundary blinds (blind list)' },
  isolation: { color: '#b91c1c', title: 'Isolation / boundary (procedure) — status as written, not a valve-position instruction' },
  fill: { color: '#15803d', title: 'Fill / injection points — soda ash in' },
  vent: { color: '#0e7490', title: 'Vent / overflow / clear soda ash check' },
  drain: { color: '#1d4ed8', title: 'Drain points' },
};
function symbol(k: NodeKind, cx: number, y: number, stroke: string, filled = false): string {
  const s = `fill="${filled ? stroke : '#fff'}" stroke="${stroke}" stroke-width="2"`;
  switch (k) {
    case 'vessel': return `<rect x="${cx - 18}" y="${y}" width="36" height="52" rx="16" ${s}/>`;
    case 'reactor': return `<rect x="${cx - 20}" y="${y}" width="40" height="52" rx="18" ${s}/><line x1="${cx - 20}" y1="${y + 26}" x2="${cx + 20}" y2="${y + 26}" stroke="${stroke}" stroke-dasharray="3 3"/>`;
    case 'column': return `<rect x="${cx - 14}" y="${y - 2}" width="28" height="56" rx="12" ${s}/>`;
    case 'exchanger': return `<circle cx="${cx}" cy="${y + 26}" r="22" ${s}/><polyline points="${cx - 22},${y + 26} ${cx - 8},${y + 14} ${cx + 8},${y + 38} ${cx + 22},${y + 26}" fill="none" stroke="${stroke}" stroke-width="1.6"/>`;
    case 'heater': return `<rect x="${cx - 28}" y="${y + 6}" width="56" height="46" ${s}/><rect x="${cx - 7}" y="${y - 4}" width="14" height="10" ${s}/><polyline points="${cx - 20},${y + 44} ${cx - 20},${y + 16} ${cx - 8},${y + 44} ${cx - 8},${y + 16} ${cx + 4},${y + 44} ${cx + 4},${y + 16} ${cx + 16},${y + 44} ${cx + 16},${y + 16}" fill="none" stroke="${stroke}" stroke-width="1.4"/>`;
    case 'pump': return `<circle cx="${cx}" cy="${y + 28}" r="18" ${s}/><rect x="${cx}" y="${y + 6}" width="22" height="8" ${s}/><polygon points="${cx - 16},${y + 52} ${cx + 16},${y + 52} ${cx},${y + 40}" fill="${stroke}"/>`;
    case 'compressor': return `<polygon points="${cx - 22},${y + 6} ${cx + 22},${y + 16} ${cx + 22},${y + 40} ${cx - 22},${y + 50}" ${s}/>`;
    case 'filter': return `<rect x="${cx - 16}" y="${y + 4}" width="32" height="46" rx="6" ${s}/><line x1="${cx - 16}" y1="${y + 46}" x2="${cx + 16}" y2="${y + 8}" stroke="${stroke}" stroke-dasharray="3 3"/>`;
    case 'valve': return `<polygon points="${cx - 18},${y + 24} ${cx - 18},${y + 44} ${cx},${y + 34} ${cx + 18},${y + 24} ${cx + 18},${y + 44} ${cx},${y + 34}" ${s}/><line x1="${cx}" y1="${y + 34}" x2="${cx}" y2="${y + 14}" stroke="${stroke}" stroke-width="2"/><path d="M ${cx - 12} ${y + 14} A 12 10 0 0 1 ${cx + 12} ${y + 14} Z" ${s}/>`;
    case 'instrument': return `<circle cx="${cx - 14}" cy="${y + 26}" r="15" ${s}/><circle cx="${cx + 14}" cy="${y + 26}" r="15" ${s}/><line x1="${cx - 29}" y1="${y + 26}" x2="${cx + 29}" y2="${y + 26}" stroke="${stroke}" stroke-width="1.2"/>`;
    // one pass: control valve with an instrument bubble (FT); their order on the pass is not recorded
    case 'pass': return `<polygon points="${cx - 22},${y + 20} ${cx - 22},${y + 34} ${cx - 10},${y + 27} ${cx + 2},${y + 20} ${cx + 2},${y + 34} ${cx - 10},${y + 27}" ${s}/><line x1="${cx - 10}" y1="${y + 27}" x2="${cx - 10}" y2="${y + 13}" stroke="${stroke}" stroke-width="1.6"/><path d="M ${cx - 18} ${y + 13} A 8 7 0 0 1 ${cx - 2} ${y + 13} Z" ${s}/><circle cx="${cx + 16}" cy="${y + 27}" r="10" ${s}/>`;
    case 'junction': return `<circle cx="${cx}" cy="${y + 26}" r="7" fill="#fff" stroke="#b45309" stroke-width="2" stroke-dasharray="3 2"/><text x="${cx}" y="${y + 30}" text-anchor="middle" font-size="10" font-weight="800" fill="#b45309">?</text>`;
    default: return `<rect x="${cx - 34}" y="${y + 10}" width="68" height="34" rx="6" ${s}/>`;
  }
}
function markIcon(k: MarkKind, x: number, y: number, c: string): string {
  switch (k) {
    case 'before': return `<circle cx="${x + 9}" cy="${y}" r="4" fill="${c}"/>`;
    case 'blind': return `<circle cx="${x + 5}" cy="${y}" r="5" fill="none" stroke="${c}" stroke-width="2"/><line x1="${x + 10}" y1="${y}" x2="${x + 13}" y2="${y}" stroke="${c}" stroke-width="2"/><circle cx="${x + 18}" cy="${y}" r="5" fill="${c}"/>`;
    case 'isolation': return `<polygon points="${x},${y - 6} ${x},${y + 6} ${x + 9},${y} ${x + 18},${y - 6} ${x + 18},${y + 6} ${x + 9},${y}" fill="${c}"/>`;
    case 'fill': return `<polygon points="${x + 9},${y + 7} ${x + 1},${y - 5} ${x + 17},${y - 5}" fill="${c}"/>`;
    case 'vent': return `<polygon points="${x + 9},${y - 7} ${x + 1},${y + 5} ${x + 17},${y + 5}" fill="none" stroke="${c}" stroke-width="2"/>`;
    default: return `<path d="M ${x + 9} ${y - 7} C ${x + 15} ${y}, ${x + 15} ${y + 7}, ${x + 9} ${y + 7} C ${x + 3} ${y + 7}, ${x + 3} ${y}, ${x + 9} ${y - 7} Z" fill="${c}"/>`;
  }
}

/** half width of a symbol (where pipes meet it) */
/** confidence order: a shared segment is drawn in the weakest style on it */
const RANK: Record<Basis, number> = { record: 0, user: 1, unchecked: 2, user_verified: 3, verified: 4 };
const HW: Record<NodeKind, number> = { vessel: 18, reactor: 20, column: 14, exchanger: 22, heater: 28, pump: 18, compressor: 22, filter: 16, valve: 18, instrument: 29, pass: 26, junction: 7, item: 34 };
type Box = { x: number; y: number; w: number; h: number };
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Topology checks before drawing (skill §21): returns the problems found. */
export function schematicCheck(s: Schematic): string[] {
  const out: string[] = []; const keys = new Set(s.nodes.map((n) => n.key));
  for (const l of s.links) if (!keys.has(l.a) || !keys.has(l.b)) out.push(`connection ${l.a} → ${l.b} has a missing end`);
  const tags = s.nodes.map((n) => n.tag); for (const t of new Set(tags)) if (tags.filter((x) => x === t).length > 1) out.push(`${t} appears twice`);
  if (s.links.length) for (const n of s.nodes) if (!s.links.some((l) => l.a === n.key || l.b === n.key)) out.push(`${n.tag} is not connected`);
  if (s.status === 'Verified' && s.unknown.length) out.push('marked verified with unknowns');
  return out;
}

/** The schematic as an SVG sheet (white, left-to-right, readable when fitted to a phone and zoomed) and the
 *  automatic quality check (topology + drawing: overlapping labels, clipped text). */
export interface SchematicInfo { sections: { title: string; lines: { text: string; sub?: string }[] }[]; meta: [string, string][] }
export function renderSchematic(s: Schematic, generatedAt: string, opts: { compact?: boolean } = {}): { svg: string; issues: string[]; info: SchematicInfo } {
  const issues = schematicCheck(s); const compact = !!opts.compact;
  const COLW = 210, ROWH = 150;
  // columns: longest path from the starts (left = where the records start the flow); several items in one column stack
  const col = new Map<string, number>(s.nodes.map((n) => [n.key, 0]));
  for (let i = 0; i < s.nodes.length; i++) for (const l of s.links) { const c = (col.get(l.a) ?? 0) + 1; if (c > (col.get(l.b) ?? 0) && c < s.nodes.length) col.set(l.b, c); }
  // with roles set (a corrected topology), a branch that starts on its own sits next to where it joins, not at the far left
  const roles = s.links.some((l) => l.role);
  // (as late as possible: every item moves right up to one column before the first item it feeds)
  if (roles) for (let i = 0; i < s.nodes.length; i++) for (const n of s.nodes) {
    const next = s.links.filter((l) => l.a === n.key).map((l) => col.get(l.b)!); if (next.length) col.set(n.key, Math.max(col.get(n.key)!, Math.min(...next) - 1)); }
  const cols = Math.max(1, ...[...col.values()].map((c) => c + 1));
  const byCol: string[][] = Array.from({ length: cols }, () => []);
  const onActive = (k: string) => s.links.some((l) => l.role === 'active' && (l.a === k || l.b === k));
  for (const n of [...s.nodes].sort((x, y) => (roles ? Number(onActive(y.key)) - Number(onActive(x.key)) : 0))) byCol[col.get(n.key) ?? 0].push(n.key);
  const rows = Math.max(1, ...byCol.map((c) => c.length));
  const W = Math.max(860, 60 + cols * COLW), X0 = (W - (cols - 1) * COLW) / 2, CH = (W - 48) / 6.2;
  const head = wrap(`${s.ref} · ${s.title}`, Math.floor((W - 48) / 10.5));
  const TOP = 110 + head.length * 22;
  const pos = new Map<string, { x: number; y: number }>();
  // with roles: rows from the top, the active route first; each branch off it (standby, injection) is placed below
  // every active item in the columns it spans, so no branch sits on the active route's lines
  const rowOf = new Map<string, number>();
  if (roles) {
    const act = s.nodes.filter((n) => onActive(n.key)), used = new Map<number, number>();
    for (const n of act) { const c = col.get(n.key)!; rowOf.set(n.key, used.get(c) ?? 0); used.set(c, (used.get(c) ?? 0) + 1); }
    const rest = s.nodes.filter((n) => !onActive(n.key)); const seen = new Set<string>();
    for (const n of rest) { if (seen.has(n.key)) continue;
      const comp: string[] = [n.key]; seen.add(n.key);   // the branch: items joined by non-active connections
      for (let i = 0; i < comp.length; i++) for (const l of s.links) for (const [x, y] of [[l.a, l.b], [l.b, l.a]]) if (x === comp[i] && !onActive(y) && !seen.has(y)) { seen.add(y); comp.push(y); }
      const cs = comp.map((k) => col.get(k)!); const lo = Math.min(...cs), hi = Math.max(...cs);
      const base = Math.max(0, ...Array.from({ length: hi - lo + 1 }, (_, i) => used.get(lo + i) ?? 0));
      const inCol = new Map<number, number>();
      for (const k of comp) { const c = col.get(k)!; const r = base + (inCol.get(c) ?? 0); inCol.set(c, (inCol.get(c) ?? 0) + 1); rowOf.set(k, r); }
      for (const [c, k] of inCol) used.set(c, Math.max(used.get(c) ?? 0, base + k));   // a later branch goes below this one
      for (let c = lo; c <= hi; c++) used.set(c, Math.max(used.get(c) ?? 0, base + Math.max(...inCol.values())));
    }
  }
  const rowsR = roles ? Math.max(1, ...[...rowOf.values()].map((r) => r + 1)) : rows;
  const rowIdx = (k: string, c: number) => (roles ? rowOf.get(k)! : byCol[c].indexOf(k) + (rows - byCol[c].length) / 2);
  // compact: every column as wide as its widest item plus the gap its pipe labels need; every row as tall as its
  // tallest item; the margins fitted to the drawing (fixed 210 × 150 grid otherwise)
  const nodeW = (n: SNode) => n.kind === 'junction' ? (n.state === 'known' ? 120 : 118) : Math.max(2 * HW[n.kind] + 10, n.tag.length * 8.2,
    n.state === 'closed' || n.state === 'standby' || n.state === 'open' ? (n.state === 'standby' ? 20 : 8) * 5.4 + (n.stateSource?.length ?? 0) * 5.4 : 0, (n.label?.length ?? 0) * 5.2);
  // height down to the last text line under the symbol: tag +72, via +86, state +98, label +110
  const nodeH = (n: SNode) => { if (n.kind === 'junction') return 70; const st = n.state === 'closed' || n.state === 'standby' || n.state === 'open';
    return n.label ? 114 : st ? 102 : n.via.some((v) => !/inlet|feed lines/i.test(v)) ? 90 : 78; };
  const xs: number[] = [], rowY: number[] = [];
  let TOPc = TOP, Wc = W;
  if (compact) {
    const labelOf = (l: SLink) => [l.lines.slice(0, 2).join(', '), l.role === 'bypass' ? 'bypass' : '', l.conflict ? '⚠ direction conflict' : ''].filter(Boolean).join(' · ');
    const w = byCol.map((ks) => Math.max(60, ...ks.map((k) => nodeW(s.nodes.find((n) => n.key === k)!))));
    const gap = byCol.map((_, c) => { const out = s.links.filter((l) => col.get(l.a) === c && col.get(l.b) === c + 1);
      const into = new Map<string, number>(); for (const l of s.links.filter((x) => col.get(x.a) === c)) into.set(l.b, (into.get(l.b) ?? 0) + 1);
      return Math.max(56, ...out.map((l) => labelOf(l).length * 6 + 24), 40 + 16 * [...into.values()].filter((v) => v > 1).length); });
    let x = 24; byCol.forEach((_, c) => { x += w[c] / 2; xs[c] = x; x += w[c] / 2 + gap[c]; });
    const skipsN = s.links.filter((l) => { const a = col.get(l.a)!, b = col.get(l.b)!; return b - a > 1 && s.nodes.some((o) => col.get(o.key)! > a && col.get(o.key)! < b); }).length;
    TOPc = 88 + head.length * 22 - 22 + (skipsN ? 30 + skipsN * 10 : 14);
    const nRows = roles ? rowsR : rows; const rh = Array.from({ length: Math.ceil(nRows) + 1 }, (): number => (roles ? 70 : 0));
    for (const n of s.nodes) { const c = col.get(n.key)!; const r = Math.floor(rowIdx(n.key, c)); rh[r] = Math.max(rh[r], nodeH(n) + 12); }
    if (!roles) rh.fill(Math.max(...rh));
    let yy = TOPc; rh.forEach((h, r) => { rowY[r] = yy; yy += h; });
    Wc = Math.max(x - (gap[cols - 1] ?? 0) + 24, head[0].length * 10.5 + 48, 700);
  }
  const yOf = (rf: number) => { if (!compact) return TOP + rf * ROWH; const r = Math.floor(rf), f = rf - r; return rowY[r] + f * ((rowY[r + 1] ?? rowY[r] + 100) - rowY[r]); };
  byCol.forEach((ks, c) => ks.forEach((k) => pos.set(k, { x: compact ? xs[c] : X0 + c * COLW, y: yOf(rowIdx(k, c)) })));
  const node = new Map(s.nodes.map((n) => [n.key, n]));
  const parts: string[] = []; const boxes: Box[] = [];
  const t = (x: number, y: number, txt: string, o = '') => `<text x="${x}" y="${y}" ${o}>${esc(txt)}</text>`;
  const banner = SCHEMATIC_LABEL.toUpperCase(); const WW = compact ? Wc : W;
  parts.push(`<rect x="0" y="0" width="${WW}" height="32" fill="#b91c1c"/>`, t(WW / 2, 21, banner, 'text-anchor="middle" fill="#fff" font-size="13.5" font-weight="800" letter-spacing="0.4"'));
  head.forEach((h, i) => parts.push(t(24, 62 + i * 22, h, 'font-size="18" font-weight="800" fill="#0f172a"')));
  parts.push(t(24, 62 + head.length * 22, `${s.type} · Status: ${s.status} · Rev auto-${s.revision} · ${generatedAt}`, 'font-size="11" fill="#475569"'));
  parts.push(`<defs>${[...Object.entries(LINK_STYLE), ...Object.entries(ROLE_STYLE).map(([k, v]) => [`r-${k}`, v] as const)].map(([k, v]) => `<marker id="ar-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${v.color}"/></marker>`).join('')}</defs>`);
  // a link's look: its role's colour and weight when it has one, its verification's pattern always
  const look = (l: SLink) => { const st = LINK_STYLE[l.basis]; const r = l.role ? ROLE_STYLE[l.role] : null;
    return { color: r?.color ?? st.color, width: r?.width ?? st.width, dash: st.dash, marker: r ? `r-${l.role}` : l.basis }; };
  // item boxes (symbol + tag) first, so labels can avoid them
  for (const n of s.nodes) { const p = pos.get(n.key)!;
    if (compact) { const tw = Math.max(HW[n.kind], n.tag.length * 4.2);   // the symbol, and the text under it, as two boxes
      boxes.push({ x: p.x - HW[n.kind] - 4, y: p.y - 6, w: 2 * HW[n.kind] + 8, h: 62 }, { x: p.x - tw, y: p.y + 58, w: 2 * tw, h: nodeH(n) - 56 }); }
    else boxes.push({ x: p.x - Math.max(HW[n.kind], n.tag.length * 4.2), y: p.y - 6, w: 2 * Math.max(HW[n.kind], n.tag.length * 4.2), h: 104 }); }
  // ports: pipes meet a symbol at its side; a vapour outlet leaves from the top part (skill §6), drawing only
  const port = (k: string, out: boolean, side?: string | null, fromY?: number) => { const p = pos.get(k)!, n = node.get(k)!;
    if (!out && fromY !== undefined && tall.has(k)) return { x: p.x - HW[n.kind], y: fromY };   // a multi-pass heater: each pass enters on its own line
    const vap = out && /vapou?r/i.test(side ?? '') && ['vessel', 'column', 'reactor'].includes(n.kind);
    return { x: p.x + (out ? HW[n.kind] : -HW[n.kind]) + (n.kind === 'pump' && out ? 4 : 0), y: p.y + (n.kind === 'pump' && out ? 10 : vap ? 8 : 26) }; };
  const tall = new Map<string, { top: number; bot: number }>();
  const fwd = s.links.filter((l) => pos.has(l.a) && pos.has(l.b) && (col.get(l.b)! > col.get(l.a)!)).sort((x, y) => RANK[y.basis] - RANK[x.basis]);
  // with roles, a heater fed by several separate lines (passes, injection) is drawn tall: every line enters on its own, none merged
  if (roles) for (const n of s.nodes) if (n.kind === 'heater') { const ys = fwd.filter((l) => l.b === n.key).map((l) => port(l.a, true, l.aSide).y);
    if (ys.length >= 3) tall.set(n.key, { top: Math.min(...ys) - 22, bot: Math.max(...ys) + 22 }); }
  const inN = new Map<string, SLink[]>(), outN = new Map<string, SLink[]>();
  const isJ = (k: string) => node.get(k)?.kind === 'junction';
  for (const l of fwd) { if (!isJ(l.b) && !tall.has(l.b)) inN.set(l.b, [...(inN.get(l.b) ?? []), l]); if (!isJ(l.a)) outN.set(l.a, [...(outN.get(l.a) ?? []), l]); }
  const gapN = new Map<number, number>(), gapI = new Map<number, number>();
  // each splitting source / merging target gets its own header x, so two headers never share a line (no false junction)
  const offs = (m: Map<string, SLink[]>) => { const o = new Map<string, number>(); const per = new Map<number, number>();
    for (const [k, ls] of m) if (ls.length > 1) { const c = col.get(k)!; const i = per.get(c) ?? 0; per.set(c, i + 1); o.set(k, 16 + i * 16); } return o; };
  for (const l of fwd) gapN.set(col.get(l.a)!, (gapN.get(col.get(l.a)!) ?? 0) + 1);
  const so = offs(outN), jo = offs(inN);
  // compact: a split header never runs through its own item's name (a long name under a small symbol)
  if (compact) for (const [k, o] of so) { const n = node.get(k)!; so.set(k, Math.max(o, n.tag.length * 4.2 - HW[n.kind] + 10)); }
  const dots: string[] = []; const labels: string[] = []; const geo: { l: SLink; ax: number; ay: number; by: number; mx: number; mxIn: number; over: boolean; bx: number }[] = []; let skips = 0;
  const place = (txt: string, x: number, y: number, color: string, italic: boolean, tries: number[]) => {
    const w = txt.length * 6 + 8;
    for (const dy of tries) for (const dx of [0, 14, 28, 42, 56, -14, -28]) { const b = { x: x + dx - w / 2, y: y + dy - 11, w, h: 14 }; if (!boxes.some((o) => hit(o, b))) { boxes.push(b);
      labels.push(`<rect x="${b.x}" y="${b.y}" width="${w}" height="14" fill="#fff"/>`, t(x + dx, y + dy, txt, `text-anchor="middle" font-size="10" fill="${color}"${italic ? ' font-style="italic"' : ''}`)); return; } }
    issues.push(`label "${txt}" overlaps`); labels.push(t(x, y + tries[0], txt, `text-anchor="middle" font-size="10" fill="${color}"`));
  };
  const portLabel = (txt: string, x: number, y: number, anchor: 'start' | 'end') => { const w = txt.length * 5.4 + 4; const b = { x: anchor === 'start' ? x : x - w, y: y - 10, w, h: 12 };
    if (!boxes.some((o) => hit(o, b))) { boxes.push(b); labels.push(t(x, y, txt, `text-anchor="${anchor}" font-size="9" fill="#334155" font-weight="600"`)); } };
  for (const l of fwd) {
    const st = look(l); const a = port(l.a, true, l.aSide), b = port(l.b, false, l.bSide, port(l.a, true, l.aSide).y);
    const split = (outN.get(l.a)?.length ?? 0) > 1, merge = (inN.get(l.b)?.length ?? 0) > 1;
    const fan = isJ(l.a) && fwd.filter((o) => o.a === l.a).length > 1, gather = isJ(l.b) && fwd.filter((o) => o.b === l.b).length > 1;
    const sx = split ? a.x + so.get(l.a)! : a.x, jx = merge ? b.x - 6 - jo.get(l.b)! : b.x;
    const g = col.get(l.a)!, k = gapI.get(g) ?? 0, n = gapN.get(g) ?? 1; gapI.set(g, k + 1);
    // branches from one point share one vertical header (bus); otherwise each connection gets its own vertical
    // the vertical: at the target's merge point when it has one, else at the source's split point, else its own
    const mx = merge ? jx : gather ? jx - 18 : split ? sx : fan ? sx + 18 : Math.min(Math.max((sx + jx) / 2 + (k - (n - 1) / 2) * 12, sx + 10), jx - 10);
    const dash = st.dash ? ` stroke-dasharray="${st.dash}"` : '';
    // a connection that skips a column goes over the items between (never through a symbol)
    const span = col.get(l.b)! - col.get(l.a)!;
    const mid = span > 1 ? s.nodes.filter((o) => { const c = col.get(o.key)!; return c > col.get(l.a)! && c < col.get(l.b)!; }).map((o) => pos.get(o.key)!.y) : [];
    let track: number | null = null, x1 = mx, x2 = mx;
    if (mid.length) { const si = skips++; track = Math.min(...mid) - 18 - si * 10; x1 = a.x + 12 + si * 6; x2 = merge ? jx : jx - 12 - si * 6; }
    geo.push({ l, ax: a.x, ay: a.y, by: b.y, mx: x1, mxIn: x2, over: track !== null, bx: b.x });
    const d = track === null ? `M ${a.x} ${a.y} H ${mx} V ${b.y} H ${jx}` : `M ${a.x} ${a.y} H ${x1} V ${track} H ${x2} V ${b.y} H ${jx}`;
    parts.push(`<path d="${d}" fill="none" stroke="${st.color}" stroke-width="${st.width}"${dash}${merge || isJ(l.b) ? '' : ` marker-end="url(#ar-${st.marker})"`}/>`);
    // line numbers where known (an unknown one is left off the pipe and listed under Unknown); a conflict is flagged
    // a branch's role is named once, on its first connection (where it leaves the active route or starts)
    const first = l.role && !s.links.some((o) => o.b === l.a && o.role === l.role) && s.links.filter((o) => o.a === l.a && o.role === l.role)[0] === l;
    const roleTag = l.role ? (l.role === 'bypass' || first ? ROLE_STYLE[l.role].tag : '') : l.service ? 'bypass' : '';
    const lab = [l.lines.length ? l.lines.slice(0, 2).join(', ') + (l.lines.length > 2 ? ' …' : '') : '', roleTag, l.conflict ? '⚠ direction conflict' : ''].filter(Boolean).join(' · ');
    const onLast = (split || fan) && !merge, lx = track !== null ? (x1 + x2) / 2 : onLast ? (mx + jx) / 2 : (a.x + mx) / 2, ly = track !== null ? track - 8 : onLast ? b.y - 8 : a.y - 8;
    if (lab) place(lab, lx, ly, l.conflict ? '#b91c1c' : st.color, false, [0, 26, -14, 40]);
    if (l.aSide && !split && !fan) portLabel(l.aSide, a.x + 4, a.y + 14, 'start');
    if (l.bSide && /^pass/.test(l.bSide)) portLabel(l.bSide.replace(/ inlet$/, ''), a.x + 4, a.y - 6, 'start');
    else if (l.bSide) portLabel(l.bSide, b.x - 4, b.y + 14, 'end');
  }
  // junction dots exactly where a pipe branches off or joins another (a crossing gets none)
  const dot = (x: number, y: number) => { const d = `<circle cx="${x}" cy="${y}" r="3.6" fill="#0f172a"/>`; if (!dots.includes(d)) dots.push(d); };
  for (const g1 of geo) {
    const sib = geo.filter((o) => o.l.a === g1.l.a && o.ay === g1.ay); const reachX = (o: typeof g1) => (o.by === o.ay && !o.over ? o.bx : o.mx);   // how far a pipe runs along its starting row
    if (sib.length > 1 && sib.filter((o) => reachX(o) >= g1.mx).length > 1 && (g1.by !== g1.ay || g1.over)) dot(g1.mx, g1.ay);
    const tgt = geo.filter((o) => o.l.b === g1.l.b && o.by === g1.by); if (tgt.length > 1 && tgt.filter((o) => o.mxIn <= g1.mxIn).length > 1 && !isJ(g1.l.b) && (g1.by !== g1.ay || g1.over || tgt.some((o) => o !== g1 && o.mxIn < g1.mxIn))) dot(g1.mxIn, g1.by);
  }
  for (const [k, ls] of inN) if (ls.length > 1) { const b = port(k, false, ls[0].bSide); const pick = [...ls].sort((x, y) => (x.role === 'active' ? -1 : 0) - (y.role === 'active' ? -1 : 0) || RANK[x.basis] - RANK[y.basis])[0]; const st = look(pick); const x = b.x - 6 - jo.get(k)!;
    parts.push(`<path d="M ${x} ${b.y} H ${b.x}" stroke="${st.color}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''} marker-end="url(#ar-${st.marker})"/>`); dot(x, b.y); }
  // connections back to an earlier column run below the items
  s.links.filter((l) => !fwd.includes(l) && pos.has(l.a) && pos.has(l.b)).forEach((l, i) => { const st = look(l); const a = pos.get(l.a)!, b = pos.get(l.b)!; const yb = Math.max(a.y, b.y) + 112 + i * 10;
    parts.push(`<path d="M ${a.x} ${a.y + 54} V ${yb} H ${b.x} V ${b.y + 56}" fill="none" stroke="${st.color}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''} marker-end="url(#ar-${st.marker})"/>`);
    place(l.lines[0] ?? 'Line no.: unknown', (a.x + b.x) / 2, yb - 4, st.color, !l.lines.length, [0, 14]); });
  // items on top of the pipes
  for (const n of s.nodes) {
    const p = pos.get(n.key)!; const c = n.state === 'standby' ? '#94a3b8' : n.user && !roles ? '#6d28d9' : '#0f172a';
    if (n.kind === 'junction' && n.state === 'known') {   // a recorded point on a line (a tie-in): a plain junction with its name
      parts.push(`<circle cx="${p.x}" cy="${p.y + 26}" r="5" fill="#0f172a"/>`);
      const jl = wrap(n.label ?? n.tag.slice(2), 22);
      parts.push(`<rect x="${p.x - 62}" y="${p.y + 38}" width="124" height="${jl.length * 12 + 4}" fill="#fff"/>`);   // the name sits on white, never on a pipe
      jl.forEach((w, i) => parts.push(t(p.x, p.y + 48 + i * 12, w, 'text-anchor="middle" font-size="10" font-weight="600" fill="#0f172a"'))); continue; }
    const tl = tall.get(n.key);
    if (tl) { const zig = Array.from({ length: Math.max(2, Math.floor((tl.bot - tl.top - 20) / 14)) }, (_, i) => `${p.x + (i % 2 ? 14 : -14)},${tl.top + 10 + i * 14}`).join(' ');
      parts.push(`<rect x="${p.x - 28}" y="${tl.top}" width="56" height="${tl.bot - tl.top}" fill="#fff" stroke="${c}" stroke-width="2"/><rect x="${p.x - 7}" y="${tl.top - 10}" width="14" height="10" fill="#fff" stroke="${c}" stroke-width="2"/><polyline points="${zig}" fill="none" stroke="${c}" stroke-width="1.4"/>`,
        t(p.x, tl.bot + 20, n.tag, `text-anchor="middle" font-size="13" font-weight="800" fill="${c}"`));
      const via = n.via.filter((v) => !/inlet|feed lines/i.test(v)).join(' / '); if (via) parts.push(t(p.x, tl.bot + 34, via, 'text-anchor="middle" font-size="10" fill="#475569"'));
      continue; }
    parts.push(symbol(n.kind, p.x, p.y, c, n.state === 'closed'));
    if (n.kind === 'junction') { const ls = wrap(n.label ?? 'Split / header not recorded', 20); const h = 6 + ls.length * 12;
      parts.push(`<rect x="${p.x - 58}" y="${p.y + 41}" width="116" height="${h}" fill="#fff" stroke="#b45309" stroke-width="0.8" stroke-dasharray="2 2"/>`,
        ...ls.map((w, i) => t(p.x, p.y + 52 + i * 12, w, `text-anchor="middle" font-size="10" ${i ? '' : 'font-weight="700" '}fill="#b45309"`))); continue; }
    parts.push(t(p.x, p.y + 72, n.tag, `text-anchor="middle" font-size="13" font-weight="800" fill="${c}"`));
    if (n.state === 'closed' || n.state === 'standby' || n.state === 'open') {
      const st = n.state === 'closed' ? 'CLOSED' : n.state === 'open' ? 'OPEN' : 'STANDBY — ISOLATED';
      parts.push(t(p.x, p.y + 98, `${st}${n.stateSource ? ` (${n.stateSource})` : ''}`, `text-anchor="middle" font-size="9.5" font-weight="700" fill="${n.state === 'closed' ? '#b91c1c' : '#64748b'}"`)); }
    if (n.label) parts.push(t(p.x, p.y + 110, n.label, 'text-anchor="middle" font-size="9" fill="#475569"'));
    const via = n.via.filter((v) => !/inlet|feed lines/i.test(v)).join(' / ');
    if (via) parts.push(t(p.x, p.y + 86, via, 'text-anchor="middle" font-size="10" fill="#475569"'));
    if (n.user && !n.state && !roles) parts.push(t(p.x, p.y + 98, `added by ${n.user}`, 'text-anchor="middle" font-size="9" fill="#6d28d9"'));
  }
  parts.push(...dots, ...labels);
  if (!s.nodes.length) parts.push(t(WW / 2, (compact ? TOPc : TOP) + 40, 'Route not available — no equipment is named in the loop record', 'text-anchor="middle" font-size="14" font-weight="700" fill="#b45309"'));
  // the lists, metadata and check also go to the viewer's Details panel
  const info: SchematicInfo = { sections: [], meta: [] };
  const equip0 = s.nodes.filter((n) => n.kind !== 'junction').map((n) => n.tag).join(', ') || '—';
  if (s.extra.length) info.sections.push({ title: 'Also in this loop — place on the route not recorded', lines: s.extra.map((e) => ({ text: e })) });
  for (const k of ['before', 'blind', 'isolation', 'fill', 'vent', 'drain'] as MarkKind[]) { const ms = s.marks.filter((m) => m.kind === k);
    if (ms.length) info.sections.push({ title: MARK_STYLE[k].title, lines: ms.map((m) => ({ text: m.text, sub: `${m.source}${m.verifiedSheet ? ` · checked on ${m.verifiedSheet}` : m.user ? ' · not checked on a P&ID' : ''}` })) }); }
  if (s.notes.length) info.sections.push({ title: 'After / notes', lines: s.notes.map((n) => ({ text: n })) });
  info.sections.push({ title: 'Unknown / unresolved — not in the records', lines: s.unknown.map((u) => ({ text: u })) });
  info.meta.push(['Diagram', `${s.ref} loop schematic`], ['Type', s.type], ['Loop ID', s.ref], ['Equipment', equip0], ['Generated', generatedAt],
    ['Diagram revision', `auto-${s.revision} (generated; changes when the data changes — not a P&ID revision)`], ['Generator', GENERATOR_VERSION], ['Sources', s.sources.join(' · ')],
    ['Verification', `${s.status} — ${s.counts.verified} verified, ${s.counts.unverified} unverified connection${s.counts.unverified === 1 ? '' : 's'}, ${s.counts.unknown} unknown / unresolved item${s.counts.unknown === 1 ? '' : 's'}`]);
  if (compact) {
    // compact sheet: drawing, one line pointing to Details, a short legend, the warning — fitted to the content
    let y = Math.max(...s.nodes.map((n) => pos.get(n.key)!.y + nodeH(n)), ...[...tall.values()].map((v) => v.bot + 40), (compact ? TOPc : TOP) + 60) + (s.links.some((l) => !fwd.includes(l)) ? 40 : 6);
    const usedR = [...new Set(s.links.map((l) => l.role).filter(Boolean))] as Role[]; const usedB = [...new Set(s.links.map((l) => l.basis))];
    const ents: { icon: (x: number, y: number) => string; text: string }[] = [
      ...usedR.map((r) => ({ icon: (x: number, yy: number) => `<line x1="${x}" y1="${yy}" x2="${x + 30}" y2="${yy}" stroke="${ROLE_STYLE[r].color}" stroke-width="${ROLE_STYLE[r].width}"/>`, text: ROLE_STYLE[r].label.replace(/ \(not part of the active loop\)/, '') })),
      ...usedB.map((b) => ({ icon: (x: number, yy: number) => `<line x1="${x}" y1="${yy}" x2="${x + 30}" y2="${yy}" stroke="${usedR.length ? '#475569' : LINK_STYLE[b].color}" stroke-width="2.2"${LINK_STYLE[b].dash ? ` stroke-dasharray="${LINK_STYLE[b].dash}"` : ''}/>`, text: LINK_STYLE[b].label })),
      ...(s.nodes.some((n) => n.state === 'closed') ? [{ icon: (x: number, yy: number) => `<polygon points="${x + 5},${yy - 6} ${x + 5},${yy + 6} ${x + 15},${yy} ${x + 25},${yy - 6} ${x + 25},${yy + 6} ${x + 15},${yy}" fill="#0f172a"/>`, text: 'Closed per the procedure step named' }] : []),
      ...(dots.length ? [{ icon: (x: number, yy: number) => `<circle cx="${x + 15}" cy="${yy}" r="3.6" fill="#0f172a"/>`, text: 'Junction' }] : []),
      ...(s.nodes.some((n) => n.kind === 'junction' && n.state !== 'known') ? [{ icon: (x: number, yy: number) => `<circle cx="${x + 15}" cy="${yy}" r="6" fill="#fff" stroke="#b45309" stroke-width="2" stroke-dasharray="3 2"/>`, text: 'Not recorded' }] : [])];
    parts.push(`<line x1="24" y1="${y}" x2="${WW - 24}" y2="${y}" stroke="#e2e8f0"/>`); y += 20;
    let lx = 24;
    for (const e of ents) { const w = 40 + e.text.length * 5.7 + 22; if (lx + w > WW - 24) { lx = 24; y += 18; } parts.push(e.icon(lx, y - 4), t(lx + 38, y, e.text, 'font-size="10.5" fill="#334155"')); lx += w; }
    y += 20;
    const det = `Details (procedure points, notes, ${s.unknown.length} unknown / unresolved, sources, revision): Details panel below the drawing.${issues.length ? `  ⚠ Layout check: ${issues.length} issue${issues.length > 1 ? 's' : ''}` : ''}`;
    parts.push(t(24, y, det, `font-size="10.5" fill="${issues.length ? '#b91c1c' : '#64748b'}"`)); y += 14;
    const warn = 'REFERENCE ONLY — NOT AN AUTHORIZATION FOR ISOLATION, LINE-UP, VALVE OPERATION OR CHEMICAL WORK';
    parts.push(`<rect x="0" y="${y}" width="${WW}" height="24" fill="#b91c1c"/>`, t(WW / 2, y + 16, warn, 'text-anchor="middle" fill="#fff" font-size="10" font-weight="800"'));
    const H = y + 24;
    info.meta.push(['Automatic check', issues.length ? issues.join('; ') : 'passed (connections, junctions, labels)']);
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WW} ${H}" width="${WW}" height="${H}" font-family="Inter, Arial, sans-serif"><rect width="${WW}" height="${H}" fill="#fff"/>${parts.join('')}</svg>`, issues, info };
  }
  // lists below the drawing
  let y = TOP + (roles ? rowsR : rows) * ROWH + (s.links.some((l) => !fwd.includes(l)) ? 40 : 0) + Math.max(0, ...[...tall.values()].map((v) => v.bot + 50 - TOP - (roles ? rowsR : rows) * ROWH));
  const block = (title: string, color: string, lines: { icon?: string; text: string; sub?: string }[]) => {
    if (!lines.length) return;
    parts.push(`<line x1="24" y1="${y}" x2="${W - 24}" y2="${y}" stroke="#e2e8f0"/>`, t(24, y + 20, title, `font-size="12" font-weight="800" fill="${color}"`)); y += 40;
    for (const ln of lines) { const ws = wrap(ln.text, CH - 8); if (ln.icon) parts.push(ln.icon.replace(/__Y__/g, String(y - 4)));
      ws.forEach((w, i) => parts.push(t(52, y + i * 14, w, 'font-size="11" fill="#0f172a"')));
      if (ln.sub) parts.push(t(52, y + ws.length * 14, ln.sub, 'font-size="9.5" fill="#64748b"'));
      y += ws.length * 14 + (ln.sub ? 16 : 6); }
    y += 4;
  };
  if (s.extra.length) block('Also in this loop — place on the route not recorded', '#334155', s.extra.map((e) => ({ text: e })));
  for (const k of ['before', 'blind', 'isolation', 'fill', 'vent', 'drain'] as MarkKind[]) {
    const st = MARK_STYLE[k];
    block(st.title, st.color, s.marks.filter((m) => m.kind === k).map((m) => ({ icon: shiftIcon(k, st.color), text: m.text, sub: `${m.source}${m.verifiedSheet ? ` · checked on ${m.verifiedSheet}` : m.user ? ' · not checked on a P&ID' : ''}` })));
  }
  if (s.notes.length) block('After / notes', '#334155', s.notes.map((n) => ({ text: n })));
  block('Unknown / unresolved — not in the records', '#b45309', s.unknown.map((u) => ({ text: `• ${u}` })));
  // legend
  parts.push(`<line x1="24" y1="${y}" x2="${W - 24}" y2="${y}" stroke="#e2e8f0"/>`, t(24, y + 20, 'Legend', 'font-size="12" font-weight="800" fill="#334155"')); y += 38;
  const used = [...new Set(s.links.map((l) => l.basis))];
  const usedRoles = [...new Set(s.links.map((l) => l.role).filter(Boolean))] as Role[];
  for (const r of usedRoles) { const st = ROLE_STYLE[r];
    parts.push(`<line x1="24" y1="${y - 4}" x2="64" y2="${y - 4}" stroke="${st.color}" stroke-width="${st.width}"/>`, t(72, y, `${st.label} (colour and weight)`, 'font-size="10.5" fill="#334155"')); y += 16; }
  for (const b of (used.length ? used : ['record'] as Basis[])) { const st = LINK_STYLE[b]; const c = usedRoles.length ? '#475569' : st.color;
    parts.push(`<line x1="24" y1="${y - 4}" x2="64" y2="${y - 4}" stroke="${c}" stroke-width="${usedRoles.length ? 2.2 : st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`, t(72, y, `${st.label}${usedRoles.length ? ' (line pattern)' : ''}`, 'font-size="10.5" fill="#334155"')); y += 16; }
  if (s.nodes.some((n) => n.state === 'closed')) { parts.push(`<polygon points="34,${y - 10} 34,${y + 2} 44,${y - 4} 54,${y - 10} 54,${y + 2} 44,${y - 4}" fill="#0f172a"/>`, t(72, y, 'Filled valve: closed as written in the procedure step named (status as recorded, not an instruction)', 'font-size="10.5" fill="#334155"')); y += 16; }
  if (dots.length) { parts.push(`<circle cx="44" cy="${y - 4}" r="3.6" fill="#0f172a"/>`, t(72, y, 'Junction: branches join or split here (as drawn, not a measured location)', 'font-size="10.5" fill="#334155"')); y += 16; }
  parts.push(t(24, y + 2, 'Arrows: flow direction stated in the records. Symbols are generic (ISO 10628 / ISA-5.1 style, not checked for compliance); not to scale.', 'font-size="10" fill="#64748b"')); y += 22;
  // metadata (skill §19)
  const equip = s.nodes.filter((n) => n.kind !== 'junction').map((n) => n.tag).join(', ') || '—';
  const meta: [string, string][] = [['Diagram', `${s.ref} loop schematic`], ['Type', s.type], ['Loop ID', s.ref], ['Equipment', equip], ['Generated', generatedAt],
    ['Diagram revision', `auto-${s.revision} (generated; changes when the data changes — not a P&ID revision)`], ['Generator', GENERATOR_VERSION], ['Sources', s.sources.join(' · ')],
    ['Verification', `${s.status} — ${s.counts.verified} verified, ${s.counts.unverified} unverified connection${s.counts.unverified === 1 ? '' : 's'}, ${s.counts.unknown} unknown / unresolved item${s.counts.unknown === 1 ? '' : 's'}`]];
  const qc = () => (issues.length ? `${issues.length} issue${issues.length > 1 ? 's' : ''}: ${issues.slice(0, 3).join('; ')}${issues.length > 3 ? ' …' : ''}` : 'passed (connections, junctions, labels)');
  parts.push(`<line x1="24" y1="${y}" x2="${W - 24}" y2="${y}" stroke="#94a3b8"/>`); y += 18;
  const rowsMeta = (rs: [string, string][]) => { for (const [k, v] of rs) { const ws = wrap(v, CH - 28); parts.push(t(24, y, k, 'font-size="10.5" font-weight="700" fill="#334155"'));
    ws.forEach((w, i) => parts.push(t(150, y + i * 13, w, 'font-size="10.5" fill="#0f172a"'))); y += ws.length * 13 + 4; } };
  rowsMeta(meta);
  const qcAt = parts.length; parts.push(''); y += 17;   // the check line is written last, once the drawing is done
  parts.push(`<rect x="0" y="${y}" width="${W}" height="26" fill="#b91c1c"/>`, t(W / 2, y + 17, 'REFERENCE ONLY — NOT AN AUTHORIZATION FOR ISOLATION, BLINDING, VALVE OPERATION, NEUTRALIZATION, ENTRY, STARTUP OR HANDOVER', 'text-anchor="middle" fill="#fff" font-size="10" font-weight="800"'));
  const H = y + 26;
  parts[qcAt] = t(24, y - 13, 'Automatic check', 'font-size="10.5" font-weight="700" fill="#334155"') + t(150, y - 13, qc().slice(0, Math.floor(CH - 30)), `font-size="10.5" fill="${issues.length ? '#b91c1c' : '#15803d'}"`);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${parts.join('')}</svg>`, issues, info };
}
export const schematicSvg = (s: Schematic, generatedAt: string) => renderSchematic(s, generatedAt).svg;
/** the list icon, placed at the left of the current line (the y is filled in per line) */
function shiftIcon(k: MarkKind, c: string) { return `<g transform="translate(26 __Y__)">${markIcon(k, 0, 0, c)}</g>`; }
