// Notification Center data: gathers the next weeks' manpower, cover needs, open requests and staff records
// needing action, and builds the notices (src/core/notifications). Cached briefly so the header badge is cheap.
import { actionsFor } from '@/core/actions';
import { coverageNeeds } from '@/core/controllers';
import { evaluateRange } from '@/core/manpower';
import { buildNotices, type Notice } from '@/core/notifications';
import { REQUEST_TYPE_LABEL } from '@/core/requests';
import { addDaysIso } from '@/core/roster';
import { fetchManpowerInputs } from './manpower';
import { fetchControllerLeave } from './controllers';
import { checkControllerLeave, openIssues } from '@/core/controllers/leaveRules';
import { fetchDirectory } from './queries';
import { fetchRequests, isOpen } from './requests';

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
    const [inputs, reqs, dir, ctl] = await Promise.all([fetchManpowerInputs(today, addDaysIso(to, 1)), fetchRequests(), fetchDirectory(), fetchControllerLeave(`${y}-01-01`, `${y + 1}-12-31`)]);
    const open = openIssues(checkControllerLeave(ctl.people, ctl.absences, ctl.approvals, [y, y + 1]), today);
    const who = (id: string) => ctl.people.find((p) => p.id === id)?.name ?? 'Controller';
    const names = new Map(dir.map((r) => [r.id, r.display_name]));
    const notices = buildNotices({
      today,
      days: evaluateRange(today, to, inputs.people, inputs.absences, inputs.rules, inputs.assignments),
      needs: coverageNeeds(today, to, inputs.people, inputs.absences, inputs.assignments, inputs.rules),
      requests: reqs.filter(isOpen).map((r) => ({ id: r.id, employeeName: names.get(r.employee_id) ?? 'Employee', typeLabel: REQUEST_TYPE_LABEL[r.request_type], start: r.start_date, end: r.end_date, status: r.status as 'submitted' | 'reviewed', overtime: r.overtime_required })),
      needsAction: dir.filter((r) => r.is_active && r.in_unit12_scope && actionsFor(r).length > 0).length,
      absences: inputs.absences, people: inputs.people, plan: inputs.plan, isSectionHead,
      controllerLeave: {
        overlaps: open.overlaps.map((o) => ({ a: who(o.a.employeeId), b: who(o.b.employeeId), start: o.start, end: o.end, days: o.days })),
        extras: open.extras.map((x) => ({ name: who(x.period.employeeId), nth: x.nth, year: x.year, start: x.period.start, end: x.period.end }))
      }
    });
    cache = { key, at: Date.now(), notices };
    return notices;
  })().finally(() => { pending = null; });
  return pending;
}

