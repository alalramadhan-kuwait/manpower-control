// Deterministic A/B/C/D roster. Standard cycle: 2 Morning → 2 Afternoon → 2 Night → 2 Off (8 days).
// Confirmed anchor: 2 March 2026 = Crew B, Morning Day 1. MORNING_ORDER = B, C, A, D.
// When B is Morning: D = Afternoon, A = Night, C = Off (and so on around the order).
// Pure functions, no I/O. This is the single source of truth for who is Off on a given date.

export type Crew = 'A' | 'B' | 'C' | 'D';
export type State = 'M' | 'A' | 'N' | 'Off';
export type DutyCode = 'M1' | 'M2' | 'A1' | 'A2' | 'N1' | 'N2' | 'Off1' | 'Off2';

export const MORNING_ORDER: Crew[] = ['B', 'C', 'A', 'D'];
export const ANCHOR_DATE = '2026-03-02'; // B = M1
const DAY_MS = 86_400_000;
// crew at offset k after the Morning crew in MORNING_ORDER: 0 = Morning, 1 = Off, 2 = Night, 3 = Afternoon
const STATE_BY_OFFSET: State[] = ['M', 'Off', 'N', 'A'];

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
const ANCHOR_MS = utc(ANCHOR_DATE);

/** Whole days between the anchor and `date` (negative before the anchor). */
export function daysFromAnchor(date: string): number {
  return Math.round((utc(date) - ANCHOR_MS) / DAY_MS);
}

/** Crew on Morning duty on `date`. */
export function morningCrew(date: string): Crew {
  const n = daysFromAnchor(date);
  const block = Math.floor(n / 2);
  return MORNING_ORDER[((block % 4) + 4) % 4];
}

/** Duty of one crew on one date, e.g. 'M2', 'Off1'. */
export function dutyFor(date: string, crew: Crew): DutyCode {
  const n = daysFromAnchor(date);
  const dayInBlock = ((n % 2) + 2) % 2 + 1;
  const mi = MORNING_ORDER.indexOf(morningCrew(date));
  const offset = (MORNING_ORDER.indexOf(crew) - mi + 4) % 4;
  return `${STATE_BY_OFFSET[offset]}${dayInBlock}` as DutyCode;
}

export function stateOf(duty: DutyCode): State {
  return duty.startsWith('Off') ? 'Off' : (duty[0] as State);
}

export function isOff(date: string, crew: Crew): boolean {
  return stateOf(dutyFor(date, crew)) === 'Off';
}

/** All four crews' duties on one date. */
export function dutiesOn(date: string): Record<Crew, DutyCode> {
  return { A: dutyFor(date, 'A'), B: dutyFor(date, 'B'), C: dutyFor(date, 'C'), D: dutyFor(date, 'D') };
}

// ---------------------------------------------------------------- Stage B additions

export const CREWS: Crew[] = ['A', 'B', 'C', 'D'];
export const SHIFT_LABEL: Record<State, string> = { M: 'Morning', A: 'Afternoon', N: 'Night', Off: 'Off' };
/** Display label for a duty code: 'M2' → 'Morning M2', 'Off1' → 'Off 1'. */
export function dutyLabel(duty: DutyCode): string {
  const s = stateOf(duty);
  return s === 'Off' ? `Off ${duty.slice(3)}` : `${SHIFT_LABEL[s]} ${duty}`;
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30, 2026-13-01, '2026-3-1'). */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The crew on each shift on `date`: { M: 'A', A: 'C', N: 'B', Off: 'D' }. */
export function crewsByShift(date: string): Record<State, Crew> {
  const out = {} as Record<State, Crew>;
  for (const c of CREWS) out[stateOf(dutyFor(date, c))] = c;
  return out;
}

/** Scheduled to work (Morning, Afternoon or Night) — leave only reduces manpower on these days. */
export function isWorkingDay(date: string, crew: Crew): boolean {
  return !isOff(date, crew);
}

/**
 * Self-check over a date range. Every day must have exactly one crew on each of M, A, N and Off, the day
 * number must alternate 1,2, and each crew must step M1→M2→A1→A2→N1→N2→Off1→Off2→M1 from one day to the next.
 * Returns the list of problems (empty = valid).
 */
export function validateRosterRange(from: string, to: string): string[] {
  const NEXT: Record<DutyCode, DutyCode> = { M1: 'M2', M2: 'A1', A1: 'A2', A2: 'N1', N1: 'N2', N2: 'Off1', Off1: 'Off2', Off2: 'M1' };
  const problems: string[] = [];
  let prev: Record<Crew, DutyCode> | null = null;
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    const duties = dutiesOn(d);
    const states = CREWS.map((c) => stateOf(duties[c])).sort().join(',');
    if (states !== 'A,M,N,Off') problems.push(`${d}: shifts covered ${states}`);
    const dayNums = new Set(CREWS.map((c) => duties[c].slice(-1)));
    if (dayNums.size !== 1) problems.push(`${d}: crews disagree on day 1/2`);
    if (prev) for (const c of CREWS) if (NEXT[prev[c]] !== duties[c]) problems.push(`${d}: crew ${c} went ${prev[c]} → ${duties[c]}`);
    prev = duties;
  }
  return problems;
}
