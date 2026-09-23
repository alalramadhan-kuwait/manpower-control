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
