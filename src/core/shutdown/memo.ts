// The instruction memo sent to the operation staff with the shutdown schedule ("Turnaround Manpower Coverage"): who
// joins which group, on which basis, the controllers left on the crews, and each person's day of joining. Everything is
// read from the plan as it stands (the plan is the updated one; a memo typed earlier may not be).
import { personOn, type MpPerson } from '../manpower';
import { addDaysIso, CREWS, type Crew } from '../roster';
import { isDutyDay, memberWorks, planDates, type SdMember, type SdPlan, type SdTeam } from './index';

export interface MemoPerson { name: string; number: string }
export interface MemoGroup { team: SdTeam; numeral: string; remark: string; people: (MemoPerson & { note: string | null })[] }
export interface MemoCrewController { crew: Crew; people: MemoPerson[] }
export interface Memo {
  /** "ARDS Unit-12 (Train-II) October – November 2026" */
  heading: string;
  /** "ARDS TR-II" / "ARDS Unit-12" */
  short: string;
  intro: string;
  controllers: MemoGroup[];
  /** the crews' controllers who stay on their normal 8 hrs shift (none: the crew's controller is on the shutdown) */
  remaining: MemoCrewController[];
  operators: MemoGroup[];
  personnel: string[];
  /** a train shutdown: the remaining controllers follow the running train */
  train: boolean;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 18/10/26 */
export const memoShort = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
/** 19/10/2026 */
export const memoLong = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
/** 18 & 19/10/26 (one month), else 31/10/26 & 01/11/26 */
export function memoDays(dates: string[]): string {
  const ds = [...new Set(dates)].sort();
  const join = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} & ${xs[xs.length - 1]}`);
  if (ds.every((d) => d.slice(0, 7) === ds[0].slice(0, 7))) return `${join(ds.map((d) => d.slice(8)))}/${ds[0].slice(5, 7)}/${ds[0].slice(2, 4)}`;
  return join(ds.map(memoShort));
}
const hours = (label: string | null | undefined) => (label ?? '').split(/\s*-\s*/).map((x) => `${x} hrs.`);

/** The train of the plan's title (Train-2 SD → II), null for a total shutdown. */
export function trainOf(p: SdPlan): string | null {
  if (p.kind !== 'train') return null;
  const n = Number(/train[\s-]*(\d)/i.exec(p.title)?.[1] ?? 0);
  return n ? ROMAN[n] ?? String(n) : null;
}

export function buildMemo(p: SdPlan, teams: SdTeam[], members: SdMember[], people: MpPerson[], who: (employeeId: string) => MemoPerson,
  homeCrew: (m: SdMember) => Crew | null): Memo {
  const tr = trainOf(p);
  const ym = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(0, 4) !== p.end.slice(0, 4) ? ` ${d.slice(0, 4)}` : ''}`;
  const period = p.start.slice(0, 7) === p.end.slice(0, 7) ? `${MONTHS[Number(p.start.slice(5, 7)) - 1]} ${p.start.slice(0, 4)}` : `${ym(p.start)} – ${ym(p.end)} ${p.end.slice(0, 4)}`;
  const heading = `ARDS Unit-12${tr ? ` (Train-${tr})` : ''} ${period}`;
  const short = tr ? `ARDS TR-${tr}` : 'ARDS Unit-12';
  const sorted = [...teams].sort((a, b) => a.sort - b.sort);
  const dates = planDates(p);
  const basis = (t: SdTeam) => `${p.shiftHours} hrs. ${t.shiftCode === 'N' ? 'Night' : 'Morning'} basis`;
  const partNote = (m: SdMember) => (m.start > p.start && m.end < p.end ? `${memoLong(m.start)} – ${memoLong(m.end)}` : m.start > p.start ? `from ${memoLong(m.start)}` : m.end < p.end ? `to ${memoLong(m.end)}` : null);
  const group = (ctl: boolean) => sorted.map((t, i) => ({ team: t, numeral: ROMAN[i + 1] ?? String(i + 1), remark: basis(t),
    people: members.filter((m) => m.teamId === t.id && (m.slot === 'controller') === ctl).map((m) => ({ ...who(m.employeeId), note: partNote(m) })) }))
    .filter((g) => g.people.length);
  const controllers = group(true), operators = group(false);

  // the crews' own controllers who are not on the shutdown: the crew each one keeps most days of the shutdown
  const onPlan = new Set(members.map((m) => m.employeeId));
  const remaining: MemoCrewController[] = CREWS.map((crew) => ({ crew, people: [] as MemoPerson[] }));
  for (const x of people) {
    if (onPlan.has(x.id)) continue;
    const count = new Map<Crew, number>();
    for (const d of dates) { const o = personOn(x, d); if ((o.role === 'controller' || o.role === 'vr_controller') && o.crew && !o.sdTeam) count.set(o.crew, (count.get(o.crew) ?? 0) + 1); }
    const best = [...count].sort((a, b) => b[1] - a[1])[0];
    if (best) remaining.find((r) => r.crew === best[0])!.people.push(who(x.id));
  }

  const per = new Set(controllers.map((g) => g.people.length));
  const times = sorted.map((t) => `the ${t.shiftCode === 'N' ? 'night' : 'morning'} shift${sorted.length > 1 && t === sorted[0] ? ` for ${p.shiftHours} hrs basis` : ''} will start from ${hours(t.hoursLabel).join(' to ')}`);
  const intro = `ARDS Unit-12 Operations Manpower coverage will be modified with a new setup starting from ${memoLong(p.start)} in order to cover the ${short} Turnaround activities.`
    + (controllers.length ? ` ${per.size === 1 ? `${WORDS[[...per][0]] ?? [...per][0]} controllers` : 'Controllers'} in ${p.shiftHours} hrs group shift and will be assigned for following-up the Turnaround activities.` : '')
    + ` The following shift changes will describe the manpower set-up for the ${tr ? `ARDS Unit-12 TR-${tr}` : 'ARDS Unit-12'}.`
    + (times.length ? ` ${times.join(' and ').replace(/^t/, 'T').replace(/\.$/, '')}.` : '');

  // the day each one joins (days off first: rest days before joining, leave, the cycle's first days off); a move to
  // the other group during the shutdown; rest days after it
  const personnel: string[] = [];
  const ordered = sorted.flatMap((t) => [...members.filter((m) => m.teamId === t.id && m.slot === 'controller'), ...members.filter((m) => m.teamId === t.id && m.slot !== 'controller')]);
  for (const m of [...ordered].sort((a, b) => (a.start === b.start ? 0 : a.start < b.start ? -1 : 1))) {
    const t = sorted.find((x) => x.id === m.teamId)!;
    const w = who(m.employeeId); const name = `${w.name} #${w.number}`;
    const first = dates.find((d) => d >= m.start && d <= m.end && memberWorks(p, m, d));
    if (!first) continue;
    const moved = members.some((x) => x.id !== m.id && x.employeeId === m.employeeId && addDaysIso(x.end, 1) === m.start);
    const before = [...(m.restDays ?? []).filter((d) => d < m.start), ...dates.filter((d) => d >= m.start && d < first)];
    const join = moved ? `move to the ${t.name} Group on ${memoLong(first)}` : `join the ${t.name} Group on ${memoLong(first)}`;
    if (before.length) personnel.push(`${name} to take off on ${memoDays(before)} and ${join}.`);
    else if (moved || !isDutyDay(homeCrew(m), first)) personnel.push(`${name} to ${join}.`);
    const moving = members.some((x) => x.id !== m.id && x.employeeId === m.employeeId && addDaysIso(m.end, 1) === x.start);
    const after = (m.restDays ?? []).filter((d) => d > m.end);
    if (after.length && !moving) personnel.push(`${name} to take off on ${memoDays(after)} after the shutdown before returning to his shift.`);
  }
  return { heading, short, intro, controllers, remaining, operators, personnel, train: !!tr };
}
