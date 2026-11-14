// The Maintenance Planning block of the Progress view, with its records loaded.
import { PlanningProgress } from './PlanningProgress';
import { useIntel } from './UpdateIntelligence';
import type { TrackerData } from '@/data/tracker';

export function PlanningBlock({ d, tracker, onDone, canEdit = false }: { d: TrackerData; tracker: { planPct: number; actualPct: number } | null; onDone: (msg: string) => void; canEdit?: boolean }) {
  const { intel, reload } = useIntel(d.tracker.id);
  if (!intel) return null;
  return <PlanningProgress d={d} records={intel.planning} tracker={tracker} canEdit={canEdit} onDone={(m) => { onDone(m); reload(); }} />;
}
