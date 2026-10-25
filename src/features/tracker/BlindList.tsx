// Blind list for the startup: by item (its blinds and whether it is positively isolated: all its blinds recorded in)
// or by blind (each blind by type with the items and loops it is linked to). Read only; the same page in the Section
// Head Isolation tab and the Engineer Handover tab.
import { useState } from 'react';
import { BLIND_TYPE, blindList, blindsByType, type BlindType, kwDay, kwTime, type TrkData } from '@/core/tracker';
import { cx } from '@/ui/components';
import { CRow, RowList, Tile } from './ui';

const when = (iso: string | null) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '');
const STATE = { in: ['✓ In', 'bg-green-100 text-green-800'], out: ['Out', 'bg-slate-100 text-slate-600'], not: ['Not in', 'bg-red-100 text-red-800'] } as const;

type D = Pick<TrkData, 'equipment' | 'loopItems' | 'activities' | 'points'>;
const SEG = (on: boolean) => cx('min-h-9 flex-1 rounded-lg px-2 text-xs font-semibold ring-1', on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200');

export function BlindList({ d, onItem }: { d: D; onItem?: (tag: string) => void }) {
  const [by, setBy] = useState<'item' | 'blind'>('item');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/60 p-1">{([['item', 'By item'], ['blind', 'By blind']] as const).map(([k, l]) =>
        <button key={k} type="button" onClick={() => setBy(k)} className={cx('min-h-9 rounded-lg text-xs font-semibold', by === k ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600')}>{l}</button>)}</div>
      {by === 'item' ? <ByItem d={d} onItem={onItem} /> : <ByBlind d={d} onItem={onItem} />}
    </div>
  );
}

/** Every blind by type, with the items it isolates and the loops that wait for it. */
function ByBlind({ d, onItem }: { d: D; onItem?: (tag: string) => void }) {
  const rows = blindsByType(d);
  const [t, setT] = useState<BlindType>('segregation');
  const xs = rows.filter((r) => r.type === t).sort((a, b) => Number(a.state === 'in') - Number(b.state === 'in') || a.ref.localeCompare(b.ref, 'en', { numeric: true }));
  const line = t === 'segregation' || t === 'hp_critical';
  return (<>
    <div className="grid grid-cols-2 gap-1.5">{BLIND_TYPE.map(([k, l]) => { const all = rows.filter((r) => r.type === k);
      return <button key={k} type="button" onClick={() => setT(k)} className={SEG(t === k)}>{l} <span className="opacity-70">{all.filter((r) => r.state === 'in').length}/{all.length}</span></button>; })}</div>
    {xs.length ? <RowList>{xs.map((r) => <CRow key={r.id} dot={r.state === 'in' ? 'green' : r.state === 'out' ? 'grey' : 'red'}
      title={line ? `${r.ref} · ${r.name}` : r.ref} sub={`${line ? '' : `${r.name} · `}${STATE[r.state][0]}${r.at ? ` ${when(r.at)}` : ''}`}
      onTitle={!line && onItem ? () => onItem(r.ref) : undefined}
      extra={line ? <>{r.items.length ? r.items.map((tag) => <button key={tag} type="button" onClick={() => onItem?.(tag)} className="rounded bg-white px-1.5 py-px text-[10px] font-bold text-brand-700 ring-1 ring-slate-200">{tag} ›</button>)
        : <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-900">No item linked</span>}
        {r.loops.map((l) => <span key={l} className="rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-700">needed by {l}</span>)}</> : undefined} />)}</RowList>
      : <p className="py-3 text-center text-sm text-slate-500">No blinds of this type.</p>}
  </>);
}

function ByItem({ d, onItem }: { d: D; onItem?: (tag: string) => void }) {
  const { items, opened, unlinked } = blindList(d);
  const pos = items.filter((i) => i.positive), not = items.filter((i) => !i.positive);
  // opened (cleaning or later) while a blind is not recorded in: first to check
  const openNot = not.filter((i) => i.e.stage >= 2), check = openNot.length + opened.length + unlinked.length;
  const [f, setF] = useState<'not' | 'pos' | 'check'>(not.length ? 'not' : 'pos');
  const shown = f === 'not' ? [...openNot, ...not.filter((i) => i.e.stage < 2)] : pos;
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Tile value={`${pos.length}/${items.length}`} label="positively isolated" tone={!not.length ? 'green' : undefined} onClick={() => setF('pos')} />
        <Tile value={not.length} label="not positive" tone={not.length ? 'red' : undefined} onClick={() => setF('not')} />
        <Tile value={check} label="to check" tone={check ? 'amber' : undefined} onClick={() => setF('check')} />
      </div>
      <div className="flex gap-1.5">{([['not', `Not positive ${not.length}`], ['pos', `Positive ${pos.length}`], ['check', `To check ${check}`]] as const).map(([k, l]) =>
        <button key={k} type="button" onClick={() => setF(k)} className={SEG(f === k)}>{l}</button>)}</div>
      {f !== 'check' && (shown.length ? <RowList>{shown.map(({ e, blinds, inN, positive }) =>
        <CRow key={e.id} dot={positive ? 'green' : 'red'} title={e.tag} onTitle={onItem ? () => onItem(e.tag) : undefined}
          sub={positive ? `Positively isolated · ${blinds.length} blind${blinds.length > 1 ? 's' : ''} in` : `${inN}/${blinds.length} in · not positive`}
          extra={<>{e.stage >= 2 && !positive && <span className="rounded bg-amber-200 px-1.5 py-px text-[10px] font-bold text-amber-900">Opened</span>}{blinds.filter((b) => b.state !== 'in').map((b) => <span key={b.id} className="rounded bg-red-100 px-1.5 py-px text-[10px] font-bold text-red-800">{b.kind === 'line' ? b.ref : b.name}</span>)}</>}
          menu={() => <ul className="space-y-1">{blinds.map((b) => <li key={b.id} className="flex items-center gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate">{b.kind === 'line' ? <><b>{b.ref}</b> {b.name}</> : b.name}</span>
            {b.at && <span className="shrink-0 text-[11px] text-slate-500">{when(b.at)}</span>}
            <span className={cx('shrink-0 rounded px-1.5 py-px text-[10px] font-bold', STATE[b.state][1])}>{STATE[b.state][0]}</span></li>)}</ul>} />)}</RowList>
        : <p className="py-3 text-center text-sm text-slate-500">{f === 'not' ? 'Every item with blinds is positively isolated.' : 'No item positively isolated yet.'}</p>)}
      {f === 'check' && <>
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Opened, blind not recorded in · {openNot.length}</h3>
        {openNot.length ? <RowList>{openNot.map(({ e, blinds }) => <CRow key={e.id} dot="amber" title={e.tag} sub={blinds.filter((b) => b.state !== 'in').map((b) => (b.kind === 'line' ? b.ref : b.name)).join(' · ')} onTitle={onItem ? () => onItem(e.tag) : undefined} />)}</RowList>
          : <p className="text-sm text-slate-500">None.</p>}
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Opened, no blind in the lists · {opened.length}</h3>
        {opened.length ? <RowList>{opened.map((e) => <CRow key={e.id} dot="amber" title={e.tag} sub={e.description ?? e.group} onTitle={onItem ? () => onItem(e.tag) : undefined} />)}</RowList>
          : <p className="text-sm text-slate-500">None.</p>}
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Line blinds with no item · {unlinked.length}</h3>
        {unlinked.length ? <RowList>{unlinked.map((p) => <CRow key={p.id} dot="amber" title={`${p.ref} · ${p.name}`} sub={p.status === 'in' ? `✓ In ${when(p.inAt)}` : p.status === 'out' ? 'Out' : 'Not in'} />)}</RowList>
          : <p className="text-sm text-slate-500">None.</p>}
      </>}
      <p className="text-[11px] text-slate-500">Positively isolated = all its blinds are recorded in. The blinds are entered in the blind lists.</p>
    </>
  );
}
