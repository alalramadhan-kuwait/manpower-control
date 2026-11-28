// Who was on shift (owner, 28 Nov 2026: "who is the controller … compare the schedule planned, who was there, so you
// can know also who was sick and who was doing overtime"). The log's own Manpower section against the planned roster
// for that crew on that date. Matched by employee number only. Nothing is concluded beyond what the two say: a person
// planned and not in the log is "not in the log" (it may be sick leave not yet recorded, or the log left them out),
// and a person in the log from another crew is "from crew X" (overtime or a cover), never more.
import type { CrewDay, DayResult, MpPerson } from '../manpower';
import { personOn } from '../manpower';
import type { StaffRow } from './parse';
import type { StoredLog } from './view';

const SHIFT_STATE: Record<string, string> = { Morning: 'M', Afternoon: 'A', Night: 'N' };
const key = (n: string) => n.replace(/^0+/, '');

export interface StaffPerson { empNo: string; name: string; role: string; area: string | null }
export interface StaffCompare {
  crew: string | null;
  /** The log's crew is on that shift in the roster (false: the roster has it on another shift or off). */
  onRota: boolean;
  /** The Controller(s) the log names, and how the roster has them. */
  controllers: (StaffPerson & { how: 'planned' | 'cover' | 'acting' | 'other_crew' | 'not_in_roster'; homeCrew: string | null })[];
  /** Planned for this shift and in the log. */
  present: StaffPerson[];
  /** Planned, no leave recorded, not in the log. */
  missing: StaffPerson[];
  /** On recorded leave or release, not in the log. */
  leave: (StaffPerson & { type: string })[];
  /** On recorded leave but in the log (came in, or the leave changed). */
  inWhileOnLeave: (StaffPerson & { type: string })[];
  /** In the log, not planned in this crew: from another crew (overtime / cover) or not in the roster at all. */
  extra: (StaffPerson & { homeCrew: string | null; inRoster: boolean })[];
}

const ROLE: Record<string, string> = { controller: 'Controller', vr_controller: 'Controller', morning_controller: 'Controller', panel_operator: 'Panel', field_operator: 'Field' };
const fromRoster = (p: MpPerson, area: string | null = null): StaffPerson => ({ empNo: p.employeeNumber, name: p.name, role: ROLE[p.role ?? ''] ?? '—', area });
const fromLog = (r: StaffRow, p?: MpPerson): StaffPerson => ({ empNo: r.empNo, name: p?.name ?? titleCase(r.name), role: r.role === 'Staff' ? (ROLE[p?.role ?? ''] ?? '—') : r.role.replace(/ Operator$/, ''), area: r.area });
export const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());
const typeOf = (a: { typeShort?: string | null; typeLabel?: string | null; typeCode: string | null }) => a.typeLabel ?? a.typeShort ?? a.typeCode ?? 'leave';

/** Everyone the roster puts in this crew's shift that day: counted or not, on leave or not, and its recorded cover. */
function plannedOf(c: CrewDay): Map<string, MpPerson> {
  const m = new Map<string, MpPerson>();
  const add = (p: MpPerson | null | undefined) => { if (p) m.set(key(p.employeeNumber), p); };
  for (const pos of [c.controller, c.panel, c.field]) { pos.counted.forEach(add); pos.notCounted.forEach((n) => add(n.person)); }
  c.absences.forEach((a) => add(a.person));
  add(c.controller.acting); add(c.controller.cover?.person);
  c.controller.onLeave.forEach(add);
  for (const a of c.controller.away) m.delete(key(a.person.employeeNumber));     // away on another assignment that day
  return m;
}

export function compareStaff(log: Pick<StoredLog, 'date' | 'shift' | 'crew' | 'manpower'>, day: DayResult | null, people: MpPerson[]): StaffCompare | null {
  const rows = log.manpower ?? [];
  if (!rows.length) return null;
  const crewDay = day?.crews.find((c) => c.crew === log.crew) ?? null;
  const planned = crewDay ? plannedOf(crewDay) : new Map<string, MpPerson>();
  const leaveOf = new Map((crewDay?.absences ?? []).map((a) => [key(a.person.employeeNumber), typeOf(a.absence)]));
  const everyone = new Map(people.map((p) => [key(p.employeeNumber), p]));
  const inLog = new Map(rows.map((r) => [key(r.empNo), r]));
  const home = (p: MpPerson | undefined) => (p ? personOn(p, log.date).crew ?? null : null);

  const out: StaffCompare = { crew: log.crew, onRota: !!crewDay && crewDay.state === SHIFT_STATE[log.shift ?? ''], controllers: [], present: [], missing: [], leave: [], inWhileOnLeave: [], extra: [] };
  for (const r of rows) {
    const k = key(r.empNo), p = planned.get(k) ?? everyone.get(k);
    const s = fromLog(r, p);
    if (planned.has(k)) {
      const t = leaveOf.get(k);
      if (t) out.inWhileOnLeave.push({ ...s, type: t }); else out.present.push(s);
    } else out.extra.push({ ...s, homeCrew: home(p), inRoster: !!p });
    if (s.role === 'Controller' || /^Controller$/i.test(r.position ?? '')) {
      const cover = crewDay?.controller.cover?.person, acting = crewDay?.controller.acting;
      const how = cover && key(cover.employeeNumber) === k ? 'cover' : acting && key(acting.employeeNumber) === k ? 'acting'
        : planned.has(k) ? 'planned' : p ? 'other_crew' : 'not_in_roster';
      out.controllers.push({ ...s, role: 'Controller', how, homeCrew: home(p) });
    }
  }
  if (crewDay) for (const [k, p] of planned) {
    if (inLog.has(k)) continue;
    const t = leaveOf.get(k);
    if (t) out.leave.push({ ...fromRoster(p), type: t }); else out.missing.push(fromRoster(p));
  }
  return out;
}
