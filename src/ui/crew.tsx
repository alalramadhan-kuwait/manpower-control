import type { Crew } from '@/core/roster';
import { cx } from './components';

/**
 * Permanent crew identity: A Blue, B Green, C Orange, D Purple. Used only to say WHICH crew,
 * never to say how it is staffed; manpower status keeps its own Green / Amber / Red / Grey pills.
 * Every screen that shows a crew uses these, so a colour always means the same crew.
 */
export const CREW_IDENTITY: Record<Crew, { colour: string; bg: string; text: string; border: string }> = {
  A: { colour: 'Blue', bg: 'bg-crew-a', text: 'text-crew-a', border: 'border-l-crew-a' },
  B: { colour: 'Green', bg: 'bg-crew-b', text: 'text-crew-b', border: 'border-l-crew-b' },
  C: { colour: 'Orange', bg: 'bg-crew-c', text: 'text-crew-c', border: 'border-l-crew-c' },
  D: { colour: 'Purple', bg: 'bg-crew-d', text: 'text-crew-d', border: 'border-l-crew-d' }
};

/** Solid circle with the crew letter. */
export function CrewBadge({ crew, size = 'md', muted }: { crew: Crew; size?: 'sm' | 'md' | 'lg'; muted?: boolean }) {
  const dims = { sm: 'h-6 w-6 text-xs', md: 'h-9 w-9 text-base', lg: 'h-11 w-11 text-xl' }[size];
  return (
    <span aria-label={`${crew} Shift`} className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white', dims, CREW_IDENTITY[crew].bg, muted && 'opacity-45')}>
      {crew}
    </span>
  );
}

/** Thick left edge in the crew colour, for cards that belong to one crew. */
export const crewEdge = (crew: Crew) => cx('border-l-[6px]', CREW_IDENTITY[crew].border);

const isCrew = (v: string | null | undefined): v is Crew => v === 'A' || v === 'B' || v === 'C' || v === 'D';

/** Badge plus "A Shift", for rows and headers. Renders nothing for a missing or non-crew code. */
export function CrewTag({ crew, suffix = ' Shift', size = 'sm' }: { crew: string | null | undefined; suffix?: string; size?: 'sm' | 'md' }) {
  if (!isCrew(crew)) return null;
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><CrewBadge crew={crew} size={size} />{crew}{suffix}</span>;
}

export { isCrew };
