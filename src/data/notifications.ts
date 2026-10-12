// Notification Center data: gathers the next weeks' manpower, cover needs, open requests and staff records
// needing action, and builds the notices (src/core/notifications). Cached briefly so the header badge is cheap.
import { actionsFor } from '@/core/actions';
import { fetchIncompleteShutdowns } from './shutdown';
import { coverageNeeds } from '@/core/controllers';
import { evaluateRange } from '@/core/manpower';
import { buildNotices, type Notice } from '@/core/notifications';
import { REQUEST_TYPE_LABEL } from '@/core/requests';
import { addDaysIso } from '@/core/roster';
import { OPEN_END } from '@/core/leave';
import { fetchManpowerInputs } from './manpower';
import { fetchControllerLeave } from './controllers';
import { checkControllerLeave, openIssues } from '@/core/controllers/leaveRules';
import { fetchDirectory } from './queries';
import { fetchChangeRequests, isChangeOpen } from './changeRequests';
import { fetchEstimatedLeaves } from './leave';
import { fetchRequests, isOpen } from './requests';
import { fetchOpenCases, fetchRecordedNotices } from './entry';
import { supabase } from './supabase';
import { issueLevel, type NoticeInput } from '@/core/notifications';

export const NOTICE_HORIZON_DAYS = 60;
const TTL = 3 * 60 * 1000;
let cache: { key: string; at: number; notices: Notice[] } | null = null;
let pending: Promise<Notice[]> | null = null;
// any write elsewhere in the app clears the cache before the header badge reloads
if (typeof window !== 'undefined') window.addEventListener('notices-changed', () => { cache = null; });

const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function loadNotices(isSectionHead: boolean, force = false): Promise<Notice[]> {
  const today = localToday();
  const key = `${today}|${isSectionHead}`;
  if (!force && cache && cache.key === key && Date.now() - cache.at < TTL) return cache.notices;
  if (!force && pending) return pending;
  pending = (async () => {
    const to = addDaysIso(today, NOTICE_HORIZON_DAYS);
    const y = Number(today.slice(0, 4));
    const [inputs, reqs, changes, estimated, dir, ctl, sds, recorded, openCases] = await Promise.all([fetchManpowerInputs(today, addDaysIso(to, 1)), fetchRequests(), fetchChangeRequests(), fetchEstimatedLeaves(), fetchDirectory(), fetchControllerLeave(`${y}-01-01`, `${y + 1}-12-31`),
      fetchIncompleteShutdowns(today).catch(() => []), fetchRecordedNotices(addDaysIso(today, -7)).catch(() => []), fetchOpenCases().catch(() => [])]);
    const open = openIssues(checkControllerLeave(ctl.people, ctl.absences, ctl.approvals, [y, y + 1]), today);
    const who = (id: string) => ctl.people.find((p) => p.id === id)?.name ?? 'Controller';
    const names = new Map(dir.map((r) => [r.id, r.display_name]));
    const input: NoticeInput = {
      today,
      days: evaluateRange(today, to, inputs.people, inputs.absencesAll, inputs.rules, inputs.assignments),
      needs: coverageNeeds(today, to, inputs.people, inputs.absencesAll, inputs.assignments, inputs.rules),
      requests: reqs.filter(isOpen).map((r) => ({ id: r.id, employeeName: names.get(r.employee_id) ?? 'Employee', typeLabel: REQUEST_TYPE_LABEL[r.request_type], start: r.start_date, end: r.end_date, status: r.status as 'submitted' | 'reviewed', overtime: r.overtime_required })),
      changes: changes.filter(isChangeOpen).map((c) => ({ id: c.id, employeeName: names.get(c.employee_id) ?? 'Employee', oldStart: c.old_start, oldEnd: c.old_end, newStart: c.new_start, newEnd: c.new_end, short: c.impact?.short ?? 0, clash: c.impact?.clash.length ?? 0 })),
      estimated: estimated.filter((e) => e.end_date >= today).map((e) => ({ id: e.id, employeeId: e.employee_id, employeeName: names.get(e.employee_id) ?? 'Employee', start: e.start_date, end: e.end_date })),
      needsAction: dir.filter((r) => r.is_active && r.in_unit12_scope && actionsFor(r).length > 0).length,
      absences: inputs.absences, people: inputs.people, plan: inputs.plan, isSectionHead,
      shutdowns: sds.map(({ plan, gaps }) => ({ id: plan.id, title: plan.title, start: plan.start, end: plan.end, shortDays: new Set(gaps.flatMap((g) => g.dates)).size,
        gaps: gaps.map((g) => ({ team: g.team, label: g.label, days: g.dates.length })) })),
      recorded: recorded.map((r) => ({ ...r, end: r.end ?? OPEN_END, employeeName: names.get(r.employeeId) ?? 'Employee' })),
      openCases: openCases.map((c) => ({ rootId: c.rootId, employeeId: c.employeeId, employeeName: names.get(c.employeeId) ?? 'Employee', label: c.label, start: c.start, nextReview: c.nextReview, estimatedReturn: c.estimatedReturn })),
      controllerLeave: {
        overlaps: open.overlaps.map((o) => ({ a: who(o.a.employeeId), b: who(o.b.employeeId), start: o.start, end: o.end, days: o.days })),
        extras: open.extras.map((x) => ({ name: who(x.period.employeeId), nth: x.nth, year: x.year, start: x.period.start, end: x.period.end }))
      }
    };
    const notices = buildNotices(input);
    // one shared store of issues: the role-neutral list (as the Section Head sees it) is synced; an issue keeps its key,
    // is updated in place, and is resolved (kept as history) once it no longer comes up
    const all = isSectionHead ? notices : buildNotices({ ...input, isSectionHead: true });
    void supabase.rpc('issues_sync', { p_items: all.map((n) => ({ key: n.id, level: issueLevel(n), area: n.area, title: n.title, detail: n.detail, target: n.to, first_date: n.date })) }).then(() => undefined, () => undefined);
    cache = { key, at: Date.now(), notices };
    return notices;
  })().finally(() => { pending = null; });
  return pending;
}

