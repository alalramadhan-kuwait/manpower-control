// One step action for every view: start or finish a step now. The same step of the items worked with it
// (E-12-216A/B) moves with it; starting ends the item's hold (it was waiting for this work). Undo puts it all back.
import { setActivity, setEquipment, type TrackerData } from '@/data/tracker';

type Act = TrackerData['activities'][number];
type Eq = { id: string; pendingReason: string | null };

export async function stepNow(a: Act, also: Act[], finish: boolean, eqs: Eq[]): Promise<{ msg: string; undo: () => Promise<void> }> {
  const at = new Date().toISOString(); const all = [a, ...also];
  const before = all.map((y) => ({ id: y.id, actual_start: y.actualStart ?? null, actual_finish: y.actualFinish ?? null }));
  for (const y of all) await setActivity(y.id, finish ? { actual_finish: at, ...(y.actualStart ? {} : { actual_start: a.actualStart ?? at }) } : { actual_start: at });
  const held = finish ? [] : eqs.filter((e) => !!e.pendingReason);
  for (const e of held) await setEquipment(e.id, { pending_reason: null });
  const was = held[0]?.pendingReason;
  return {
    msg: `${[...new Set(all.map((y) => y.key))].join(' + ')}: ${a.activity} ${finish ? 'finished' : 'started'}.${was ? ` Hold "${was}" ended.` : ''}`,
    undo: async () => {
      for (const b of before) await setActivity(b.id, { actual_start: b.actual_start, actual_finish: b.actual_finish, time_reason: 'Undo' });
      for (const e of held) await setEquipment(e.id, { pending_reason: e.pendingReason });
    },
  };
}
