// Phone alerts for the Unit log (owner, 26 Nov 2026: "when new log book or sample send me notifications"). Pure: the
// text of the push sent when a new ARDS shift log or new lab results arrive (supabase/functions/logbook-ingest). Short,
// for an iPhone lock screen: one line per train, then trips; lab results out of the library's limits first.
import { checksOf, incidentsOf, trainCounts, type BoardInput, type TrainId } from './board';
import { limitForLab, limitState, type Limit, type LimitMatch } from './limits';
import { kuwaitParts, type StoredSample } from './view';

export interface PushText { title: string; body: string; tag: string; url: string }
const LOG_URL = './shutdowns?section=log&tab=overview';
const LAB_URL = './shutdowns?section=log&tab=lab';

const dayName = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "TR-1 ● 1 IOW ▲ 2 off ⚑ 2" per train, "✓ in range" when clear, then each trip or leak with its train. */
export function logAlert(input: BoardInput): PushText {
  const checks = checksOf(input);
  const line = (t: TrainId) => {
    const c = trainCounts(checks, input.overrides, t);
    const parts = [c.bad ? `● ${c.bad} IOW` : '', c.ov ? `● ${c.ov} override` : '', c.off ? `▲ ${c.off} off` : '', c.chk ? `⚑ ${c.chk} check` : ''].filter(Boolean);
    return `${t === 'Common' ? 'Common' : t} ${parts.length ? parts.join(' ') : '✓ in range'}`;
  };
  const inc = incidentsOf(input.log, input.controller).map((e) => `${e.word}: ${e.tags[0] ?? ''}${e.time ? ` ${e.time}` : ''}${e.train ? ` (${e.train})` : ''}`.replace(': (', ' ('));
  const l = input.log;
  return {
    title: `Unit log · ${dayName(l.date)} ${l.shift ?? ''}`.trim(),
    body: [...(['TR-1', 'TR-2', 'Common'] as TrainId[]).map(line), ...inc.slice(0, 2), ...(inc.length > 2 ? [`+${inc.length - 2} more`] : [])].join('\n'),
    tag: `unitlog-${l.kind}-${l.logNo}`, url: LOG_URL,
  };
}

/** New lab results: those beyond the library's limits first (IOW, then off target), else how many are within. */
export function labAlert(samples: StoredSample[], limits: Map<string, Limit>, matches: LimitMatch[]): PushText | null {
  if (!samples.length) return null;
  const rank = { critical: 0, breach: 1, off: 2, normal: 3 } as const;
  const found: { r: number; text: string }[] = []; let judged = 0;
  for (const s of samples) for (const x of s.results) {
    const l = limitForLab(s.material, s.equipment, x.component, matches, limits);
    const st = l ? limitState(x.value, l) : null;
    if (!l || !st) continue;
    judged += 1;
    if (st !== 'normal') found.push({ r: rank[st], text: `${st === 'off' ? '▲' : '●'} ${l.description} ${x.value}${x.unit ? ` ${x.unit}` : ''}${s.equipment ? ` (${s.equipment})` : ''}` });
  }
  found.sort((a, b) => a.r - b.r);
  const newest = samples.map((s) => s.collectedAt ?? '').sort().pop() ?? null;
  const k = kuwaitParts(newest);
  const body = found.length ? [...found.slice(0, 3).map((f) => f.text), ...(found.length > 3 ? [`+${found.length - 3} more`] : [])].join('\n')
    : judged ? `✓ ${judged} result${judged === 1 ? '' : 's'} within limits` : 'No limits set for these results';
  return { title: `Lab results${k ? ` · ${dayName(k.date)} ${k.time}` : ''} · ${samples.length} sample${samples.length === 1 ? '' : 's'}`, body, tag: `unitlab-${k?.date ?? 'x'}`, url: LAB_URL };
}
