// One filter bar for Month, Week and List (Calendar Stage 3, owner 26 Oct 2026): crew, position, leave type, status,
// search and "Risk only", all kept in the address, so switching view, opening a leave or a request and coming Back
// keep them. Also the page's scroll position, remembered per address for the session.
import { Search, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { leaveGroup } from '@/core/calendar/board';
import type { ApprovalState } from '@/core/leave/status';
import { CREWS } from '@/core/roster';
import { cx } from '@/ui/components';
import { nameFilter } from '@/ui/nameSearch';

export type CrewF = 'all' | 'A' | 'B' | 'C' | 'D' | 'day';
export type PosF = 'all' | 'controller' | 'panel' | 'field' | 'other';
export type TypeF = 'all' | 'pv' | 'ul' | 'sick' | 'other';
export type StatusF = 'all' | 'approved' | 'awaiting' | 'requested';
export interface CalFilters { crew: CrewF; pos: PosF; type: TypeF; status: StatusF; q: string; risk: boolean }
/** The address keys the filters own; every view keeps them when it moves. */
export const FILTER_KEYS = ['f', 'pos', 'type', 'st', 'q', 'risk'] as const;

const CREW_OPTS: [CrewF, string][] = [['all', 'All crews'], ...CREWS.map((c) => [c, c] as [CrewF, string]), ['day', 'Day / VR']];
const POS_OPTS: [PosF, string][] = [['all', 'All positions'], ['controller', 'Controller'], ['panel', 'Panel'], ['field', 'Field'], ['other', 'Others']];
const TYPE_OPTS: [TypeF, string][] = [['all', 'All types'], ['pv', 'PV'], ['ul', 'UL'], ['sick', 'Sick'], ['other', 'Other']];
const STATUS_OPTS: [StatusF, string][] = [['all', 'All status'], ['approved', 'Approved'], ['awaiting', 'Not approved'], ['requested', 'Requested']];
const pick = <T extends string>(v: string | null, opts: [T, string][], d: T): T => (opts.find(([k]) => k === v)?.[0] ?? d);

export function useCalFilters(): [CalFilters, (p: Partial<CalFilters>) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('f') ?? params.get('crew');
  // old links: f=shortage was the "Shortage" chip; f=shutdowns / holidays filtered the old month view
  const f: CalFilters = { crew: pick(raw, CREW_OPTS, 'all'), pos: pick(params.get('pos'), POS_OPTS, 'all'), type: pick(params.get('type'), TYPE_OPTS, 'all'),
    status: pick(params.get('st'), STATUS_OPTS, 'all'), q: params.get('q') ?? '', risk: params.get('risk') === '1' || raw === 'shortage' };
  const set = (p: Partial<CalFilters>) => setParams((prev) => {
    const n = new URLSearchParams(prev); const v = { ...f, ...p };
    const put = (k: string, val: string, def: string) => (val && val !== def ? n.set(k, val) : n.delete(k));
    n.delete('crew'); put('f', v.crew, 'all'); put('pos', v.pos, 'all'); put('type', v.type, 'all'); put('st', v.status, 'all'); put('q', v.q, ''); put('risk', v.risk ? '1' : '', '');
    return n;
  }, { replace: true });
  return [f, set];
}

/** Position group of a role (the directory's position_category, or the manpower role). */
export function posGroup(roleOrCategory: string | null | undefined): Exclude<PosF, 'all'> {
  const r = roleOrCategory ?? '';
  if (r === 'controller' || r === 'vr_controller' || r === 'morning_controller') return 'controller';
  if (r === 'panel' || r === 'panel_operator') return 'panel';
  if (r === 'field' || r === 'field_operator') return 'field';
  return 'other';
}
export function typeGroup(code: string | null | undefined): Exclude<TypeF, 'all'> {
  if (code === 'annual_leave_planned' || code === 'annual_leave_rescheduled') return 'pv';
  if (code === 'annual_leave_unscheduled') return 'ul';
  return leaveGroup(code) === 'Sick leave' ? 'sick' : 'other';
}
/** One leave (or request) against the filters. Crew matches the own or the actual crew; "day" = no crew. */
export function matchLeave(f: CalFilters, x: { pos: string | null; typeCode: string | null; approval: ApprovalState | 'requested'; home: string | null; actual: string | null; names: (string | null | undefined)[] }) {
  if (f.crew !== 'all' && (f.crew === 'day' ? !!(x.home || x.actual) : x.home !== f.crew && x.actual !== f.crew)) return false;
  if (f.pos !== 'all' && posGroup(x.pos) !== f.pos) return false;
  if (f.type !== 'all' && typeGroup(x.typeCode) !== f.type) return false;
  if (f.status === 'requested' ? x.approval !== 'requested' : f.status === 'approved' ? x.approval !== 'approved' && x.approval !== 'not_required'
    : f.status === 'awaiting' ? !['awaiting', 'lapsed', 'declined'].includes(x.approval) : false) return false;
  return !f.q || nameFilter(f.q)(x.names);
}

type Menu = 'crew' | 'pos' | 'type' | 'status' | null;
/** The bar: one row of chips; a chip opens its options under the row; search and Risk only where the view uses them. */
export function FilterBar({ f, set, risk = false }: { f: CalFilters; set: (p: Partial<CalFilters>) => void; risk?: boolean }) {
  const [menu, setMenu] = useState<Menu>(null);
  const [searching, setSearching] = useState(!!f.q);
  const label = <T extends string>(v: T, opts: [T, string][]) => opts.find(([k]) => k === v)?.[1] ?? v;
  const chip = (on: boolean, open = false) => cx('flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium ring-1', on ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-600 ring-slate-200', open && 'ring-2 ring-brand-500');
  const any = f.crew !== 'all' || f.pos !== 'all' || f.type !== 'all' || f.status !== 'all' || !!f.q || f.risk;
  const opts = menu === 'crew' ? CREW_OPTS : menu === 'pos' ? POS_OPTS : menu === 'type' ? TYPE_OPTS : menu === 'status' ? STATUS_OPTS : [];
  const cur = menu === 'crew' ? f.crew : menu === 'pos' ? f.pos : menu === 'type' ? f.type : menu === 'status' ? f.status : '';
  const choose = (k: string) => { set(menu === 'crew' ? { crew: k as CrewF } : menu === 'pos' ? { pos: k as PosF } : menu === 'type' ? { type: k as TypeF } : { status: k as StatusF }); setMenu(null); };
  const tab = (m: Exclude<Menu, null>, v: string, def: string, text: string) =>
    <button type="button" aria-expanded={menu === m} onClick={() => setMenu(menu === m ? null : m)} className={chip(v !== def, menu === m)}>{v === def ? text : label(v as never, (m === 'crew' ? CREW_OPTS : m === 'pos' ? POS_OPTS : m === 'type' ? TYPE_OPTS : STATUS_OPTS) as never)} ▾</button>;
  return (
    <div className="mb-2 space-y-1.5">
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
        {tab('crew', f.crew, 'all', 'Crew')}{tab('pos', f.pos, 'all', 'Position')}{tab('type', f.type, 'all', 'Type')}{tab('status', f.status, 'all', 'Status')}
        <button type="button" aria-label="Search name or number" aria-pressed={searching || !!f.q} onClick={() => setSearching(!searching)} className={chip(!!f.q)}><Search className="h-3 w-3" />{f.q ? ` ${f.q}` : ''}</button>
        {risk && <button type="button" aria-pressed={f.risk} onClick={() => set({ risk: !f.risk })} className={chip(f.risk)}>Risk only</button>}
        {any && <button type="button" onClick={() => { set({ crew: 'all', pos: 'all', type: 'all', status: 'all', q: '', risk: false }); setSearching(false); setMenu(null); }} className="flex shrink-0 items-center px-1.5 text-[11px] font-medium text-slate-500"><X className="h-3 w-3" />Clear</button>}
      </div>
      {menu && <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1.5">{opts.map(([k, l]) =>
        <button key={k} type="button" aria-pressed={cur === k} onClick={() => choose(k)} className={chip(cur === k)}>{l}</button>)}</div>}
      {(searching || f.q) && <input className="input min-h-10 text-sm" type="search" placeholder="Name or employee no." value={f.q} autoFocus={searching && !f.q} onChange={(e) => set({ q: e.target.value })} />}
    </div>
  );
}

/** Keep and restore the page's scroll position for this address (session only). Restores once `ready` is true. */
export function useScrollMemory(ready: boolean) {
  const loc = useLocation();
  // the open leave / day is part of the address but not of the page position
  const key = `cal-scroll:${loc.pathname}?${[...new URLSearchParams(loc.search)].filter(([k]) => k !== 'leave' && k !== 'day').map(([k, v]) => `${k}=${v}`).join('&')}`;
  const restored = useRef<string | null>(null);
  useEffect(() => {
    const save = () => { if (document.body.style.position === 'fixed') return; try { sessionStorage.setItem(key, String(window.scrollY)); } catch { /* storage off */ } };
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [key]);
  useLayoutEffect(() => {
    if (!ready || restored.current === key) return;
    restored.current = key;
    let y = 0; try { y = Number(sessionStorage.getItem(key) ?? 0); } catch { /* storage off */ }
    // now, before a sheet opened from the address pins the page (it keeps the position it finds)
    if (y > 0) window.scrollTo(0, y);
  }, [ready, key]);
}

/** This page's address, for a "back" link from a page the Calendar opens. */
export const backHere = () => encodeURIComponent(window.location.pathname + window.location.search);
