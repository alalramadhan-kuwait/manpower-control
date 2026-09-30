// Overlaps of a train shutdown's team: people of one crew share their rest days, so a place (level) that needs two has
// nobody left on those days. The fix is an instruction: the person follows another crew's rota (and works that crew's
// shift before joining), so the rest days fall on different days. Pure function; the app records what the user accepts.
import type { Crew } from '../roster';
import { CREWS } from '../roster';
import { isDutyDay, planDates, type SdMember, type SdPhase, type SdPlan, type SdTeam } from './index';
import { spreadGroups } from './spread';

export interface FollowChange { memberId: string; employeeId: string; from: Crew; to: Crew }
export interface FollowGroup {
  teamId: string; key: string;
  /** Person-days missing against the need / days nobody is there, now and with the changes. */
  before: { short: number; gapDays: number }; after: { short: number; gapDays: number };
  changes: FollowChange[];
}

const MOVABLE_MAX = 7;

/**
 * For each level (slot) of each team with people of the same crew: which of them should follow another crew's rota.
 * `crewOf` is the crew whose duty days the member keeps now (their own, or the one they already follow); people without
 * a crew (day staff, VR) stay as they are. Fewest changes that cut the days short; when tied, a crew the team has the
 * fewest of. Only groups the changes improve are returned.
 */
export function suggestFollow(p: SdPlan, teams: SdTeam[], members: SdMember[], phases: SdPhase[], crewOf: (m: SdMember) => Crew | null): FollowGroup[] {
  if (p.kind === 'total') return [];
  const dates = planDates(p);
  const crew = new Map<string, Crew | null>(members.map((m) => [m.id, crewOf(m)]));
  const out: FollowGroup[] = [];
  for (const t of teams) {
    for (const g of spreadGroups(p, t, members, phases)) {
      if (g.key === 'new') continue;   // the New slot may stay empty
      const list = members.filter((m) => g.memberIds.includes(m.id));
      const movable = list.filter((m) => crew.get(m.id));
      if (movable.length < 2) continue;
      const need = dates.map(g.need);
      const score = (assign: (Crew | null)[]) => {
        let short = 0, gapDays = 0;
        dates.forEach((d, k) => {
          if (need[k] <= 0) return;
          const on = list.reduce((n, m, i) => n + (m.start <= d && d <= m.end && isDutyDay(assign[i], d) ? 1 : 0), 0);
          short += Math.max(0, need[k] - on); if (on === 0) gapDays++;
        });
        return { short, gapDays };
      };
      const current = list.map((m) => crew.get(m.id) ?? null);
      const before = score(current);
      if (before.short === 0) continue;
      // which people can change: only the ones of a crew shared with somebody else of the level (the others keep theirs), at most MOVABLE_MAX
      const shared = list.map((_m, i) => (current[i] && current.filter((c) => c === current[i]).length > 1 ? i : -1)).filter((i) => i >= 0).slice(0, MOVABLE_MAX);
      if (!shared.length) continue;
      // crews the team has, to prefer the ones with the fewest
      const teamLoad = (c: Crew) => members.filter((m) => m.teamId === t.id && crew.get(m.id) === c).length;
      type Cand = { assign: (Crew | null)[]; s: { short: number; gapDays: number }; changes: number; pairs: number; load: number };
      const pick: { best: Cand | null } = { best: null };
      const rec = (j: number, assign: (Crew | null)[]) => {
        if (j === shared.length) {
          const s = score(assign);
          const changes = shared.filter((i) => assign[i] !== current[i]).length;
          const pairs = CREWS.reduce((n, c) => { const k = assign.filter((x) => x === c).length; return n + (k > 1 ? k * (k - 1) / 2 : 0); }, 0);
          const load = shared.reduce((n, i) => n + (assign[i] !== current[i] ? teamLoad(assign[i]!) : 0), 0);
          const best = pick.best;
          const better = !best || s.short < best.s.short || (s.short === best.s.short && (s.gapDays < best.s.gapDays || (s.gapDays === best.s.gapDays && (changes < best.changes || (changes === best.changes && (pairs < best.pairs || (pairs === best.pairs && load < best.load)))))));
          if (better) pick.best = { assign: assign.slice(), s, changes, pairs, load };
          return;
        }
        const i = shared[j];
        for (const c of [current[i]!, ...CREWS.filter((x) => x !== current[i])]) { assign[i] = c; rec(j + 1, assign); }
        assign[i] = current[i];
      };
      rec(0, current.slice());
      const b = pick.best;
      if (!b || b.changes === 0 || b.s.short >= before.short) continue;
      const changes = shared.filter((i) => b.assign[i] !== current[i]).map((i) => ({ memberId: list[i].id, employeeId: list[i].employeeId, from: current[i]!, to: b.assign[i]! }));
      for (const c of changes) crew.set(c.memberId, c.to);
      out.push({ teamId: t.id, key: g.key, before, after: b.s, changes });
    }
  }
  return out;
}
