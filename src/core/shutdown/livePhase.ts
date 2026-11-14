// The phase the shutdown is in, for the Live page (owner, 14 Nov 2026: "it is startup phase so it should show me the
// live one"). Decided by what is recorded, never by the clock alone: Back in service when every start-up step is done;
// Start-up once a start-up step has started; M & I once the critical items are handed over; else Operations.
export type LivePhase = 'ops' | 'mi' | 'startup' | 'service';
export interface PhaseStep { status: 'not_started' | 'running' | 'done' | 'not_required'; kind?: 'step' | 'hold'; startedAt: string | null; doneAt: string | null }

export function livePhase(handoverAt: number | null, now: number, startup: PhaseStep[]): LivePhase {
  const counted = startup.filter((s) => s.status !== 'not_required' && s.kind !== 'hold');
  if (counted.length && counted.every((s) => s.status === 'done')) return 'service';
  if (startup.some((s) => s.startedAt && s.status !== 'not_required')) return 'startup';
  if (handoverAt !== null && handoverAt <= now) return 'mi';
  return 'ops';
}

/** Where the start-up stands now: the step running (or a hold), else the next step and how long since the last one
 *  finished. */
export function startupNow<T extends PhaseStep & { id: string; title: string }>(steps: T[], now: number): { running: T | null; next: T | null; idleH: number | null } {
  const live = steps.filter((s) => s.status !== 'not_required');
  const running = live.find((s) => s.status === 'running') ?? null;
  const next = live.find((s) => s.status === 'not_started' && s.kind !== 'hold') ?? null;
  const dones = live.filter((s) => s.status === 'done' && s.doneAt).map((s) => Date.parse(s.doneAt!));
  const idleH = !running && dones.length ? Math.round(((now - Math.max(...dones)) / 36e5) * 10) / 10 : null;
  return { running, next, idleH };
}
