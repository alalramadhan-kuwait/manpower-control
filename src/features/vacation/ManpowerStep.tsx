// Step 1 · Manpower setup: who stands where in the plan year, one shift at a time on a phone (A B C D Relief), all
// four side by side on a wide screen. A tap on a person opens their actions; every change saves at once (Undo in the
// toast and in the header). The employee directory is never changed: this is the plan's own snapshot.
import { Plus, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CREWS, type Crew } from '@/core/roster';
import { GROUP_LABEL, RELIEF_LABEL, type AllocEval, type AllocIssue, type AllocRow, type PlanGroup, type PlanPerson, type ReliefKind } from '@/core/vacation';
import { rowsOf, setAllocation, startAllocation, undoAllocation, type VacationData } from '@/data/vacation';
import { BottomSheet, Button, ErrorBox, cx } from '@/ui/components';
import { CREW_IDENTITY } from '@/ui/crew';
import { PersonSheet } from './PersonSheet';
import { SectionHead, StatusChip, dm, levelOf, type Level } from './parts';
import { SickImportSheet } from './SickImportSheet';
import { DayRotation } from './DayRotation';

type Tab = Crew | 'R';
export const POS_SHORT: Record<string, string> = { controller: 'Controller', vr_controller: 'VR Controller', morning_controller: 'Day Supervisor', panel_operator: 'Panel Op', field_operator: 'Field Op' };

export function ManpowerStep({ d, ev, canEdit, onChanged, toast }: { d: VacationData; ev: AllocEval; canEdit: boolean; onChanged: () => Promise<void>; toast: (m: string, undo?: () => void) => void }) {
  const [tab, setTab] = useState<Tab>('A');
  const [open, setOpen] = useState<string | null>(null);
  const [add, setAdd] = useState<{ crew: Crew | null; group: PlanGroup } | null>(null);
  const [sick, setSick] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const rows = rowsOf(d);
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.employeeId, r])), [rows]);
  const byId = useMemo(() => new Map(d.people.map((p) => [p.id, p])), [d.people]);
  const issuesOf = useMemo(() => { const m = new Map<string, AllocIssue[]>(); for (const i of ev.issues) if (i.employeeId) m.set(i.employeeId, [...(m.get(i.employeeId) ?? []), i]); return m; }, [ev]);
  const draft = !d.alloc || d.alloc.status === 'draft';
  const editable = canEdit && draft;

  async function save(r: AllocRow, msg: string) {
    setBusy(true); setErr(null);
    try {
      if (!d.alloc) await startAllocation(d.year, d.initial);
      const ev = await setAllocation(d.year, r);
      await onChanged();
      toast(msg, async () => { try { await undoAllocation(d.year, ev); await onChanged(); toast('Undone.'); } catch (e) { setErr(e); } });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  async function undoLast() {
    setBusy(true); setErr(null);
    try { await undoAllocation(d.year); await onChanged(); toast('Last change undone.'); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const lastChange = d.events.find((e) => (e.action === 'set' || e.action === 'switch') && !e.undoneAt);
  const sickKnown = d.people.filter((p) => p.sick).length;
  const sickAsOf = d.people.map((p) => p.sick?.asOf).filter(Boolean).sort().at(-1) ?? null;

  const crewLevel = (c: Crew): Level => levelOf(ev.issues.filter((i) => i.crew === c));
  const reliefLevel: Level = levelOf(ev.issues.filter((i) => i.employeeId && rowOf.get(i.employeeId)?.group === 'relief'));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
        <span>{draft ? (d.alloc ? `Draft v${d.alloc.version}` : 'Not started: from the current assignments') : `Approved v${d.alloc!.version}`}</span>
        <button type="button" onClick={() => setSick(true)} className="font-medium text-brand-700 underline-offset-2 hover:underline">Sick leave: {sickKnown ? `${sickKnown} known · ${dm(sickAsOf!)}` : 'none loaded'} ›</button>
        {editable && lastChange && <button type="button" disabled={busy} onClick={undoLast} className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold text-brand-700 ring-1 ring-slate-200"><Undo2 className="h-3.5 w-3.5" />Undo last</button>}
      </div>
      {err != null && <ErrorBox error={err} />}

      {/* phone: one shift at a time */}
      <div role="tablist" className="grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1 lg:hidden">
        {([...CREWS, 'R'] as Tab[]).map((t) => {
          const lv = t === 'R' ? reliefLevel : crewLevel(t);
          return (
            <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cx('flex min-h-10 items-center justify-center gap-1 rounded-lg text-sm font-semibold', tab === t ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>
              {t === 'R' ? 'Relief' : t}
              <span className={cx('h-1.5 w-1.5 rounded-full', lv === 'error' ? 'bg-status-red' : lv === 'warning' ? 'bg-status-amber' : 'bg-status-green')} aria-label={lv} />
            </button>
          );
        })}
      </div>
      <div className="lg:hidden">
        {tab === 'R' ? <ReliefPanel d={d} ev={ev} byId={byId} issuesOf={issuesOf} onOpen={setOpen} editable={editable} onAdd={() => setAdd({ crew: null, group: 'relief' })} />
          : <CrewPanel crew={tab} ev={ev} issuesOf={issuesOf} onOpen={setOpen} editable={editable} onAdd={(g) => setAdd({ crew: tab, group: g })} />}
      </div>
      {/* wide screen: the four shifts side by side, Relief below */}
      <div className="hidden gap-2 lg:grid lg:grid-cols-4">
        {CREWS.map((c) => <CrewPanel key={c} crew={c} ev={ev} issuesOf={issuesOf} onOpen={setOpen} editable={editable} onAdd={(g) => setAdd({ crew: c, group: g })} />)}
      </div>
      <div className="hidden lg:block"><ReliefPanel d={d} ev={ev} byId={byId} issuesOf={issuesOf} onOpen={setOpen} editable={editable} onAdd={() => setAdd({ crew: null, group: 'relief' })} /></div>

      {open && byId.get(open) && (
        <PersonSheet d={d} ev={ev} person={byId.get(open)!} row={rowOf.get(open) ?? null} issues={issuesOf.get(open) ?? []} editable={editable} busy={busy}
          onClose={() => setOpen(null)} onSave={async (r, msg) => { await save(r, msg); }} onChanged={onChanged} toast={toast} />
      )}
      {add && <AddSheet d={d} ev={ev} target={add} onClose={() => setAdd(null)} onPick={async (p) => {
        const cur = rowOf.get(p.id);
        const r: AllocRow = add.group === 'relief'
          ? { employeeId: p.id, group: 'relief', crew: null, relief: p.position === 'vr_controller' || p.position === 'controller' ? 'vr' : p.position === 'panel_operator' ? 'float_panel' : 'day_duty', cycleCrew: cur?.crew ?? cur?.cycleCrew ?? p.dirCrew, acting: 'auto', note: null }
          : { employeeId: p.id, group: add.group, crew: add.crew, relief: null, cycleCrew: null, acting: cur?.acting ?? 'auto', note: null };
        setAdd(null);
        await save(r, `${p.name}: ${add.group === 'relief' ? 'Relief' : `${add.crew} Shift ${GROUP_LABEL[add.group]}`}.`);
      }} />}
      {sick && <SickImportSheet d={d} onClose={() => setSick(false)} onDone={async () => { setSick(false); toast('Sick-leave figures imported.'); await onChanged(); }} />}
    </div>
  );
}

function CrewPanel({ crew, ev, issuesOf, onOpen, editable, onAdd }: { crew: Crew; ev: AllocEval; issuesOf: Map<string, AllocIssue[]>; onOpen: (id: string) => void; editable: boolean; onAdd: (g: PlanGroup) => void }) {
  const c = ev.crews[crew];
  const crewIssues = ev.issues.filter((i) => i.crew === crew && !i.employeeId);
  const lv = levelOf(ev.issues.filter((i) => i.crew === crew));
  return (
    <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <span className={cx('flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white', CREW_IDENTITY[crew].bg)}>{crew}</span>
        <span className="min-w-0 flex-1 text-[12px] tabular-nums text-slate-700">Ctl {c.controllers.length} · Panel {c.panelGroup}{c.acting.length ? ` (${c.acting.length} acting)` : ''} · Field {c.fieldEligible.length}</span>
        <StatusChip level={lv} />
      </div>
      <p className="px-3 pt-1 text-[11px] text-slate-500">Vacation slots per cycle: Panel {c.panelSlots} · Field {c.fieldSlots}</p>
      {crewIssues.length > 0 && <ul className="space-y-0.5 px-3 pt-1">{crewIssues.map((i) => <li key={i.code + i.text} className={cx('text-[11px] font-medium', i.level === 'error' ? 'text-red-700' : 'text-amber-800')}>{i.level === 'error' ? '⛔' : '⚠'} {i.text.replace(`${crew} Shift: `, '')}</li>)}</ul>}
      <Group title="Controller" people={c.controllers} issuesOf={issuesOf} onOpen={onOpen} editable={editable} onAdd={() => onAdd('controller')} />
      <Group title={`Panel · ${c.panelGroup} of 4`} people={[...c.panel, ...c.acting]} acting={new Set(c.acting.map((p) => p.id))} issuesOf={issuesOf} onOpen={onOpen} editable={editable} onAdd={() => onAdd('panel')} />
      <Group title={`Field · ${c.fieldEligible.length}`} people={c.field} issuesOf={issuesOf} onOpen={onOpen} editable={editable} onAdd={() => onAdd('field')} />
    </section>
  );
}

function Group({ title, people, acting, issuesOf, onOpen, editable, onAdd }: { title: string; people: PlanPerson[]; acting?: Set<string>; issuesOf: Map<string, AllocIssue[]>; onOpen: (id: string) => void; editable: boolean; onAdd: () => void }) {
  return (
    <div>
      <SectionHead title={title} right={editable ? <button type="button" onClick={onAdd} className="inline-flex min-h-7 items-center gap-0.5 rounded-md px-1.5 text-[11px] font-semibold normal-case tracking-normal text-brand-700"><Plus className="h-3 w-3" />Add</button> : null} />
      {people.length ? <ul className="divide-y divide-slate-100">{people.map((p) => <PersonRow key={p.id} p={p} acting={acting?.has(p.id)} issues={issuesOf.get(p.id) ?? []} onOpen={() => onOpen(p.id)} />)}</ul>
        : <p className="px-3 pb-2 text-xs text-slate-400">—</p>}
    </div>
  );
}

export function PersonRow({ p, acting, issues, onOpen, extra }: { p: PlanPerson; acting?: boolean; issues: AllocIssue[]; onOpen: () => void; extra?: string }) {
  const lv = levelOf(issues);
  const showSick = acting || (p.position === 'field_operator' && (p.grade ?? 0) >= 13);
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left active:bg-slate-50">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1">
            <b className="text-[13px] text-slate-900">{p.name}</b>
            {acting && <span className="rounded bg-violet-100 px-1 text-[10px] font-bold text-violet-800">Acting</span>}
            {p.employmentType === 'contractor' && <span className="rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-700" title="Contractor">Contractor</span>}
          </span>
          <span className="block text-[11px] tabular-nums text-slate-500">#{p.number} · G{p.grade ?? '—'} · {POS_SHORT[p.position ?? ''] ?? '—'}{extra ? ` · ${extra}` : ''}{showSick ? ` · Sick ${p.sick ? `${p.sick.days} d` : 'n/k'}` : ''}</span>
        </span>
        {lv !== 'ok' && <StatusChip level={lv} label={lv === 'error' ? 'Fix' : 'Check'} />}
      </button>
    </li>
  );
}

function ReliefPanel({ d, ev, byId, issuesOf, onOpen, editable, onAdd }: { d: VacationData; ev: AllocEval; byId: Map<string, PlanPerson>; issuesOf: Map<string, AllocIssue[]>; onOpen: (id: string) => void; editable: boolean; onAdd: () => void }) {
  const kinds: ReliefKind[] = ['vr', 'day_supervisor', 'float_panel', 'day_duty'];
  const [showOut, setShowOut] = useState(false);
  return (
    <div className="space-y-2">
      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <SectionHead title="Relief" right={editable ? <button type="button" onClick={onAdd} className="inline-flex min-h-7 items-center gap-0.5 rounded-md px-1.5 text-[11px] font-semibold normal-case tracking-normal text-brand-700"><Plus className="h-3 w-3" />Add</button> : null} />
        {kinds.map((k) => {
          const list = ev.relief.filter((x) => x.row.relief === k);
          if (!list.length) return null;
          return (
            <div key={k}>
              <p className="px-3 pt-1 text-[11px] font-semibold text-slate-600">{RELIEF_LABEL[k]} · {list.length}</p>
              <ul className="divide-y divide-slate-100">{list.map(({ person, row }) => <PersonRow key={person.id} p={person} issues={issuesOf.get(person.id) ?? []} onOpen={() => onOpen(person.id)} extra={row.cycleCrew ? `rota ${row.cycleCrew}` : 'no rota'} />)}</ul>
            </div>
          );
        })}
        {!ev.relief.length && <p className="px-3 pb-2 text-xs text-slate-500">Nobody in relief.</p>}
      </section>
      <DayRotation d={d} ev={ev} editable={editable} />
      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        <button type="button" onClick={() => setShowOut(!showOut)} className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-[13px] font-semibold text-slate-700">
          <span className="text-slate-500">{showOut ? '▾' : '▸'}</span><span className="flex-1">Not in the plan</span><span className="text-xs font-normal text-slate-500">{ev.excluded.length + d.people.filter((p) => !ev.placed.has(p.id) && !ev.excluded.some((x) => x.person.id === p.id)).length}</span>
        </button>
        {showOut && <ul className="divide-y divide-slate-100">
          {ev.excluded.map(({ person, row }) => <PersonRow key={person.id} p={person} issues={issuesOf.get(person.id) ?? []} onOpen={() => onOpen(person.id)} extra={row.note ?? 'left out'} />)}
          {d.people.filter((p) => !ev.placed.has(p.id) && !ev.excluded.some((x) => x.person.id === p.id)).map((p) => <PersonRow key={p.id} p={byId.get(p.id)!} issues={issuesOf.get(p.id) ?? []} onOpen={() => onOpen(p.id)} extra="not placed" />)}
        </ul>}
      </section>
    </div>
  );
}

/** Add someone to a group: only people who may hold it, with why others cannot. */
function AddSheet({ d, ev, target, onClose, onPick }: { d: VacationData; ev: AllocEval; target: { crew: Crew | null; group: PlanGroup }; onClose: () => void; onPick: (p: PlanPerson) => void }) {
  const rows = rowsOf(d);
  const where = (p: PlanPerson) => { const r = rows.find((x) => x.employeeId === p.id); return !r ? 'not placed' : r.group === 'excluded' ? 'left out' : r.group === 'relief' ? RELIEF_LABEL[r.relief!] : `${r.crew} ${GROUP_LABEL[r.group]}`; };
  const fits = (p: PlanPerson): string | null => {
    const r = rows.find((x) => x.employeeId === p.id);
    if (r && r.group === target.group && r.crew === target.crew) return 'already here';
    if (target.group === 'controller') return ['controller', 'vr_controller', 'morning_controller'].includes(p.position ?? '') || (p.grade ?? 0) >= 15 ? null : 'not a Controller';
    if (target.group === 'panel') return p.position === 'panel_operator' ? (p.panelQualified === 'yes' ? null : 'Panel qualification not Yes') : 'not a Panel Operator (a Field Operator acts through Acting Panel)';
    if (target.group === 'field') return p.position === 'field_operator' ? null : 'not a Field Operator';
    return null;
  };
  const list = d.people.map((p) => ({ p, why: fits(p) })).filter((x) => x.why !== 'already here')
    .sort((a, b) => Number(!!a.why) - Number(!!b.why) || a.p.name.localeCompare(b.p.name));
  const ok = list.filter((x) => !x.why), no = list.filter((x) => x.why);
  void ev;
  return (
    <BottomSheet open title={`Add to ${target.group === 'relief' ? 'Relief' : `${target.crew} Shift ${GROUP_LABEL[target.group]}`}`} onClose={onClose}>
      <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
        {ok.map(({ p }) => (
          <li key={p.id}><button type="button" onClick={() => onPick(p)} className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left">
            <span className="min-w-0 flex-1"><b className="block text-[13px]">{p.name}</b><span className="text-[11px] text-slate-500">#{p.number} · G{p.grade ?? '—'} · now {where(p)}</span></span><Plus className="h-4 w-4 text-brand-700" />
          </button></li>
        ))}
        {!ok.length && <li className="px-3 py-2 text-xs text-slate-500">Nobody else may hold this place.</li>}
      </ul>
      {no.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-slate-600">Not eligible · {no.length}</summary>
        <ul className="mt-1 space-y-0.5">{no.slice(0, 40).map(({ p, why }) => <li key={p.id} className="text-slate-500">{p.name}: {why}</li>)}</ul></details>}
      <Button variant="secondary" className="mt-3 w-full" onClick={onClose}>Close</Button>
    </BottomSheet>
  );
}
