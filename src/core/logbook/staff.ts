// Who was on shift (owner, 28 Nov 2026: "who is the controller … compare the schedule planned, who was there, so you
// can know also who was sick and who was doing overtime"). The log's own Manpower section against the planned roster
// for that crew on that date. Matched by employee number only. Nothing is concluded beyond what the two say: a person
// planned and not in the log is "not in the log" (it may be sick leave not yet recorded, or the log left them out),
// and a person in the log from another crew is "from crew X" (overtime or a cover), never more.
import type { CrewDay, DayResult, MpPerson } from '../manpower';
import { personOn } from '../manpower';
import type { StaffRow } from './parse';
import type { StoredLog } from './view';
import { shiftEnd } from './products';

const SHIFT_STATE: Record<string, string> = { Morning: 'M', Afternoon: 'A', Night: 'N' };
const key = (n: string) => n.replace(/^0+/, '');

export interface StaffPerson { id: string | null; empNo: string; name: string; role: string; area: string | null; position: string | null }
export interface StaffCompare {
  crew: string | null;
  /** Panel and Field minimums that applied that day (null when the roster could not be read). */
  mins: { panel: number; field: number } | null;
  /** The log's crew is on that shift in the roster (false: the roster has it on another shift or off). */
  onRota: boolean;
  /** The Controller(s) the log names, and how the roster has them. */
  controllers: (StaffPerson & { how: 'planned' | 'cover' | 'acting' | 'relief' | 'other_crew' | 'not_in_roster'; homeCrew: string | null })[];
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
const fromRoster = (p: MpPerson, area: string | null = null): StaffPerson => ({ id: p.id, empNo: p.employeeNumber, name: p.name, role: ROLE[p.role ?? ''] ?? '—', area, position: null });
const fromLog = (r: StaffRow, p?: MpPerson): StaffPerson => ({ id: p?.id ?? null, position: r.position, empNo: r.empNo, name: p?.name ?? titleCase(r.name), role: r.role === 'Staff' ? (ROLE[p?.role ?? ''] ?? '—') : r.role.replace(/ Operator$/, ''), area: r.area });
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

  const out: StaffCompare = { crew: log.crew, mins: day ? { panel: day.rules.panelMin, field: day.rules.fieldMin } : null, onRota: !!crewDay && crewDay.state === SHIFT_STATE[log.shift ?? ''], controllers: [], present: [], missing: [], leave: [], inWhileOnLeave: [], extra: [] };
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
        : planned.has(k) ? 'planned' : p && (p.role === 'vr_controller' || p.role === 'morning_controller') ? 'relief' : p ? 'other_crew' : 'not_in_roster';
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

// ── When the log was e-mailed (owner, 28 Nov 2026: "keep it at email time and keep it simple with colour code") ──
/** "2026-11-28 1415 Log#33673.pdf" (the Mac saves each e-mail under its received time) → "2026-11-28 14:15". */
export function emailTime(file: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2})(\d{2})\b/.exec(file ?? '');
  return m ? `${m[1]} ${m[2]}:${m[3]}` : null;
}
/** Minutes after the shift's end the log was e-mailed (negative: before the end). */
export function emailDelay(log: Pick<StoredLog, 'date' | 'shift' | 'emailedAt'>): number | null {
  if (!log.emailedAt || !log.shift) return null;
  const at = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00Z`);
  return Math.round((at(log.emailedAt) - at(shiftEnd(log.date, log.shift))) / 60000);
}
/** On time up to 30 min after the shift ends, late up to 90 min, then very late. */
export const emailState = (delay: number | null): 'ok' | 'late' | 'very_late' | null =>
  delay === null ? null : delay <= 30 ? 'ok' : delay <= 90 ? 'late' : 'very_late';

// ── The crew card's six tiles (owner chose option B, 28 Nov 2026) ─────────────────────────────────────────────────
export type TileKey = 'panel' | 'field' | 'ot' | 'sick' | 'pv' | 'planned';
export type TileTag = 'ok' | 'ot' | 'not_in_roster' | 'sick' | 'absent' | 'leave' | 'in_on_leave';
export interface TilePerson extends StaffPerson { tag: TileTag; note: string | null }
export interface Tile { key: TileKey; label: string; value: string; tone: 'ok' | 'short' | 'info' | 'bad' | 'grey'; people: TilePerson[] }
const SICK = /sick|\bSL\b/i;
/** Six tiles: Panel and Field seats against the minimum, Overtime, Sick / absent, PV (and other leave), As planned. */
export function staffTiles(r: StaffCompare): Tile[] {
  const inLog: TilePerson[] = [
    ...r.present.map((p) => ({ ...p, tag: 'ok' as const, note: null })),
    ...r.inWhileOnLeave.map((p) => ({ ...p, tag: 'in_on_leave' as const, note: `in the log · ${p.type}` })),
    ...r.extra.map((p) => (p.inRoster ? { ...p, tag: 'ot' as const, note: p.homeCrew ? `${p.homeCrew} crew` : 'day staff' } : { ...p, tag: 'not_in_roster' as const, note: null })),
  ];
  const seat = (role: string) => inLog.filter((p) => p.role === role);
  const panel = seat('Panel'), field = seat('Field');
  const sick = [...r.leave.filter((p) => SICK.test(p.type)).map((p) => ({ ...p, tag: 'sick' as const, note: p.type })),
    ...r.missing.map((p) => ({ ...p, tag: 'absent' as const, note: 'not in the log · no leave recorded' }))];
  const pv = [...r.leave.filter((p) => !SICK.test(p.type)).map((p) => ({ ...p, tag: 'leave' as const, note: p.type })),
    ...r.inWhileOnLeave.map((p) => ({ ...p, tag: 'in_on_leave' as const, note: `${p.type} · in the log` }))];
  const ot = inLog.filter((p) => p.tag === 'ot' || p.tag === 'not_in_roster');
  const seats = (n: number, min: number | undefined) => ({ value: min === undefined ? String(n) : `${n} / ${min}`, tone: (min !== undefined && n < min ? 'short' : 'ok') as Tile['tone'] });
  return [
    { key: 'panel', label: 'Panel', ...seats(panel.length, r.mins?.panel), people: panel },
    { key: 'field', label: 'Field', ...seats(field.length, r.mins?.field), people: field },
    { key: 'ot', label: 'Overtime', value: String(ot.length), tone: ot.length ? 'info' : 'grey', people: ot },
    { key: 'sick', label: 'Sick / absent', value: String(sick.length), tone: sick.length ? 'bad' : 'grey', people: sick },
    { key: 'pv', label: 'PV', value: String(pv.length), tone: 'grey', people: pv },
    { key: 'planned', label: 'As planned', value: String(r.present.length), tone: 'ok', people: inLog.filter((p) => p.tag === 'ok') },
  ];
}
