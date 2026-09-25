// Notification Center: what needs attention in the coming weeks, built from what the app already works out
// (manpower by day, Controller cover needs, open leave requests, staff records needing action). Nothing is
// stored: an item disappears as soon as the thing behind it is resolved.
import { attentionPeriods } from '../calendar';
import type { CoverageNeed } from '../controllers';
import type { DayResult, MpAbsence, MpPerson } from '../manpower';
import type { OperationPlan } from '../modes';
import { oracleDue } from '../oracle';

/** action: someone has to do something (counts in the badge) · watch: check it · info: good to know. */
export type NoticeLevel = 'action' | 'watch' | 'info';
export interface Notice {
  id: string;
  level: NoticeLevel;
  area: 'shortage' | 'controller' | 'request' | 'data' | 'leave' | 'mode';
  title: string;
  detail: string;
  /** First date concerned (for sorting); null when not about a date. */
  date: string | null;
  to: string;
}

export interface NoticeRequest { id: string; employeeName: string; typeLabel: string; start: string; end: string; status: 'submitted' | 'reviewed'; overtime: boolean | null }

export interface NoticeInput {
  today: string;
  /** Evaluated days from today onward (the horizon). */
  days: DayResult[];
  needs: CoverageNeed[];
  requests: NoticeRequest[];
  /** Staff whose records need action (Employees → Needs action). */
  needsAction: number;
  absences: MpAbsence[];
  people: MpPerson[];
  plan: OperationPlan;
  isSectionHead: boolean;
  /** Leave starting within this many days is listed (info). */
  leaveDays?: number;
  /** Leave starting within this many days and not approved in Oracle HR is flagged. */
  oracleDays?: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const d = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const span = (a: string, b: string) => (a === b ? d(a) : `${d(a)} – ${d(b)}`);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const when = (today: string, date: string) => { const n = daysBetween(today, date); return n <= 0 ? 'now' : n === 1 ? 'tomorrow' : `in ${n} days`; };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function buildNotices(i: NoticeInput): Notice[] {
  const out: Notice[] = [];
  const names = new Map(i.people.map((p) => [p.id, p.name]));

  // 1. confirmed shortages and incomplete data, as periods per crew
  for (const p of attentionPeriods(i.days)) {
    if (p.kind === 'shortage') out.push({ id: `short-${p.crew}-${p.start}`, level: 'action', area: 'shortage', title: `${p.crew} Shift short · ${p.text}`,
      detail: `${span(p.start, p.end)} · ${plural(p.duties, 'duty')} · ${when(i.today, p.start)}`, date: p.start, to: `/?date=${p.start}` });
    else if (p.kind === 'data_incomplete') out.push({ id: `data-${p.crew}-${p.start}`, level: 'watch', area: 'data', title: `${p.crew} Shift · data to confirm`,
      detail: span(p.start, p.end), date: p.start, to: '/review' });
  }

  // 2. Controller cover (crew Controller away, or the Morning post empty)
  for (const n of i.needs) {
    const vr = n.additional ? 'Extra Controller needed' : n.vr ? `VR free: ${n.vr.name}` : n.vrNote ?? '';
    if (n.kind === 'crew') out.push({ id: `cover-${n.crew}-${n.start}`, level: 'action', area: 'controller', title: `Cover needed · ${n.crew} Shift`,
      detail: [`${span(n.start, n.end)} · ${n.who.join(', ')} · ${when(i.today, n.start)}`, vr].filter(Boolean).join(' · '), date: n.start, to: `/controllers?assign=cover&crew=${n.crew}&from=${n.start}` });
    else out.push({ id: `morning-${n.start}`, level: 'action', area: 'controller', title: 'Morning Controller post empty',
      detail: span(n.start, n.end), date: n.start, to: `/controllers?assign=morning&from=${n.start}` });
  }

  // 3. open leave requests: to review (Coordinator or Section Head), then the Section Head's decision
  for (const r of i.requests) {
    const what = `${r.employeeName} · ${r.typeLabel} ${span(r.start, r.end)}`;
    if (r.status === 'submitted') out.push({ id: `req-${r.id}`, level: 'action', area: 'request', title: 'Request to review', detail: what, date: r.start, to: `/requests/${r.id}` });
    else out.push({ id: `req-${r.id}`, level: i.isSectionHead ? 'action' : 'watch', area: 'request', title: i.isSectionHead ? 'Waiting for your decision' : 'Waiting for the Section Head',
      detail: `${what}${r.overtime === true ? ' · overtime' : r.overtime === false ? ' · no overtime' : ''}`, date: r.start, to: `/requests/${r.id}` });
  }

  // 4. staff records needing action
  if (i.needsAction > 0) out.push({ id: 'staff-action', level: 'watch', area: 'data', title: `${plural(i.needsAction, 'staff record')} to complete`,
    detail: 'Grade · Take-Charge · Panel · KNPC / contractor', date: null, to: '/employees?view=action' });

  // 5. operating periods now or starting within 14 days
  for (const p of i.plan.periods.filter((x) => x.status === 'active' && x.end >= i.today && daysBetween(i.today, x.start) <= 14)) {
    const m = i.plan.modes.find((x) => x.code === p.modeCode);
    out.push({ id: `mode-${p.id}`, level: 'info', area: 'mode', title: `${m?.label ?? p.modeCode} ${p.start <= i.today ? 'now' : when(i.today, p.start)}`,
      detail: `${span(p.start, p.end)}${m ? ` · Controller ${m.controllerMin} · Panel ${m.panelMin} · Field ${m.fieldMin}` : ''}${p.note ? ` · ${p.note}` : ''}`, date: p.start, to: '/operation' });
  }

  // 6. leave starting soon (counted leave only)
  const soon = i.leaveDays ?? 7;
  const starting = i.absences.filter((a) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && a.start > i.today && daysBetween(i.today, a.start) <= soon && names.has(a.employeeId))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (starting.length) out.push({ id: `leave-${i.today}`, level: 'info', area: 'leave', title: `${plural(starting.length, 'leave')} starting · next ${soon} days`,
    detail: starting.slice(0, 6).map((a) => `${names.get(a.employeeId)} (${a.typeShort ?? 'Leave'}) ${d(a.start)}`).join(' · ') + (starting.length > 6 ? ` · and ${starting.length - 6} more` : ''), date: starting[0].start, to: '/leave-plan' });

  // 7. Oracle HR: rejected leave, and leave starting soon that Oracle has not approved yet
  const tracked = i.absences.filter((a) => (a.status === 'approved' || a.status === 'planned') && a.inCurrentPlan !== false && a.oracle && names.has(a.employeeId))
    .map((a) => ({ ...a, id: a.id ?? `${a.employeeId}${a.start}`, oracle: a.oracle! }));
  const due = oracleDue(tracked, i.today, i.oracleDays ?? 30);
  const list = (xs: typeof due) => xs.slice(0, 4).map((a) => `${names.get(a.employeeId)} ${d(a.start)}`).join(' · ') + (xs.length > 4 ? ` · +${xs.length - 4} more` : '');
  const rejected = due.filter((a) => a.oracle === 'rejected');
  const waiting = due.filter((a) => a.oracle !== 'rejected');
  if (rejected.length) out.push({ id: `oracle-rej-${i.today}`, level: 'action', area: 'leave', title: `${plural(rejected.length, 'leave')} rejected in Oracle`,
    detail: list(rejected), date: rejected[0].start, to: '/oracle?s=rejected' });
  if (waiting.length) out.push({ id: `oracle-${i.today}`, level: 'action', area: 'leave', title: `${plural(waiting.length, 'leave')} not approved in Oracle · next ${i.oracleDays ?? 30} days`,
    detail: list(waiting), date: waiting[0].start, to: waiting.some((a) => a.oracle === 'not_submitted') ? '/oracle' : '/oracle?s=submitted' });

  const rank: Record<NoticeLevel, number> = { action: 0, watch: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.title.localeCompare(b.title));
}

export const actionCount = (n: Notice[]) => n.filter((x) => x.level === 'action').length;
