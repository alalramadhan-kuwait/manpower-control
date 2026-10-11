// Entry: the Coordinator's one place to put in a change for one person. Pick the shift and the person, the type, the
// dates; the crews' effect ("B Shift · Field 7 → 6") and the check show at once; the button follows the type's route.
import { CheckCircle2, OctagonX, Search, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeaveApproval } from '@/core/controllers/leaveRules';
import { POSITION_LABEL, type CrewImpact } from '@/core/entry';
import { DAY_DUTY, personOn, type MpPerson } from '@/core/manpower';
import { CREWS, addDaysIso, isValidIsoDate, type Crew } from '@/core/roster';
import { hasHardStop, type Proposal } from '@/core/validation';
import { submitApproval } from '@/data/approvals';
import { fetchLeaveApprovals } from '@/data/controllers';
import { fetchEntryTypes, fetchMyEntries, previewEntry, submitLeaveEntry, withdrawEntry, type EntryType, type MyEntry } from '@/data/entry';
import { fetchManpowerInputs, type ManpowerInputs } from '@/data/manpower';
import type { UserProfile } from '@/data/types';
import type { Check } from '@/data/validation';
import { Button, Chip, ErrorBox, Field, Spinner, cx, type Tone } from '@/ui/components';
import { localToday, shortDate } from '@/ui/leave';
import { nameFilter } from '@/ui/nameSearch';
import { CheckPanel } from './CheckPanel';
import { ProposeSheet } from './ChangeRequests';
import { mergedLeaves, type MergedLeave } from './leaveTools';

type Group = Crew | 'VR';
type Kind = 'pv_reschedule' | 'unscheduled_pv' | 'personal_pc' | 'absence' | 'shift_change';
const KINDS: { k: Kind; label: string }[] = [
  { k: 'pv_reschedule', label: 'PV reschedule' }, { k: 'unscheduled_pv', label: 'Unscheduled PV' }, { k: 'personal_pc', label: 'Personal PC' },
  { k: 'absence', label: 'Absence' }, { k: 'shift_change', label: 'Shift change' }
];
const FIXED_CODE: Partial<Record<Kind, string>> = { unscheduled_pv: 'annual_leave_unscheduled', personal_pc: 'personal_qb' };
const ROLE: Record<string, string> = { controller: 'Controller', vr_controller: 'VR Controller', morning_controller: 'Morning Controller', panel_operator: 'Panel Operator', field_operator: 'Field Operator' };
const STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: 'Waiting', tone: 'blue' }, approved: { label: 'Approved', tone: 'green' }, recorded: { label: 'Recorded', tone: 'green' },
  not_approved: { label: 'Not approved', tone: 'red' }, withdrawn: { label: 'Withdrawn', tone: 'neutral' }
};
const RECENT_KEY = 'entry.recent';
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]; } catch { return []; } };
const range = (a: string, b: string) => (a === b ? shortDate(a) : `${shortDate(a)} – ${shortDate(b)}`);
const groupOf = (p: MpPerson, d: string): Group | null => { const q = personOn(p, d); return q.role === 'vr_controller' || q.role === 'morning_controller' || q.dayDuty || !q.crew ? 'VR' : q.crew; };

export function EntryPage({ profile }: { profile: UserProfile }) {
  const today = localToday();
  const isHead = profile.role_code === 'section_head';
  const [data, setData] = useState<{ inputs: ManpowerInputs; types: EntryType[]; approvals: LeaveApproval[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [mine, setMine] = useState<MyEntry[]>([]);
  const [group, setGroup] = useState<Group | null>(null);
  const [q, setQ] = useState('');
  const [person, setPerson] = useState<MpPerson | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(readRecent);

  const load = useCallback(() => {
    const y = Number(today.slice(0, 4));
    Promise.all([fetchManpowerInputs(addDaysIso(today, -30), `${y + 1}-12-31`), fetchEntryTypes(), fetchLeaveApprovals()])
      .then(([inputs, types, approvals]) => setData({ inputs, types, approvals })).catch(setErr);
    fetchMyEntries(profile.auth_user_id).then(setMine).catch(() => setMine([]));
  }, [today, profile.auth_user_id]);
  useEffect(load, [load]);

  const pick = (p: MpPerson) => {
    setPerson(p); setNotice(null);
    const next = [p.id, ...recent.filter((x) => x !== p.id)].slice(0, 5);
    setRecent(next); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private window */ }
  };
  const names = useMemo(() => new Map((data?.inputs.people ?? []).map((p) => [p.id, p.name])), [data]);
  const list = useMemo(() => {
    if (!data) return [];
    const f = nameFilter(q);
    return data.inputs.people.filter((p) => (!group || groupOf(p, today) === group) && f([p.name, p.arabicName, p.employeeNumber]))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, q || group ? 60 : 0);
  }, [data, q, group, today]);

  if (err) return <ErrorBox error={err} />;
  if (!data) return <Spinner />;
  const recentPeople = recent.map((id) => data.inputs.people.find((p) => p.id === id)).filter((p): p is MpPerson => !!p);

  return (
    <div className="space-y-4 lg:max-w-3xl">
      {notice && <div className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-300"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}
      {person
        ? <EntryForm person={person} data={data} today={today} isHead={isHead} onClose={() => setPerson(null)} onDone={(m) => { setNotice(m); setPerson(null); load(); }} />
        : (
          <section className="space-y-3">
            <div className="grid grid-cols-5 gap-1.5">
              {([...CREWS, 'VR'] as Group[]).map((g) => (
                <button key={g} type="button" onClick={() => setGroup(group === g ? null : g)}
                  className={cx('min-h-11 rounded-xl text-sm font-semibold ring-1', group === g ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200')}>
                  {g === 'VR' ? 'VR / Day' : g}
                </button>
              ))}
            </div>
            <label className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 ring-1 ring-slate-200">
              <Search className="h-4 w-4 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or number" className="w-full bg-transparent text-sm outline-none" />
              {q && <button type="button" onClick={() => setQ('')} aria-label="Clear"><X className="h-4 w-4 text-slate-400" /></button>}
            </label>
            {!q && !group && recentPeople.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Last used</div>
                <div className="flex flex-wrap gap-1.5">
                  {recentPeople.map((p) => <button key={p.id} type="button" onClick={() => pick(p)} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-700">{p.name}</button>)}
                </div>
              </div>
            )}
            {list.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
                {list.map((p) => (
                  <li key={p.id}><button type="button" onClick={() => pick(p)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm">
                    <span className="font-medium text-slate-800">{p.name}</span>
                    <span className="text-xs text-slate-500">{ROLE[p.role ?? ''] ?? ''} · {groupOf(p, today) === 'VR' ? 'VR / Day' : `${groupOf(p, today)} Shift`}</span>
                  </button></li>
                ))}
              </ul>
            )}
            {(q || group) && list.length === 0 && <p className="text-sm text-slate-500">No one found.</p>}
          </section>
        )}
      <MyEntries list={mine} names={names} onWithdrawn={(m) => { setNotice(m); load(); }} />
    </div>
  );
}

function EntryForm({ person, data, today, isHead, onClose, onDone }: { person: MpPerson; data: { inputs: ManpowerInputs; types: EntryType[]; approvals: LeaveApproval[] }; today: string; isHead: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [more, setMore] = useState(false);
  const [code, setCode] = useState('');
  const [start, setStart] = useState(today); const [end, setEnd] = useState(today);
  const [to, setTo] = useState<Crew | 'DAY'>('A'); const [moveKind, setMoveKind] = useState<'temporary' | 'permanent'>('temporary');
  const [remark, setRemark] = useState('');
  const [leave, setLeave] = useState<MergedLeave | null>(null);
  const [preview, setPreview] = useState<{ check: Check; impact: CrewImpact[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const now = personOn(person, today);
  const grp = groupOf(person, today);

  const absenceTypes = data.types.filter((t) => t.workflow && !Object.values(FIXED_CODE).includes(t.code));
  const typeCode = kind ? FIXED_CODE[kind] ?? code : '';
  const type = data.types.find((t) => t.code === typeCode) ?? null;
  const valid = isValidIsoDate(start) && (kind === 'shift_change' && moveKind === 'permanent' ? true : isValidIsoDate(end) && end >= start);
  const proposal: Proposal | null = useMemo(() => {
    if (!kind || kind === 'pv_reschedule' || !valid) return null;
    if (kind === 'shift_change') return { kind: 'move', employeeId: person.id, start, end: moveKind === 'permanent' ? null : end, crew: to === 'DAY' ? DAY_DUTY : to, moveKind };
    if (!type) return null;
    return { kind: 'absence', employeeId: person.id, start, end, typeCode: type.code, typeShort: type.short, typeLabel: type.label };
  }, [kind, valid, person.id, start, end, moveKind, to, type]);

  useEffect(() => {
    setPreview(null); setErr(null);
    if (!proposal) return;
    let live = true; setChecking(true);
    const t = setTimeout(() => previewEntry(proposal).then((p) => { if (live) setPreview(p); }).catch((e) => { if (live) setErr(e); }).finally(() => { if (live) setChecking(false); }), 300);
    return () => { live = false; clearTimeout(t); };
  }, [proposal]);

  const route = kind === 'shift_change' ? 'approval' : type?.workflow ?? null;
  const stop = preview ? hasHardStop(preview.check.findings) : false;
  const label = isHead || route === 'record' || route === 'record_notify' ? (route === 'record_notify' ? 'Record · Section Head told' : 'Record') : 'Send for approval';

  async function go() {
    if (!proposal || !preview) return;
    setBusy(true); setErr(null);
    try {
      if (kind === 'shift_change') {
        const what = `${person.name}: ${to === 'DAY' ? 'day duty' : `${to} Shift`} from ${shortDate(start)}${moveKind === 'temporary' ? ` to ${shortDate(end)}` : ' (permanent)'}`;
        const r = await submitApproval({ kind: 'movement', employee: person.id, start, end: moveKind === 'permanent' ? null : end, summary: what, payload: { to, kind: moveKind, reason: remark.trim() || null } });
        onDone(r.status === 'approved' ? `${what}: done.` : `${what}: sent to the Section Head.`);
      } else if (type) {
        const r = await submitLeaveEntry({ type: kind as 'unscheduled_pv' | 'personal_pc' | 'absence', employee: person.id, code: type.code, start, end, summary: `${type.label} ${range(start, end)}`, remark, check: preview.check });
        onDone(`${person.name} · ${type.label} ${range(start, end)}: ${r.status === 'submitted' ? 'sent to the Section Head.' : route === 'record_notify' && !isHead ? 'recorded, the Section Head is told.' : 'recorded.'}`);
      }
    } catch (e) { setErr(e); setBusy(false); }
  }

  if (leave) return <ProposeSheet person={person} leave={leave} inputs={data.inputs} approvals={data.approvals} today={today} onBack={() => setLeave(null)} onDone={onDone} />;
  const leaves = mergedLeaves(data.inputs.absencesAll, person.id).filter((l) => l.end >= today && l.codes.some((c) => c === 'PV' || c === 'AL'));

  return (
    <section className="space-y-3">
      <div className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-slate-900">{person.name}</div>
            <div className="text-xs text-slate-600">{ROLE[now.role ?? ''] ?? '—'} · {person.employmentType === 'contractor' ? 'Contractor' : person.grade ? `Grade ${person.grade}` : 'No grade'} · {grp === 'VR' ? 'VR / Day' : `${grp} Shift`}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Change person" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <button type="button" onClick={() => setMore(!more)} className="mt-1 text-xs font-medium text-brand-700">{more ? 'Less' : 'More'}</button>
        {more && <div className="mt-1 space-y-0.5 text-xs text-slate-600">
          <div>Number {person.employeeNumber}</div>
          <div>Take charge {person.takeCharge ?? '—'} · Panel {person.panelQualified ?? '—'} · Acting Controller {person.actingController ?? '—'}</div>
          <div>Leave ahead: {mergedLeaves(data.inputs.absencesAll, person.id).filter((l) => l.end >= today).slice(0, 4).map((l) => `${l.codes.join('/')} ${range(l.start, l.end)}`).join(' · ') || 'none'}</div>
        </div>}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {KINDS.map(({ k, label: l }) => (
          <button key={k} type="button" onClick={() => { setKind(k); setCode(''); }}
            className={cx('min-h-10 rounded-xl px-3 text-sm font-medium ring-1', kind === k ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-200')}>{l}</button>
        ))}
      </div>

      {kind === 'pv_reschedule' && (leaves.length
        ? <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
            {leaves.map((l) => <li key={l.start}><button type="button" onClick={() => setLeave(l)} className="flex w-full justify-between px-3 py-2.5 text-left text-sm"><span>{l.codes.join(' / ')} · <b>{range(l.start, l.end)}</b></span><span className="text-xs text-brand-700">Other dates</span></button></li>)}
          </ul>
        : <p className="text-sm text-slate-500">No PV ahead to reschedule.</p>)}

      {kind && kind !== 'pv_reschedule' && (
        <div className="space-y-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
          {kind === 'absence' && (
            <Field label="Type">
              <select value={code} onChange={(e) => setCode(e.target.value)} className="min-h-10 w-full rounded-lg border border-slate-300 px-2 text-sm">
                <option value="">Choose…</option>
                {absenceTypes.map((t) => <option key={t.code} value={t.code}>{t.label}{t.workflow === 'approval' ? ' · approval' : t.workflow === 'record_notify' ? ' · record + tell' : ' · record'}</option>)}
              </select>
            </Field>
          )}
          {kind === 'shift_change' && (
            <>
              <Field label="To">
                <div className="grid grid-cols-5 gap-1.5">
                  {([...CREWS, 'DAY'] as (Crew | 'DAY')[]).map((c) => <button key={c} type="button" onClick={() => setTo(c)} className={cx('min-h-10 rounded-lg text-sm font-semibold ring-1', to === c ? 'bg-brand-700 text-white ring-brand-700' : 'ring-slate-200')}>{c === 'DAY' ? 'Day' : c}</button>)}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
                {(['temporary', 'permanent'] as const).map((m) => <button key={m} type="button" onClick={() => setMoveKind(m)} className={cx('min-h-9 rounded-md font-medium', moveKind === m ? 'bg-white shadow-sm' : 'text-slate-600')}>{m === 'temporary' ? 'Temporary' : 'Permanent'}</button>)}
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} className="min-h-10 w-full rounded-lg border border-slate-300 px-2 text-sm" /></Field>
            {!(kind === 'shift_change' && moveKind === 'permanent') && <Field label="To"><input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="min-h-10 w-full rounded-lg border border-slate-300 px-2 text-sm" /></Field>}
          </div>
          <Field label="Remark (optional)"><textarea value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" /></Field>
        </div>
      )}

      {checking && <Spinner label="Checking…" />}
      {preview && <ImpactList impact={preview.impact} />}
      {preview && <CheckPanel check={preview.check} error={null} />}
      {err != null && <ErrorBox error={err} />}
      {proposal && (
        <Button className="min-h-12 w-full" disabled={!preview || stop || busy || (kind === 'absence' && !code)} onClick={go}>
          {stop ? <><OctagonX className="h-4 w-4" /> Hard stop · cannot be sent</> : busy ? 'Saving…' : label}
        </Button>
      )}
    </section>
  );
}

/** "B Shift · Field 7 → 6 ✅": the crews the change touches, each position before → after against the minimum. */
export function ImpactList({ impact }: { impact: CrewImpact[] }) {
  const touched = impact.filter((c) => c.changed || !c.ok);
  if (!touched.length) return <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">No crew changes on these days.</p>;
  return (
    <ul className="space-y-1 rounded-xl bg-white p-3 text-sm ring-1 ring-slate-200">
      {touched.flatMap((c) => c.positions.filter((p) => p.before !== p.after || !p.ok).map((p) => (
        <li key={`${c.crew}-${p.key}`} className={cx('flex items-center justify-between gap-2', p.ok ? 'text-slate-800' : 'text-red-700')}>
          <span><b>{c.crew} Shift</b> · {POSITION_LABEL[p.key]} {p.before} → {p.after}{!p.ok && p.date ? ` (min ${p.min}, ${shortDate(p.date)})` : ''}</span>
          <span>{p.ok ? '✅' : '❌'}</span>
        </li>
      )))}
    </ul>
  );
}

function MyEntries({ list, names, onWithdrawn }: { list: MyEntry[]; names: Map<string, string>; onWithdrawn: (m: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<unknown>(null);
  if (!list.length) return null;
  return (
    <section>
      <h2 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">My recent entries</h2>
      {err != null && <ErrorBox error={err} />}
      <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200">
        {list.map((e) => {
          const s = STATUS[e.status] ?? { label: e.status, tone: 'neutral' as Tone };
          return (
            <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{names.get(e.employeeId) ?? 'Employee'}</div>
                <div className="truncate text-xs text-slate-500">{e.summary}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Chip tone={s.tone}>{s.label}</Chip>
                {e.status === 'submitted' && (
                  <button type="button" disabled={busy === e.id} aria-label="Withdraw" title="Withdraw" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                    onClick={() => { setBusy(e.id); setErr(null); withdrawEntry(e.id, 'Withdrawn by the Coordinator').then(() => onWithdrawn(`${e.summary}: withdrawn.`)).catch(setErr).finally(() => setBusy(null)); }}>
                    <Undo2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
