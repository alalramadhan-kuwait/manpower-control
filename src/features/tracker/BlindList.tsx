// Blind list for the startup: by item (its blinds and whether it is positively isolated: all its blinds recorded in)
// or by blind (each blind by type with the items and loops it is linked to). One line per row (there are many); a tap
// shows the detail; the finished ones are folded. Read only; the same page in both modes (Handover).
import { useState, type ReactNode } from 'react';
import { BLIND_TYPE, blindList, blindsByType, type BlindItem, type BlindRow, type BlindType, kwDay, kwTime, type TrkData } from '@/core/tracker';
import { cx } from '@/ui/components';

const when = (iso: string | null) => (iso ? `${kwDay(iso)} ${kwTime(iso)}` : '');
const STATE = { in: ['✓ In', 'bg-green-100 text-green-800'], out: ['Out', 'bg-slate-100 text-slate-600'], not: ['Not in', 'bg-red-100 text-red-800'] } as const;
const short = (t: string) => t.replace(/^([A-Z]{1,3})-12-/, '$1-').replace(/^12-/, '');
type D = Pick<TrkData, 'equipment' | 'loopItems' | 'activities' | 'points'>;
type OnItem = ((tag: string) => void) | undefined;

const Chip = ({ cls, children }: { cls: string; children: ReactNode }) => <span className={cx('shrink-0 rounded px-1.5 py-px text-[10px] font-bold', cls)}>{children}</span>;
const Box = ({ children }: { children: ReactNode }) => <div className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">{children}</div>;
const H = ({ children }: { children: ReactNode }) => <h3 className="mx-1 mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{children}</h3>;
function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [o, setO] = useState(false);
  return <><button type="button" onClick={() => setO((x) => !x)} className="mx-1 block text-[12px] font-semibold text-status-green">{o ? '▾' : '▸'} {label}</button>{o && <Box>{children}</Box>}</>;
}
/** One line: a dot, the tag, a short text, a chip; a tap opens the detail under it. */
function Line({ dot, tag, text, chip, children }: { dot: string; tag: string; text: ReactNode; chip: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="border-b border-slate-100 last:border-b-0">
    <button type="button" onClick={() => setOpen((x) => !x)} disabled={!children} className="flex min-h-9 w-full items-center gap-2 px-2.5 text-left">
      <span className={cx('h-2 w-2 shrink-0 rounded-full', dot)} /><b className="w-[84px] shrink-0 truncate text-[12px]">{tag}</b>
      <span className="min-w-0 flex-1 truncate text-[12px] text-slate-600">{text}</span>{chip}</button>
    {open && children && <div className="mx-2.5 mb-1.5 space-y-1 rounded-lg bg-slate-50 p-2 text-[12px]">{children}</div>}
  </div>;
}
const ItemLink = ({ tag, onItem }: { tag: string; onItem: OnItem }) =>
  <button type="button" onClick={() => onItem?.(tag)} className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-slate-200">{tag} ›</button>;

export function BlindList({ d, onItem }: { d: D; onItem?: (tag: string) => void }) {
  const [by, setBy] = useState<'item' | 'blind'>('item');
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-200/60 p-1">{([['item', 'By item'], ['blind', 'By blind']] as const).map(([k, l]) =>
        <button key={k} type="button" onClick={() => setBy(k)} className={cx('min-h-8 rounded-lg text-xs font-semibold', by === k ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600')}>{l}</button>)}</div>
      {by === 'item' ? <ByItem d={d} onItem={onItem} /> : <ByBlind d={d} onItem={onItem} />}
    </div>
  );
}

const SEG = (on: boolean) => cx('min-h-8 flex-1 rounded-lg px-2 text-[12px] font-semibold ring-1', on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200');

function ItemLine({ i, onItem }: { i: BlindItem; onItem: OnItem }) {
  const missing = i.blinds.filter((b) => b.state !== 'in');
  return <Line dot={i.positive ? 'bg-status-green' : 'bg-status-red'} tag={short(i.e.tag)}
    text={i.positive ? `${i.blinds.length} blind${i.blinds.length > 1 ? 's' : ''} in` : missing.map((b) => (b.kind === 'line' ? b.ref : b.name)).join(' · ')}
    chip={i.positive ? <Chip cls="bg-green-100 text-green-800">Positive</Chip> : <>{i.e.stage >= 2 && <Chip cls="bg-amber-200 text-amber-900">Opened</Chip>}<Chip cls="bg-red-100 text-red-800">{i.inN}/{i.blinds.length}</Chip></>}>
    {i.blinds.map((b) => <p key={b.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate">{b.kind === 'line' ? <><b>{b.ref}</b> {b.name}</> : b.name}</span>
      {b.at && <span className="shrink-0 text-[11px] text-slate-500">{when(b.at)}</span>}<Chip cls={STATE[b.state][1]}>{STATE[b.state][0]}</Chip></p>)}
    <ItemLink tag={i.e.tag} onItem={onItem} />
  </Line>;
}

function ByItem({ d, onItem }: { d: D; onItem: OnItem }) {
  const { items, opened, unlinked } = blindList(d);
  const pos = items.filter((i) => i.positive), not = items.filter((i) => !i.positive);
  // opened (cleaning or later) while a blind is not recorded in: first to check
  const openNot = not.filter((i) => i.e.stage >= 2), check = openNot.length + opened.length + unlinked.length;
  const [f, setF] = useState<'not' | 'check'>('not');
  return (
    <>
      <p className="mx-1 text-[12px] text-slate-600">Positively isolated <b className="text-status-green">{pos.length}/{items.length}</b> · not positive <b className="text-status-red">{not.length}</b>{check ? <> · to check <b className="text-amber-700">{check}</b></> : null}</p>
      <div className="flex gap-1.5">{([['not', `Not positive ${not.length}`], ['check', `To check ${check}`]] as const).map(([k, l]) =>
        <button key={k} type="button" onClick={() => setF(k)} className={SEG(f === k)}>{l}</button>)}</div>
      {f === 'not' && <>
        {not.length ? <Box>{[...openNot, ...not.filter((i) => i.e.stage < 2)].map((i) => <ItemLine key={i.e.id} i={i} onItem={onItem} />)}</Box>
          : <p className="py-2 text-center text-sm text-status-green">Every item with blinds is positively isolated.</p>}
        {pos.length > 0 && <Fold label={`✓ Positively isolated (${pos.length})`}>{pos.map((i) => <ItemLine key={i.e.id} i={i} onItem={onItem} />)}</Fold>}
      </>}
      {f === 'check' && <>
        <H>Opened, blind not recorded in · {openNot.length}</H>
        {openNot.length ? <Box>{openNot.map((i) => <ItemLine key={i.e.id} i={i} onItem={onItem} />)}</Box> : <p className="mx-1 text-sm text-slate-500">None.</p>}
        <H>Opened, no blind in the lists · {opened.length}</H>
        {opened.length ? <Box>{opened.map((e) => <Line key={e.id} dot="bg-amber-500" tag={short(e.tag)} text={e.description ?? e.group} chip={null}><ItemLink tag={e.tag} onItem={onItem} /></Line>)}</Box> : <p className="mx-1 text-sm text-slate-500">None.</p>}
        <H>Line blinds with no item · {unlinked.length}</H>
        {unlinked.length ? <Box>{unlinked.map((p) => { const st = p.status === 'in' ? 'in' : p.status === 'out' ? 'out' : 'not';
          return <Line key={p.id} dot="bg-amber-500" tag={p.ref} text={p.name} chip={<Chip cls={STATE[st][1]}>{STATE[st][0]}</Chip>} />; })}</Box> : <p className="mx-1 text-sm text-slate-500">None.</p>}
      </>}
      <p className="mx-1 text-[11px] text-slate-500">Positively isolated = all its blinds are recorded in. Blinds are entered under Blinds.</p>
    </>
  );
}

function BlindLine({ r, onItem }: { r: BlindRow; onItem: OnItem }) {
  const line = r.type === 'segregation' || r.type === 'hp_critical';
  return <Line dot={r.state === 'in' ? 'bg-status-green' : r.state === 'out' ? 'bg-slate-300' : 'bg-status-red'} tag={line ? r.ref : short(r.ref)}
    text={line ? <>{r.name}{r.items.length ? <span className="text-slate-400"> · {r.items.map(short).join(', ')}</span> : null}</> : r.name}
    chip={<>{line && !r.items.length && <Chip cls="bg-amber-100 text-amber-900">No item</Chip>}<Chip cls={STATE[r.state][1]}>{STATE[r.state][0]}</Chip></>}>
    {line && <p className="text-slate-700">{r.name}</p>}
    {r.at && <p className="text-slate-500">In {when(r.at)}</p>}
    <div className="flex flex-wrap gap-1">{r.items.length ? r.items.map((t) => <ItemLink key={t} tag={t} onItem={onItem} />) : <span className="text-amber-800">No item linked</span>}
      {r.loops.map((l) => <span key={l} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">needed by {l}</span>)}</div>
  </Line>;
}

/** Every blind by type, with the items it isolates and the loops that wait for it. */
function ByBlind({ d, onItem }: { d: D; onItem: OnItem }) {
  const rows = blindsByType(d);
  const [t, setT] = useState<BlindType>('segregation');
  const xs = rows.filter((r) => r.type === t).sort((a, b) => a.ref.localeCompare(b.ref, 'en', { numeric: true }));
  const open = xs.filter((r) => r.state !== 'in'), done = xs.filter((r) => r.state === 'in');
  return (<>
    <div className="grid grid-cols-2 gap-1.5">{BLIND_TYPE.map(([k, l]) => { const all = rows.filter((r) => r.type === k);
      return <button key={k} type="button" onClick={() => setT(k)} className={SEG(t === k)}>{l} <span className="opacity-70">{all.filter((r) => r.state === 'in').length}/{all.length}</span></button>; })}</div>
    {open.length > 0 && <Box>{open.map((r) => <BlindLine key={r.id} r={r} onItem={onItem} />)}</Box>}
    {!xs.length && <p className="py-2 text-center text-sm text-slate-500">No blinds of this type.</p>}
    {xs.length > 0 && !open.length && <p className="py-1 text-center text-sm text-status-green">All in.</p>}
    {done.length > 0 && <Fold label={`✓ In (${done.length})`}>{done.map((r) => <BlindLine key={r.id} r={r} onItem={onItem} />)}</Fold>}
  </>);
}
