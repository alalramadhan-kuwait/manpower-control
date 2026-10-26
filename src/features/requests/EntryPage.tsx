// Requests → Entry: the one place to add or change anything for a person. Five action cards, each a short form sharing
// the same checks: Leave / Absence, PV reschedule, Shift change / cover, Controller assignment, Task release.
// The crews' effect ("B Shift · Field 7 → 6 ✅") and the check show before sending; the server checks again and then
// records it (Section Head, or a type recorded without approval) or sends it to the Section Head (Coordinator).
// Drafts are saved by hand above the cards: they change nothing and never reach Approvals.
// Sick leave, absence without reason (AB) and escort leave are Oracle statistics: they are not entered here.
import { ArrowLeftRight, CalendarClock, CheckCircle2, ClipboardList, Eye, FileText, OctagonX, Pencil, Plane, Search, Trash2, Undo2, UserCheck, UserMinus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { LeaveApproval } from '@/core/controllers/leaveRules';
import { POSITION_LABEL, type CrewImpact } from '@/core/entry';
import { personOn, type MpPerson } from '@/core/manpower';
import { OPEN_CHECK_DAYS, type GateVerdict } from '@/core/requests/gate';
import { CREWS, addDaysIso, isValidIsoDate, type Crew } from '@/core/roster';
import type { Proposal } from '@/core/validation';
import { fetchLeaveApprovals } from '@/data/controllers';
import { deleteDraft, fetchCancellableLeave, fetchDrafts, fetchEntryDetail, fetchEntryTypes, fetchMyEntries, fetchTrackedCases, previewEntry, saveDraft, submitEntry, withdrawEntry,
  type Draft, type EntryDetail, type EntryType, type MyEntry, type TrackedCase } from '@/data/entry';
import { GateBlocked } from '@/data/gate';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import type { UserProfile } from '@/data/types';
import type { Check } from '@/data/validation';
import { t } from '@/i18n';
import { BottomSheet, Button, Chip, ErrorBox, Field, Spinner, cx, type Tone } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';
import { nameFilter } from '@/ui/nameSearch';
import { InWorkspace } from '@/ui/workspace';
import { CheckPanel } from './CheckPanel';
import { ProposeSheet } from './ChangeRequests';
import { mergedLeaves, type MergedLeave } from './leaveTools';
import { fetchOwedLeave, type OwedLeave } from '@/data/changeRequests';
import { ControllerAssign } from '@/features/controllers/ControllersPage';
import { MovementSheet } from '@/features/movements/MovementSheet';
import ReleasePage from '@/features/release/ReleasePage';

type Group = Crew | 'VR';
type Card = 'leave' | 'pv' | 'shift' | 'controller' | 'release';
const CARDS: { k: Card; label: string; desc: string; icon: typeof Plane; person: boolean }[] = [
  { k: 'leave', label: 'Leave / Absence', desc: 'Planned leave, operational absence, extend, return', icon: Plane, person: true },
  { k: 'pv', label: 'PV reschedule', desc: 'Move a PV to other dates, or give new dates to a cancelled one', icon: CalendarClock, person: true },
  { k: 'shift', label: 'Shift change / cover', desc: 'Temporary cover, permanent move, day duty', icon: ArrowLeftRight, person: true },
  { k: 'controller', label: 'Controller assignment', desc: 'Shift cover, Morning rotation, VR placement', icon: UserCheck, person: false },
  { k: 'release', label: 'Task release', desc: 'Release from duty for a task, crew checked first', icon: UserMinus, person: false }
];
const ROLE: Record<string, string> = { controller: 'Controller', vr_controller: 'VR Controller', morning_controller: 'Morning Controller', panel_operator: 'Panel Operator', field_operator: 'Field Operator' };
const STATUS: Record<string, { label: string; tone: Tone; plan: string }> = {
  submitted: { label: 'Waiting', tone: 'blue', plan: 'Plan not changed yet' }, approved: { label: 'Approved', tone: 'green', plan: 'Plan updated' }, recorded: { label: 'Recorded', tone: 'green', plan: 'Plan updated' },
  not_approved: { label: 'Not approved', tone: 'red', plan: 'No change' }, withdrawn: { label: 'Withdrawn', tone: 'neutral', plan: 'No change' }
};
const RECENT_KEY = 'entry.recent';
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]; } catch { return []; } };
const range = (a: string, b: string | null) => (b === null ? `${shortDate(a)} – ${t('return not confirmed')}` : a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
const groupOf = (p: MpPerson, d: string): Group => { const q = personOn(p, d); return q.role === 'vr_controller' || q.role === 'morning_controller' || q.dayDuty || !q.crew ? 'VR' : q.crew; };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Data { inputs: ManpowerInputs; types: EntryType[]; approvals: LeaveApproval[] }

export function EntryPage({ profile }: { profile: UserProfile }) {
  const today = localToday();
  const isHead = profile.role_code === 'section_head';
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [mine, setMine] = useState<MyEntry[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [resume, setResume] = useState<{ draft: Draft | null; prefill: Record<string, unknown> | null; replaces: string | null }>({ draft: null, prefill: null, replaces: null });
  const card = (CARDS.find((c) => c.k === params.get('card'))?.k ?? null) as Card | null;
  const personId = params.get('emp');
  // opened from the Calendar (…&back=<address>): Save, Cancel and Close return there, with its view, month, filters and open item
  const back = params.get('back');
  const navigate = useNavigate();
  const leave = () => { if (back) navigate(back); };
  const setCard = (k: Card | null, emp: string | null = personId, extra: Record<string, string> = {}) => {
    const n = new URLSearchParams({ view: 'entry' });
    if (k) n.set('card', k);
    if (k && emp) n.set('emp', emp);
    for (const [a, b] of Object.entries(extra)) n.set(a, b);
    if (back) n.set('back', back);
    setParams(n, { replace: true });
  };

  const load = useCallback(() => {
    const y = Number(today.slice(0, 4));
    Promise.all([fetchManpowerInputs(addDaysIso(today, -60), `${y + 1}-12-31`), fetchEntryTypes(), fetchLeaveApprovals()])
      .then(([inputs, types, approvals]) => setData({ inputs, types, approvals })).catch(setErr);
    fetchMyEntries(profile.auth_user_id).then(setMine).catch(() => setMine([]));
    fetchDrafts().then(setDrafts).catch(() => setDrafts([]));
  }, [today, profile.auth_user_id]);
  useEffect(load, [load]);

  const done = (m: string) => { if (back) { leave(); return; } setNotice(m); setResume({ draft: null, prefill: null, replaces: null }); setCard(null, null); load(); };
  if (err) return <ErrorBox error={err} />;
  if (!data) return <Spinner />;
  const person = personId ? data.inputs.people.find((p) => p.id === personId) ?? null : null;
  const active = CARDS.find((c) => c.k === card) ?? null;

  return (
    <div className="space-y-4 lg:max-w-3xl">
      {notice && <div role="status" className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-300"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

      {drafts.length > 0 && (
        <section aria-label={t('Drafts')} className="rounded-2xl bg-amber-50/60 p-3 ring-1 ring-amber-200">
          <h2 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-900"><FileText className="h-3.5 w-3.5" />{t('Drafts')} · {drafts.length}</h2>
          <ul className="space-y-1">
            {drafts.map((d) => (
              <li key={d.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-amber-200">
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{shortDate(d.updatedAt.slice(0, 10))}</span>
                <button type="button" className="min-h-9 shrink-0 rounded-lg bg-brand-700 px-3 text-xs font-semibold text-white" onClick={() => { setResume({ draft: d, prefill: d.payload, replaces: null }); setCard(d.kind as Card, d.employeeId); }}>{t('Resume')}</button>
                <button type="button" aria-label={t('Delete draft')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => deleteDraft(d.id).then(load).catch(setErr)}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!active ? (
        <section aria-label={t('What to enter')} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CARDS.map(({ k, label, desc, icon: Icon }) => (
            <button key={k} type="button" onClick={() => { setNotice(null); setCard(k, null); }}
              className="flex min-h-[4.5rem] items-center gap-3 rounded-2xl bg-white p-3 text-start shadow-sm ring-1 ring-slate-200 active:bg-slate-50">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon className="h-5 w-5" /></span>
              <span className="min-w-0"><span className="block font-semibold text-slate-900">{t(label)}</span><span className="block text-xs text-slate-500">{t(desc)}</span></span>
            </button>
          ))}
        </section>
      ) : (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-brand-800"><active.icon className="h-5 w-5" />{t(active.label)}</h2>
            <button type="button" onClick={() => { if (back) { leave(); return; } setResume({ draft: null, prefill: null, replaces: null }); setCard(null, null); }} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" />{t('Close')}</button>
          </div>
          {active.person && !person && <PersonPicker people={data.inputs.people} today={today} onPick={(p) => setCard(active.k, p.id, Object.fromEntries([...params].filter(([k]) => !['view', 'card', 'emp'].includes(k))))} />}
          {active.person && person && <PersonCard person={person} data={data} today={today} onChange={() => setCard(active.k, null)} />}
          {card === 'leave' && person && <LeaveForm key={`${person.id}${resume.draft?.id ?? ''}${resume.replaces ?? ''}`} person={person} data={data} today={today} isHead={isHead} draft={resume.draft} prefill={resume.prefill} replaces={resume.replaces} onDone={done} onDraft={(m) => { setNotice(m); load(); }} />}
          {card === 'pv' && person && <PvCard person={person} data={data} today={today} isHead={isHead} wanted={params.get('leave')} onDone={done} onClose={() => (back ? leave() : setCard(null, null))} />}
          {card === 'shift' && person && <MovementSheet target={{ kind: 'new', employeeId: person.id }} people={data.inputs.people.map((p) => ({ id: p.id, name: p.name, crew: personOn(p, today).crew }))} onClose={() => (back ? leave() : setCard(null, null))} onDone={done} />}
          {card === 'controller' && <ControllerAssign kind={(['cover', 'morning', 'vr'] as const).find((k) => k === params.get('kind')) ?? 'cover'} crew={params.get('crew')} from={params.get('from')} to={params.get('to')} who={params.get('who')} emp={personId} onClose={() => (back ? leave() : setCard(null, null))} onDone={done} />}
          {card === 'controller' && !params.get('kind') && (
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
              {(['cover', 'morning', 'vr'] as const).map((k) => <button key={k} type="button" onClick={() => setCard('controller', null, { kind: k })} className="min-h-10 rounded-lg bg-white font-medium text-slate-700 shadow-sm">{t(k === 'cover' ? 'Shift cover' : k === 'morning' ? 'Morning rotation' : 'VR placement')}</button>)}
            </div>
          )}
          {card === 'release' && <InWorkspace.Provider value><ReleasePage /></InWorkspace.Provider>}
          {active.person && person && card !== 'leave' && card !== 'pv' && (
            <Button variant="secondary" className="w-full" onClick={() => saveDraft({ kind: card!, employeeId: person.id, title: `${t(active.label)} · ${person.name}`, payload: {} }).then(() => { setNotice(t('Draft saved. It changes nothing until you send it.')); load(); }).catch(setErr)}>
              <FileText className="h-4 w-4" />{t('Save draft')}
            </Button>
          )}
        </section>
      )}

      <MyEntries list={mine} people={data.inputs.people} onChanged={(m) => { setNotice(m); load(); }}
        onCorrect={(d) => { setResume({ draft: null, prefill: { ...d.detail, remark: d.remarks ?? '' }, replaces: d.id }); setCard('leave', d.employeeId); }} />
    </div>
  );
}

function PersonPicker({ people, today, onPick }: { people: MpPerson[]; today: string; onPick: (p: MpPerson) => void }) {
  const [group, setGroup] = useState<Group | null>(null);
  const [q, setQ] = useState('');
  const recent = readRecent().map((id) => people.find((p) => p.id === id)).filter((p): p is MpPerson => !!p);
  const pick = (p: MpPerson) => {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([p.id, ...readRecent().filter((x) => x !== p.id)].slice(0, 5))); } catch { /* private window */ }
    onPick(p);
  };
  const list = useMemo(() => {
    const f = nameFilter(q);
    return people.filter((p) => (!group || groupOf(p, today) === group) && f([p.name, p.arabicName, p.employeeNumber])).sort((a, b) => a.name.localeCompare(b.name)).slice(0, q || group ? 60 : 0);
  }, [people, q, group, today]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-1.5">
        {([...CREWS, 'VR'] as Group[]).map((g) => (
          <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(group === g ? null : g)}
            className={cx('min-h-11 rounded-xl text-sm font-semibold ring-1', group === g ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200')}>{g === 'VR' ? t('VR / Day') : g}</button>
        ))}
      </div>
      <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 ring-1 ring-slate-200">
        <Search className="h-4 w-4 text-slate-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Name or number')} className="w-full bg-transparent text-sm outline-none" />
        {q && <button type="button" onClick={() => setQ('')} aria-label={t('Clear')}><X className="h-4 w-4 text-slate-500" /></button>}
      </label>
      {!q && !group && recent.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t('Last used')}</div>
          <div className="flex flex-wrap gap-1.5">{recent.map((p) => <button key={p.id} type="button" onClick={() => pick(p)} className="min-h-9 rounded-full bg-slate-100 px-3 text-sm text-slate-700">{p.name}</button>)}</div>
        </div>
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
          {list.map((p) => (
            <li key={p.id}><button type="button" onClick={() => pick(p)} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2.5 text-start text-sm">
              <span className="font-medium text-slate-800">{p.name}</span>
              <span className="text-xs text-slate-500">{t(ROLE[p.role ?? ''] ?? '')} · {groupOf(p, today) === 'VR' ? t('VR / Day') : `${groupOf(p, today)} ${t('Shift')}`}</span>
            </button></li>
          ))}
        </ul>
      )}
      {(q || group) && list.length === 0 && <p className="text-sm text-slate-500">{t('No one found.')}</p>}
    </div>
  );
}

function PersonCard({ person, data, today, onChange }: { person: MpPerson; data: Data; today: string; onChange: () => void }) {
  const [more, setMore] = useState(false);
  const now = personOn(person, today);
  const grp = groupOf(person, today);
  return (
    <div className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{person.name}</div>
          <div className="text-xs text-slate-600">{t(ROLE[now.role ?? ''] ?? '—')} · {person.employmentType === 'contractor' ? t('Contractor') : person.grade ? `${t('Grade')} ${person.grade}` : t('No grade')} · {grp === 'VR' ? t('VR / Day') : `${grp} ${t('Shift')}`}</div>
        </div>
        <button type="button" onClick={onChange} aria-label={t('Change person')} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
      </div>
      <button type="button" onClick={() => setMore(!more)} className="mt-1 min-h-8 text-xs font-medium text-brand-700">{t(more ? 'Less' : 'More')}</button>
      {more && <div className="mt-1 space-y-0.5 text-xs text-slate-600">
        <div>{t('Number')} {person.employeeNumber}</div>
        <div>{t('Leave ahead')}: {mergedLeaves(data.inputs.absencesAll, person.id).filter((l) => l.end >= today).slice(0, 4).map((l) => `${l.codes.join('/')} ${range(l.start, l.end >= '9999' ? null : l.end)}`).join(' · ') || t('none')}</div>
      </div>}
    </div>
  );
}

// ── Leave / Absence ────────────────────────────────────────────────────────────────────────────────────────────────
type Mode = 'new' | 'extend' | 'return' | 'cancel';
const leaveType = (code: string) => (code === 'annual_leave_unscheduled' ? 'unscheduled_pv' : code === 'personal_qb' ? 'personal_pc' : 'absence') as 'unscheduled_pv' | 'personal_pc' | 'absence';

function LeaveForm({ person, data, today, isHead, draft, prefill, replaces, onDone, onDraft }: { person: MpPerson; data: Data; today: string; isHead: boolean; draft: Draft | null; prefill: Record<string, unknown> | null; replaces: string | null; onDone: (m: string) => void; onDraft: (m: string) => void }) {
  const p = (prefill ?? {}) as Record<string, string | null | undefined>;
  const wantCancel = useSearchParams()[0].get('cancel');
  const [mode, setMode] = useState<Mode>('new');
  const [target, setTarget] = useState<TrackedCase | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; code: string; label: string; start: string; end: string } | null>(null);
  const [code, setCode] = useState(p.absence_type_code ?? '');
  const [start, setStart] = useState(p.start_date ?? today);
  const [endKnown, setEndKnown] = useState(p.end_known === 'no' ? false : p.end_date !== null || !p.absence_type_code);
  const [end, setEnd] = useState(p.end_date ?? today);
  const [est, setEst] = useState(p.estimated_return ?? '');
  const [review, setReview] = useState(p.next_review ?? '');
  const [back, setBack] = useState(today);
  const [remark, setRemark] = useState(p.remark ?? '');
  const [cases, setCases] = useState<TrackedCase[] | null>(null);
  const [cancellable, setCancellable] = useState<{ id: string; code: string; label: string; start: string; end: string }[]>([]);
  const [preview, setPreview] = useState<{ check: Check; impact: CrewImpact[]; verdict: GateVerdict } | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [blocked, setBlocked] = useState<GateBlocked | null>(null);
  useEffect(() => {
    fetchTrackedCases(person.id, today).then(setCases).catch(() => setCases([]));
    fetchCancellableLeave(person.id, today).then((list) => {
      setCancellable(list);
      // opened from the Calendar's leave sheet (…&cancel=<record>): that leave pre-selected; the reason is still required
      const want = list.find((x) => x.id === wantCancel);
      if (want) { setMode('cancel'); setCancelTarget(want); }
    }).catch(() => setCancellable([]));
  }, [person.id, today, wantCancel]);

  const types = data.types;
  const type = types.find((x) => x.code === (mode === 'new' ? code : mode === 'cancel' ? cancelTarget?.code : target?.code)) ?? null;
  const tracked = type?.mode === 'tracked';
  const open = mode === 'new' ? tracked && !endKnown : mode === 'extend' ? !endKnown : false;
  const statistics = types.filter((x) => x.mode === 'statistics');

  const valid = mode === 'cancel' ? !!cancelTarget && remark.trim().length > 0
    : mode === 'return' ? !!target && isValidIsoDate(back) && back > target.start && back <= addDaysIso(today, 1)
    : mode === 'extend' ? !!target && (!endKnown ? true : isValidIsoDate(end) && (target.end === null || end > target.end) && end >= target.start)
    : !!type && isValidIsoDate(start) && (open || (isValidIsoDate(end) && end >= start)) && (!est || est > start);

  const proposal: Proposal | null = useMemo(() => {
    if (!valid || !type) return null;
    const base = { kind: 'absence' as const, employeeId: person.id, typeCode: type.code, typeShort: type.short, typeLabel: type.label };
    if (mode === 'new') return { ...base, start, end: open ? addDaysIso(start, OPEN_CHECK_DAYS) : end };
    if (mode === 'extend' && target && target.end !== null) { const from = addDaysIso(target.end, 1); return { ...base, start: from, end: endKnown ? end : addDaysIso(from, OPEN_CHECK_DAYS) }; }
    return null;
  }, [valid, type, mode, person.id, start, end, open, target, endKnown]);
  const factual = tracked && (mode === 'new' || mode === 'extend');

  useEffect(() => {
    setPreview(null); setErr(null); setBlocked(null);
    if (!proposal) return;
    let live = true; setChecking(true);
    const tm = setTimeout(() => previewEntry(proposal, factual).then((x) => { if (live) setPreview(x); }).catch((e) => { if (live) setErr(e); }).finally(() => { if (live) setChecking(false); }), 300);
    return () => { live = false; clearTimeout(tm); };
  }, [proposal, factual]);

  const route = mode === 'cancel' ? 'approval' : type?.workflow ?? null;
  const label = isHead ? t('Record') : route === 'record_notify' ? t('Record · Section Head told') : route === 'record' ? t('Record') : t('Send for approval');
  const stop = preview ? !preview.verdict.allowed : false;
  const needsPreview = mode === 'new' || (mode === 'extend' && !!target && target.end !== null);

  async function go() {
    if (!type || busy) return;
    setBusy(true); setErr(null); setBlocked(null);
    try {
      if (replaces) await withdrawEntry(replaces, t('Corrected: replaced by a new request'));
      let detail: Record<string, unknown>; let summary: string;
      if (mode === 'new') {
        detail = { absence_type_code: type.code, start_date: start, end_date: open ? null : end, action: 'new', ...(tracked && open ? { estimated_return: est || null, next_review: review || null } : {}) };
        summary = `${type.label} ${range(start, open ? null : end)}`;
      } else if (mode === 'extend' && target) {
        detail = { absence_type_code: type.code, start_date: target.start, end_date: endKnown ? end : null, action: 'extend', target_record_id: target.id, estimated_return: endKnown ? null : est || null, next_review: endKnown ? null : review || null };
        summary = `${type.label} ${t('extended')}: ${range(target.start, endKnown ? end : null)}`;
      } else if (mode === 'return' && target) {
        detail = { absence_type_code: type.code, start_date: target.start, end_date: addDaysIso(back, -1), action: 'return', target_record_id: target.id };
        summary = `${type.label} ${t('return confirmed')}: ${t('back on')} ${shortDate(back)}`;
      } else if (mode === 'cancel' && cancelTarget) {
        detail = { absence_type_code: type.code, start_date: cancelTarget.start, end_date: cancelTarget.end, action: 'cancel', target_record_id: cancelTarget.id };
        summary = `${type.label} ${range(cancelTarget.start, cancelTarget.end)} ${t('cancelled')}`;
      } else return;
      const r = await submitEntry({ type: leaveType(type.code), employeeId: person.id, summary, remarks: remark, detail, workflow: mode === 'cancel' ? 'approval' : null });
      if (draft) await deleteDraft(draft.id).catch(() => undefined);
      onDone(`${person.name} · ${summary}: ${r.status === 'submitted' ? t('sent to the Section Head (the plan changes once approved).') : route === 'record_notify' && !isHead ? t('recorded, the Section Head is told.') : t('recorded, the plan is updated.')}`);
    } catch (e) {
      if (e instanceof GateBlocked) setBlocked(e); else setErr(e);
      setBusy(false);
    }
  }
  async function keepDraft() {
    try {
      await saveDraft({ id: draft?.id ?? null, kind: 'leave', employeeId: person.id, title: `${type?.label ?? t('Leave / Absence')} · ${person.name}${isValidIsoDate(start) ? ` · ${shortDate(start)}` : ''}`,
        payload: { absence_type_code: code, start_date: start, end_date: endKnown ? end : null, end_known: endKnown ? 'yes' : 'no', estimated_return: est, next_review: review, remark } });
      onDraft(t('Draft saved. It changes nothing until you send it.'));
    } catch (e) { setErr(e); }
  }

  const fixed = types.filter((x) => x.mode === 'fixed');
  const trackedTypes = types.filter((x) => x.mode === 'tracked');
  return (
    <div className="space-y-3">
      {cases && cases.length > 0 && (
        <div className="space-y-2">
          {cases.map((c) => (
            <div key={c.id} className="rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-rose-900">{c.label} · {t('version')} {c.version}</div>
                  <div className="text-xs text-rose-900">{range(c.start, c.end)}</div>
                  {c.end === null && <div className="mt-0.5 text-xs text-rose-800">{t('Unavailable until the return is confirmed.')}{c.estimatedReturn ? ` ${t('Estimated return (provisional)')}: ${shortDate(c.estimatedReturn)}.` : ''}{c.nextReview ? ` ${t('Next review')}: ${shortDate(c.nextReview)}.` : ''}</div>}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => { setMode('extend'); setTarget(c); setEndKnown(c.end !== null); setEnd(c.end ? addDaysIso(c.end, 7) : addDaysIso(today, 14)); setEst(c.estimatedReturn ?? ''); setReview(''); }} className={cx('min-h-10 rounded-lg text-sm font-semibold ring-1', mode === 'extend' && target?.id === c.id ? 'bg-rose-700 text-white ring-rose-700' : 'bg-white text-rose-900 ring-rose-300')}>{t('Extend')}</button>
                <button type="button" onClick={() => { setMode('return'); setTarget(c); setBack(today); }} className={cx('min-h-10 rounded-lg text-sm font-semibold ring-1', mode === 'return' && target?.id === c.id ? 'bg-emerald-700 text-white ring-emerald-700' : 'bg-white text-emerald-900 ring-emerald-300')}>{t('Confirm return')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        <button type="button" aria-pressed={mode === 'new'} onClick={() => { setMode('new'); setTarget(null); }} className={cx('min-h-10 rounded-lg font-medium', mode === 'new' ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{t('New leave / absence')}</button>
        <button type="button" aria-pressed={mode === 'cancel'} disabled={!cancellable.length} onClick={() => { setMode('cancel'); setTarget(null); }} className={cx('min-h-10 rounded-lg font-medium disabled:opacity-40', mode === 'cancel' ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{t('Cancel a leave')}</button>
      </div>

      <div className="space-y-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
        {mode === 'new' && <>
          <Field label="Type">
            <select value={code} onChange={(e) => { setCode(e.target.value); const nt = types.find((x) => x.code === e.target.value); if (nt?.mode === 'tracked') { setEndKnown(false); setReview(addDaysIso(today, nt.reviewDays ?? 14)); } else setEndKnown(true); }} className="input">
              <option value="">{t('Choose…')}</option>
              <optgroup label={t('Leave with known dates')}>
                {fixed.map((x) => <option key={x.code} value={x.code}>{x.label}{x.oracle ? ` (${x.oracle})` : ''}{x.workflow === 'approval' ? ` · ${t('approval')}` : ` · ${t('record')}`}</option>)}
              </optgroup>
              <optgroup label={t('Operational absence (return may be unknown)')}>
                {trackedTypes.map((x) => <option key={x.code} value={x.code}>{x.label}{x.oracle ? ` (${x.oracle})` : ''}</option>)}
              </optgroup>
            </select>
          </Field>
          <p className="text-[11px] leading-snug text-slate-500">{t('Not entered here (Oracle statistics only)')}: {statistics.map((x) => x.label).join(', ')}, {t('Absence without reason (AB)')}.</p>
          {tracked && (
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
              <button type="button" aria-pressed={endKnown} onClick={() => setEndKnown(true)} className={cx('min-h-9 rounded-md font-medium', endKnown ? 'bg-white shadow-sm' : 'text-slate-600')}>{t('End date known')}</button>
              <button type="button" aria-pressed={!endKnown} onClick={() => setEndKnown(false)} className={cx('min-h-9 rounded-md font-medium', !endKnown ? 'bg-white shadow-sm' : 'text-slate-600')}>{t('Unknown (open)')}</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} className="input" /></Field>
            {!open && <Field label="To"><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="input" /></Field>}
          </div>
        </>}

        {mode === 'extend' && target && <>
          <div className="text-sm text-slate-700">{t('Extend')}: <b>{target.label}</b> {range(target.start, target.end)}</div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            <button type="button" aria-pressed={endKnown} onClick={() => setEndKnown(true)} className={cx('min-h-9 rounded-md font-medium', endKnown ? 'bg-white shadow-sm' : 'text-slate-600')}>{t('New end date')}</button>
            <button type="button" aria-pressed={!endKnown} onClick={() => setEndKnown(false)} className={cx('min-h-9 rounded-md font-medium', !endKnown ? 'bg-white shadow-sm' : 'text-slate-600')}>{t('Still unknown')}</button>
          </div>
          {endKnown && <Field label="Last day absent"><input type="date" value={end} min={target.end ?? target.start} onChange={(e) => setEnd(e.target.value)} className="input" /></Field>}
        </>}

        {open && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Estimated return (provisional)" hint={t('Shown only; the person stays unavailable until the return is confirmed.')}><input type="date" value={est} min={start} onChange={(e) => setEst(e.target.value)} className="input" /></Field>
            <Field label="Next review" hint={t('A reminder to check on the case, not an end date.')}><input type="date" value={review} min={today} onChange={(e) => setReview(e.target.value)} className="input" /></Field>
          </div>
        )}

        {mode === 'return' && target && <>
          <div className="text-sm text-slate-700">{t('Confirm return')}: <b>{target.label}</b> {range(target.start, target.end)}</div>
          <Field label="Back at work on" hint={t('The absence ends the day before. It can be confirmed once it happened (or for tomorrow).')}><input type="date" value={back} min={addDaysIso(target.start, 1)} max={addDaysIso(today, 1)} onChange={(e) => setBack(e.target.value)} className="input" /></Field>
        </>}

        {mode === 'cancel' && (
          <Field label="Leave to cancel">
            <select className="input" value={cancelTarget?.id ?? ''} onChange={(e) => setCancelTarget(cancellable.find((x) => x.id === e.target.value) ?? null)}>
              <option value="">{t('Choose…')}</option>
              {cancellable.map((x) => <option key={x.id} value={x.id}>{x.label} · {range(x.start, x.end)}</option>)}
            </select>
          </Field>
        )}

        <Field label={mode === 'cancel' ? 'Reason' : 'Remark (optional)'}><textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} className="input py-1.5" /></Field>
      </div>

      {checking && <Spinner label={t('Checking…')} />}
      {preview && <ImpactList impact={preview.impact} />}
      {preview && <CheckPanel check={preview.check} error={null} />}
      {factual && preview && preview.check.findings.some((f) => f.rule === 'crew_minimum') && (
        <p className="rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-900 ring-1 ring-orange-300">{t('The person is not there whatever the paperwork says: it is recorded, and the shortage stays a critical alert until the crew is covered.')}</p>
      )}
      {blocked && <div className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-900 ring-1 ring-red-300"><OctagonX className="mt-0.5 h-4 w-4 shrink-0" />{blocked.message}</div>}
      {err != null && <ErrorBox error={err} />}
      {replaces && <p className="text-xs text-slate-600">{t('Sending this withdraws the request it corrects (both are kept in the history).')}</p>}
      <div className="flex gap-2">
        {mode === 'new' && <Button variant="secondary" className="min-h-12 shrink-0" onClick={keepDraft}><FileText className="h-4 w-4" />{t('Save draft')}</Button>}
        <Button className="min-h-12 flex-1" disabled={!valid || busy || (needsPreview && (!preview || stop))} onClick={go}>
          {stop ? <><OctagonX className="h-4 w-4" />{preview?.verdict.reason?.startsWith('Hard stop') ? t('Hard stop · cannot be sent') : t('Below the minimum · cover the crew first')}</> : busy ? t('Saving…') : label}
        </Button>
      </div>
    </div>
  );
}

// ── PV reschedule ──────────────────────────────────────────────────────────────────────────────────────────────────
function PvCard({ person, data, today, isHead, wanted, onDone, onClose }: { person: MpPerson; data: Data; today: string; isHead: boolean; wanted: string | null; onDone: (m: string) => void; onClose: () => void }) {
  const pv = new Set(data.types.filter((x) => x.mode === 'pv').map((x) => x.code));
  const leaves = mergedLeaves(data.inputs.absences, person.id, new Set(), true).filter((l) => l.end >= today && l.records.some((r) => r.typeCode && pv.has(r.typeCode)));
  const [open, setOpen] = useState<(MergedLeave & { replan?: boolean }) | null>(() => leaves.find((l) => l.start === wanted) ?? null);
  // planned PV cancelled (e.g. for a shutdown) and not given new dates yet
  const [owed, setOwed] = useState<OwedLeave[]>([]);
  useEffect(() => { fetchOwedLeave(person.id).then(setOwed).catch(() => setOwed([])); }, [person.id]);
  if (open) return <ProposeSheet person={person} leave={open} inputs={data.inputs} approvals={data.approvals} today={today} isHead={isHead} onBack={() => (wanted ? onClose() : setOpen(null))} onDone={onDone} />;
  const owe = (o: OwedLeave): MergedLeave & { replan: boolean } => ({ start: o.start, end: o.end, codes: ['PV'], oracle: undefined, estimated: false, replan: true,
    records: [{ id: o.id, employeeId: o.employeeId, start: o.start, end: o.end, status: 'approved', typeCode: o.typeCode, typeShort: 'PV', inCurrentPlan: true }] });
  return (
    <div className="space-y-3">
      {owed.length > 0 && (
        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-300">
          <h3 className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-amber-900">{t('Leave owed')} · {owed.length}</h3>
          <ul className="divide-y divide-amber-200">
            {owed.map((o) => (
              <li key={o.id}>
                <button type="button" disabled={o.open} onClick={() => setOpen(owe(o))} className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2.5 text-start text-sm disabled:opacity-60">
                  <span>PV · <b>{range(o.start, o.end)}</b> <span className="block text-[11px] text-amber-900">{t('Cancelled')}{o.note && /shutdown/i.test(o.note) ? ` · ${t('shutdown')}` : ''}</span></span>
                  <span className="shrink-0 text-xs font-semibold text-brand-700">{o.open ? t('Request open') : t('Give new dates')}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {leaves.length ? (
        <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
          {leaves.map((l) => <li key={l.start}><button type="button" onClick={() => setOpen(l)} className="flex min-h-12 w-full items-center justify-between px-3 py-2.5 text-start text-sm"><span>{l.codes.join(' / ')} · <b>{range(l.start, l.end)}</b></span><span className="text-xs font-semibold text-brand-700">{t('Other dates')}</span></button></li>)}
        </ul>
      ) : <p className="text-sm text-slate-500">{t('No PV ahead to reschedule.')}</p>}
    </div>
  );
}

/** "B Shift · Field 7 → 6 ✅": the crews the change touches, each position before → after against the minimum. */
export function ImpactList({ impact }: { impact: CrewImpact[] }) {
  const touched = impact.filter((c) => c.changed || !c.ok);
  if (!touched.length) return <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">{t('No crew changes on these days.')}</p>;
  return (
    <ul className="space-y-1 rounded-xl bg-white p-3 text-sm ring-1 ring-slate-200">
      {touched.flatMap((c) => c.positions.filter((p) => p.before !== p.after || !p.ok).map((p) => (
        <li key={`${c.crew}-${p.key}`} className={cx('flex items-center justify-between gap-2', p.ok ? 'text-slate-800' : 'text-red-700')}>
          <span><b>{c.crew} {t('Shift')}</b> · {t(POSITION_LABEL[p.key])} {p.before} → {p.after}{!p.ok && p.date ? ` (${t('min')} ${p.min}, ${shortDate(p.date)})` : ''}</span>
          <span aria-label={p.ok ? t('OK') : t('Below minimum')}>{p.ok ? '✅' : '❌'}</span>
        </li>
      )))}
    </ul>
  );
}

// ── My recent entries ──────────────────────────────────────────────────────────────────────────────────────────────
function MyEntries({ list, people, onChanged, onCorrect }: { list: MyEntry[]; people: MpPerson[]; onChanged: (m: string) => void; onCorrect: (d: EntryDetail) => void }) {
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);
  const [view, setView] = useState<EntryDetail | null>(null);
  const names = new Map(people.map((p) => [p.id, p.name]));
  if (!list.length) return null;
  const open = (id: string) => { setErr(null); fetchEntryDetail(id).then(setView).catch(setErr); };
  return (
    <section>
      <h2 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500"><ClipboardList className="h-3.5 w-3.5" />{t('My recent entries')}</h2>
      {err != null && <ErrorBox error={err} />}
      <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
        {list.map((e) => {
          const s = STATUS[e.status] ?? { label: e.status, tone: 'neutral' as Tone, plan: '' };
          return (
            <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <button type="button" onClick={() => open(e.id)} className="min-w-0 flex-1 text-start">
                <div className="truncate font-medium text-slate-800">{names.get(e.employeeId) ?? t('Employee')}</div>
                <div className="truncate text-xs text-slate-500">{e.summary}</div>
                <div className="text-[11px] text-slate-500">{t(s.plan)}{e.source === 'section_head_direct' ? ` · ${t('Section Head direct')}` : ''}</div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <Chip tone={s.tone}>{t(s.label)}</Chip>
                <button type="button" aria-label={t('View request')} title={t('View request')} onClick={() => open(e.id)} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><Eye className="h-4 w-4" /></button>
                {e.status === 'submitted' && (
                  <button type="button" disabled={busy === e.id} aria-label={t('Withdraw')} title={t('Withdraw')} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                    onClick={() => { setBusy(e.id); setErr(null); withdrawEntry(e.id, t('Withdrawn by the requester')).then(() => onChanged(`${e.summary}: ${t('withdrawn')}.`)).catch(setErr).finally(() => setBusy(null)); }}>
                    <Undo2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {view && (
        <BottomSheet open onClose={() => setView(null)} title={t('Request')}>
          <div className="space-y-2 text-sm">
            <div className="font-semibold text-slate-900">{names.get(view.employeeId) ?? ''}</div>
            <div className="text-slate-700">{view.summary}</div>
            <div className="flex flex-wrap gap-1.5"><Chip tone={STATUS[view.status]?.tone}>{t(STATUS[view.status]?.label ?? view.status)}</Chip><Chip>{t(view.workflow === 'approval' ? 'Needs approval' : view.workflow === 'record_notify' ? 'Recorded, Section Head told' : 'Recorded')}</Chip><Chip tone={view.resultId ? 'green' : 'neutral'}>{t(view.resultId ? 'Plan updated' : 'Plan not changed')}</Chip></div>
            <div className="text-xs text-slate-500">{t('Sent')} {new Date(view.requestedAt).toLocaleString()}{view.decidedAt ? ` · ${t('Decided')} ${new Date(view.decidedAt).toLocaleString()}` : ''}</div>
            {view.remarks && <p className="rounded-lg bg-slate-50 p-2 text-slate-700">{view.remarks}</p>}
            {view.decisionNote && <p className="rounded-lg bg-slate-50 p-2 text-slate-700"><b>{t('Section Head')}:</b> {view.decisionNote}</p>}
            {view.findings.length > 0 && <ul className="space-y-1">{view.findings.map((f, i) => <li key={i} className="rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900 ring-1 ring-amber-200">{f.severity}: {f.message}</li>)}</ul>}
            {view.status === 'submitted' && ['absence', 'unscheduled_pv', 'personal_pc'].includes(view.type) && (view.detail.action ?? 'new') === 'new' && (
              <Button variant="secondary" className="w-full" onClick={() => { onCorrect(view); setView(null); }}><Pencil className="h-4 w-4" />{t('Correct this request')}</Button>
            )}
          </div>
        </BottomSheet>
      )}
    </section>
  );
}

export { errText };
