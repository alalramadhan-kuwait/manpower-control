// Auto-generated loop schematics. Built each time from what the records say — the loop (name, detail, items), its
// field procedure, the blind list and the P&ID line-up — never from guesses: a connection is drawn only when a record
// names both ends; anything a record does not give (line numbers, valve positions along the pipe, fill / drain points)
// is listed as unknown. Connections found in the line-up are "verified" (P&ID read) or "unchecked" (Train-2 lines
// generated from Train 1); the rest come from the loop record or procedure. People's corrections (trk_loop_fix) are
// applied on top and shown as theirs. The SVG is shown in the drawing viewer, labelled as not a verified P&ID.
import { luKeys, type LuStream, type TrkPoint, type TrkPointStep } from './index';

export type NodeKind = 'vessel' | 'reactor' | 'exchanger' | 'heater' | 'pump' | 'compressor' | 'column' | 'filter' | 'valve' | 'instrument' | 'item';
export type Basis = 'verified' | 'unchecked' | 'record' | 'user' | 'user_verified';
export type MarkKind = 'fill' | 'drain' | 'vent' | 'isolation' | 'blind' | 'before';
export interface SNode { key: string; tag: string; kind: NodeKind; via: string[]; user?: string }
export interface SLink { key: string; a: string; b: string; basis: Basis; lines: string[]; sheets: string[]; source: string; user?: string }
export interface SMark { key: string; kind: MarkKind; text: string; source: string; user?: string; verifiedSheet?: string }
export interface Schematic { ref: string; title: string; nodes: SNode[]; links: SLink[]; extra: string[]; marks: SMark[]; notes: string[]; unknown: string[]; sources: string[]; removed: number }
export interface LoopFix { id: string; pointId: string; op: 'remove' | 'add_link' | 'add_mark' | 'note'; target: string | null; a: string | null; b: string | null; line: string | null;
  kind: MarkKind | null; text: string | null; sheet: string | null; reason: string | null; status: 'active' | 'withdrawn'; by: string | null; at: string }

export const SCHEMATIC_LABEL = 'Auto-generated schematic — Not a verified P&ID';

// ── tags in the records ────────────────────────────────────────────────────────────────────────────────────────
const EQ = /\b(EA|EJ|TK|[VEHRPCTF])-(?:12-)?(\d{3}[A-Z]?(?:\/(?:\d{3}|[A-Z]))*)(?![\d-])/g;
const VALVE = /\b(MOV|XV|KV|FV|LV|TV|PV|HV|SDV|NRV)-(\d{2,4}[A-Z]?(?:\/[A-Z])*)\b/g;
const PLANT = /\b12-[A-Z]{2}-\d{4}\b/g;
const SIDE = /^\s*(T\/S|S\/S|O\/L|I\/L|tube side|shell side|vapour|discharge|inlet|outlet|passes)\b/i;
/** the key a tag is matched on: E-12-229 → E-229 (the line-up form) */
export const tagKey = (t: string) => t.trim().toUpperCase().replace(/^([A-Z]{1,3})-12-(\d)/, '$1-$2');
const kindOf = (tag: string): NodeKind => {
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
const uniq = <T>(xs: T[], k: (x: T) => string) => { const s = new Set<string>(); return xs.filter((x) => (s.has(k(x)) ? false : (s.add(k(x)), true))); };

/** The schematic of one loop from the records, with people's corrections applied. */
export function buildSchematic(p: Pick<TrkPoint, 'id' | 'ref' | 'name' | 'detail' | 'items' | 'requires' | 'method'>, d: { points?: Pick<TrkPoint, 'kind' | 'ref' | 'name'>[]; steps?: TrkPointStep[]; lineup?: LuStream[]; fixes?: LoopFix[] }): Schematic {
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
  const node = (tag: string, side: string | null, user?: string) => { const k = tagKey(tag); const n = nodes.get(k) ?? { key: k, tag: tagKey(tag), kind: kindOf(tagKey(tag)), via: [], user };
    if (side && !n.via.includes(side)) n.via.push(side); nodes.set(k, n); return k; };
  let links: SLink[] = [];
  const ends = (r: Raw) => [node(r.a.tag, r.a.side), node(r.b.tag, r.b.side)] as const;
  for (const r of raw) { const [a, b] = ends(r); if (a !== b) links.push({ key: `link:${a}>${b}`, a, b, basis: 'record', lines: [], sheets: [], source: r.source }); }
  if (group && fromFill && !nodes.has(tagKey(group))) {
    const into = raw.filter((r) => /inlet|passes/i.test(r.b.side ?? '')).map((r) => tagKey(r.b.tag));
    if (into.length) { const g = node(group, 'feed lines'); nodes.get(g)!.kind = 'instrument';
      links = links.flatMap((l) => (into.includes(l.b) ? [{ ...l, b: g, key: `link:${l.a}>${g}` }] : [l]));
      for (const t of [...new Set(into)]) links.push({ key: `link:${g}>${t}`, a: g, b: t, basis: 'record', lines: [], sheets: [], source: 'Loop name (instruments on the feed lines)' }); }
  }
  links = uniq(links, (l) => l.key);
  // a direct connection that the records also give through other items is the same route: keep the longer one
  const reach = (a: string, b: string, skip: string) => { const seen = new Set([a]); const q = [a];
    while (q.length) { const x = q.shift()!; for (const l of links) if (l.a === x && l.key !== skip && !seen.has(l.b)) { if (l.b === b) return true; seen.add(l.b); q.push(l.b); } } return false; };
  links = links.filter((l) => !reach(l.a, l.b, l.key));
  // the same item named two ways (E-210 and E-210A/B): one item, the more specific name
  for (const k of [...nodes.keys()]) { const more = [...nodes.keys()].filter((o) => o !== k && luKeys(o)[0] === k && luKeys(o).length > 1);
    if (more.length !== 1) continue; const into = nodes.get(more[0])!; for (const v of nodes.get(k)!.via) if (!into.via.includes(v)) into.via.push(v);
    nodes.delete(k); links = links.map((l) => { const a2 = l.a === k ? into.key : l.a, b2 = l.b === k ? into.key : l.b; return { ...l, a: a2, b: b2, key: `link:${a2}>${b2}` }; }).filter((l) => l.a !== l.b); }
  links = uniq(links, (l) => l.key);
  // the loop's items when no connection is stated; otherwise listed apart (place on the route not recorded)
  const itemTags = p.items.flatMap((i) => tagsIn(i, true).map((t) => t.tag)).concat(p.items.length ? [] : tagsIn(`${p.name} ${p.detail ?? ''}`).map((t) => t.tag));
  const extra: string[] = [];
  for (const t of uniq(itemTags, tagKey)) { if (nodes.has(tagKey(t)) || nodes.has(luKeys(tagKey(t))[0]) || [...nodes.keys()].some((k) => luKeys(k).includes(tagKey(t)))) continue; if (!links.length) node(t, null); else extra.push(tagKey(t)); }
  for (const i of p.items) if (!tagsIn(i, true).length && !extra.includes(i)) extra.push(i);
  // line-up: line numbers and how far each connection is checked
  let luHits = 0;
  for (const l of links) {
    const ss = lu.filter((s) => same(s.from, l.a) && same(s.to, l.b));
    if (!ss.length) continue; luHits++;
    l.basis = ss.some((s) => s.conf === 'ok') ? 'verified' : 'unchecked';
    l.lines = [...new Set(ss.flatMap((s) => s.lineNos))]; l.sheets = [...new Set(ss.flatMap((s) => s.sheets))]; l.source = 'P&ID line-up';
  }
  if (luHits) sources.push(`P&ID line-up (${luHits} connection${luHits > 1 ? 's' : ''})`);
  // fill / drain / vent / boundary points
  let marks = marksOf(steps);
  const blinds = (p.requires ?? []).map((r) => { const b = (d.points ?? []).find((x) => x.kind === 'blind' && x.ref === r); return { key: `mark:blind:${r}`, kind: 'blind' as const, text: `${r}${b?.name ? ` · ${b.name}` : ''}`, source: 'Blind list' }; });
  if (blinds.length) sources.push(`Blind list (${blinds.length})`);
  marks = uniq([...blinds, ...marks], (m) => m.key);
  const notes = steps.filter((s) => s.phase === 'after').map((s) => s.text);
  // corrections
  let removed = 0;
  for (const f of fixes) {
    if (f.op === 'remove' && f.target) {
      const n0 = nodes.size + links.length + marks.length;
      if (f.target.startsWith('node:')) { const k = f.target.slice(5); nodes.delete(k); links = links.filter((l) => l.a !== k && l.b !== k); }
      links = links.filter((l) => l.key !== f.target); marks = marks.filter((m) => m.key !== f.target);
      removed += n0 - (nodes.size + links.length + marks.length);
    }
    if (f.op === 'add_link' && f.a && f.b) {
      const a = node(f.a, null, f.by ?? 'user'), b = node(f.b, null, f.by ?? 'user');
      links = links.filter((l) => !(l.a === a && l.b === b));
      links.push({ key: `link:${a}>${b}`, a, b, basis: f.sheet ? 'user_verified' : 'user', lines: f.line ? [f.line] : [], sheets: f.sheet ? [f.sheet] : [], source: `Correction by ${f.by ?? 'user'}`, user: f.by ?? 'user' });
    }
    if (f.op === 'add_mark' && f.kind && f.text) marks.push({ key: `fix:${f.id}`, kind: f.kind, text: f.text, source: `Correction by ${f.by ?? 'user'}`, user: f.by ?? 'user', verifiedSheet: f.sheet ?? undefined });
    if (f.op === 'note' && f.text) notes.push(`${f.text} (${f.by ?? 'user'})`);
  }
  if (fixes.length) sources.push(`Corrections (${fixes.length})`);
  // what the records do not give
  const unknown: string[] = [];
  const nolu = links.filter((l) => l.basis === 'record');
  if (!nodes.size) unknown.push('No equipment is named in the loop record: the route is not known.');
  else if (!links.length) unknown.push('The route between the items is not recorded: items are shown without connections.');
  if (nolu.length) unknown.push(`Line numbers not in the P&ID line-up for: ${nolu.map((l) => `${l.a} → ${l.b}`).join(', ')}.`);
  if (links.some((l) => l.basis === 'unchecked')) unknown.push('Some line-up connections are Train-2 lines generated from Train 1 and not yet checked on the Train-2 sheet.');
  if (!steps.length) unknown.push('No field procedure is recorded: fill, drain, vent and isolation points are not known.');
  else {
    if (!marks.some((m) => m.kind === 'fill')) unknown.push('Fill (soda ash in) points are not recorded in the procedure.');
    if (!marks.some((m) => m.kind === 'drain' || m.kind === 'vent')) unknown.push('Drain / vent points are not recorded in the procedure.');
  }
  if (!blinds.length) unknown.push('No boundary blinds are linked to this loop.');
  if (marks.some((m) => m.kind !== 'before')) unknown.push('Where each valve, blind, fill and drain point sits along the pipe is not recorded: they are listed beside the route, not drawn on it.');
  if (extra.length) unknown.push('Items listed under "Also in this loop" have no recorded place on the route.');
  return { ref: p.ref, title: p.name, nodes: [...nodes.values()], links, extra, marks, notes, unknown, sources, removed };
}

// ── drawing (SVG) ──────────────────────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wrap = (s: string, chars: number) => { const out: string[] = []; let cur = '';
  for (const w of s.split(/\s+/)) { if ((cur + ' ' + w).trim().length > chars && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur); return out; };
export const LINK_STYLE: Record<Basis, { color: string; dash: string; label: string }> = {
  verified: { color: '#1e3a8a', dash: '', label: 'In P&ID line-up (sheet read)' },
  unchecked: { color: '#b45309', dash: '', label: 'In line-up, Train-2 not checked on its sheet' },
  record: { color: '#64748b', dash: '7 5', label: 'From loop record / procedure, line not in line-up' },
  user: { color: '#7c3aed', dash: '7 5', label: 'Added by a person, not checked on a P&ID' },
  user_verified: { color: '#7c3aed', dash: '', label: 'Added by a person, checked on the P&ID sheet named' },
};
const MARK_STYLE: Record<MarkKind, { color: string; title: string }> = {
  before: { color: '#334155', title: 'Procedure steps (before / while filling)' },
  blind: { color: '#b91c1c', title: 'Boundary blinds (blind list)' },
  isolation: { color: '#b91c1c', title: 'Isolation / boundary (procedure)' },
  fill: { color: '#15803d', title: 'Fill points — soda ash in' },
  vent: { color: '#0e7490', title: 'Vent / overflow / clear soda ash check' },
  drain: { color: '#1d4ed8', title: 'Drain points' },
};
function symbol(k: NodeKind, cx: number, y: number, stroke: string): string {
  const s = `fill="#fff" stroke="${stroke}" stroke-width="2"`;
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

/** The schematic as an SVG sheet (white, landscape, readable when fitted to a phone and zoomed). */
export function schematicSvg(s: Schematic, generatedAt: string): string {
  const COLW = 200, ROWH = 140;
  // columns: longest path from the starts; several items in one column stack
  const col = new Map<string, number>(s.nodes.map((n) => [n.key, 0]));
  for (let i = 0; i < s.nodes.length; i++) for (const l of s.links) { const c = (col.get(l.a) ?? 0) + 1; if (c > (col.get(l.b) ?? 0) && c < s.nodes.length) col.set(l.b, c); }
  const cols = Math.max(1, ...[...col.values()].map((c) => c + 1));
  const byCol: string[][] = Array.from({ length: cols }, () => []);
  for (const n of s.nodes) byCol[col.get(n.key) ?? 0].push(n.key);
  const rows = Math.max(1, ...byCol.map((c) => c.length));
  const W = Math.max(820, 40 + cols * COLW), X0 = (W - (cols - 1) * COLW) / 2;
  const TOP = 132 + Math.max(0, Math.ceil((40 + s.sources.join(' · ').length + 70) / Math.floor((W - 48) / 6)) - 1) * 14;
  const pos = new Map<string, { x: number; y: number }>();
  byCol.forEach((ks, c) => ks.forEach((k, r) => pos.set(k, { x: X0 + c * COLW, y: TOP + (r + (rows - ks.length) / 2) * ROWH })));
  const parts: string[] = [];
  const t = (x: number, y: number, txt: string, o = '') => `<text x="${x}" y="${y}" ${o}>${esc(txt)}</text>`;
  // header
  parts.push(`<rect x="0" y="0" width="${W}" height="30" fill="#b91c1c"/>`, t(W / 2, 20, SCHEMATIC_LABEL.toUpperCase(), 'text-anchor="middle" fill="#fff" font-size="14" font-weight="800" letter-spacing="0.5"'));
  parts.push(t(24, 58, `${s.ref} · ${s.title}`, 'font-size="18" font-weight="800" fill="#0f172a"'));
  const head = wrap(`Built ${generatedAt} from: ${s.sources.join(' · ')}. Reference only — not for isolation, line-up or chemical work.`, Math.floor((W - 48) / 6));
  head.forEach((h, i) => parts.push(t(24, 78 + i * 14, h, 'font-size="11" fill="#475569"')));
  parts.push(`<defs>${Object.entries(LINK_STYLE).map(([k, v]) => `<marker id="ar-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${v.color}"/></marker>`).join('')}</defs>`);
  // connections (behind the items)
  const nodeY = (k: string) => pos.get(k)!.y + 26;
  // links that share a gap get their own vertical, and their labels sit on their own first leg
  const gapN = new Map<string, number>(); const gapI = new Map<string, number>();
  for (const l of s.links) { const g = `${col.get(l.a)}`; gapN.set(g, (gapN.get(g) ?? 0) + 1); }
  s.links.forEach((l, i) => {
    const a = pos.get(l.a), b = pos.get(l.b); if (!a || !b) return; const st = LINK_STYLE[l.basis];
    const g = `${col.get(l.a)}`, k = gapI.get(g) ?? 0, n = gapN.get(g) ?? 1; gapI.set(g, k + 1);
    const x1 = a.x + 34, x2 = b.x - 36, y1 = nodeY(l.a), y2 = nodeY(l.b), mx = (x1 + x2) / 2 + (k - (n - 1) / 2) * 12;
    const d = x2 > x1 ? `M ${x1} ${y1} H ${mx} V ${y2} H ${x2}` : `M ${a.x} ${y1 + 46} V ${y1 + 62 + (i % 3) * 6} H ${b.x} V ${y2 + 46}`;
    parts.push(`<path d="${d}" fill="none" stroke="${st.color}" stroke-width="2.4" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''} marker-end="url(#ar-${l.basis})"/>`);
    const label = l.lines.length ? l.lines.slice(0, 2).join(', ') + (l.lines.length > 2 ? ' …' : '') : 'line no. unknown';
    const same = s.links.filter((o) => o.a === l.a); const j = same.indexOf(l);
    const lx = x2 > x1 ? (x1 + mx) / 2 : (a.x + b.x) / 2, ly = x2 > x1 ? y1 - 8 - j * 13 : y1 + 74 + (i % 3) * 6;
    parts.push(`<rect x="${lx - label.length * 3.1 - 3}" y="${ly - 10}" width="${label.length * 6.2 + 6}" height="13" fill="#fff" opacity="0.9"/>`, t(lx, ly, label, `text-anchor="middle" font-size="10" fill="${st.color}" font-style="${l.lines.length ? 'normal' : 'italic'}"`));
  });
  // items
  for (const n of s.nodes) {
    const p = pos.get(n.key)!; const c = n.user ? '#7c3aed' : '#0f172a';
    parts.push(symbol(n.kind, p.x, p.y, c));
    parts.push(t(p.x, p.y + 70, n.tag, `text-anchor="middle" font-size="13" font-weight="800" fill="${c}"`));
    if (n.via.length) parts.push(t(p.x, p.y + 84, n.via.join(' / '), 'text-anchor="middle" font-size="10" fill="#475569"'));
    if (n.user) parts.push(t(p.x, p.y + 96, `added by ${n.user}`, 'text-anchor="middle" font-size="9" fill="#7c3aed"'));
  }
  if (!s.nodes.length) parts.push(t(W / 2, TOP + 40, 'Route not available — no equipment is named in the loop record', 'text-anchor="middle" font-size="14" font-weight="700" fill="#b45309"'));
  // lists below
  let y = TOP + rows * ROWH + 10; const CH = Math.floor((W - 70) / 6.1);
  const block = (title: string, color: string, lines: { icon?: string; text: string; sub?: string }[]) => {
    if (!lines.length) return;
    parts.push(`<line x1="24" y1="${y}" x2="${W - 24}" y2="${y}" stroke="#e2e8f0"/>`, t(24, y + 20, title, `font-size="12" font-weight="800" fill="${color}"`)); y += 40;
    for (const ln of lines) { const ws = wrap(ln.text, CH - 4); if (ln.icon) parts.push(ln.icon.replace(/__Y__/g, String(y - 4)));
      ws.forEach((w, i) => parts.push(t(52, y + i * 14, w, 'font-size="11" fill="#0f172a"')));
      if (ln.sub) parts.push(t(52, y + ws.length * 14, ln.sub, 'font-size="9.5" fill="#64748b"'));
      y += ws.length * 14 + (ln.sub ? 16 : 6); }
    y += 4;
  };
  if (s.extra.length) block('Also in this loop — place on the route not recorded', '#334155', s.extra.map((e) => ({ text: e })));
  for (const k of ['before', 'blind', 'isolation', 'fill', 'vent', 'drain'] as MarkKind[]) {
    const ms = s.marks.filter((m) => m.kind === k); const st = MARK_STYLE[k];
    block(st.title, st.color, ms.map((m) => ({ icon: shiftIcon(k, st.color), text: m.text, sub: `${m.source}${m.verifiedSheet ? ` · checked on ${m.verifiedSheet}` : m.user ? ' · not checked on a P&ID' : ''}` })));
  }
  if (s.notes.length) block('After / notes', '#334155', s.notes.map((n) => ({ text: n })));
  block('Unknown — not in the records', '#b45309', s.unknown.map((u) => ({ text: `• ${u}` })));
  // legend
  parts.push(`<line x1="24" y1="${y}" x2="${W - 24}" y2="${y}" stroke="#e2e8f0"/>`); y += 18;
  const used = [...new Set(s.links.map((l) => l.basis))];
  (used.length ? used : (['record'] as Basis[])).forEach((b, i) => { const st = LINK_STYLE[b]; const yy = y + i * 16;
    parts.push(`<line x1="24" y1="${yy - 4}" x2="60" y2="${yy - 4}" stroke="${st.color}" stroke-width="2.4" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''}/>`, t(68, yy, st.label, 'font-size="10.5" fill="#334155"')); });
  y += (used.length || 1) * 16 + 6;
  parts.push(t(24, y + 4, 'Arrows show the fill direction stated in the records. Symbols are generic; sizes and positions are not to scale.', 'font-size="10" fill="#64748b"'));
  const H = y + 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${parts.join('')}</svg>`;
}
/** the list icon, placed at the left of the current line (the y is filled in per line) */
function shiftIcon(k: MarkKind, c: string) { return `<g transform="translate(26 __Y__)">${markIcon(k, 0, 0, c)}</g>`; }
