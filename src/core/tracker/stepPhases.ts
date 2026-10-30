// The six phases of every item's work (owner, 30 Oct 2026: "unify all the steps progress"): each step is placed by
// the words of its name; a step the words do not place takes the phase of the step before it. Display only: the
// steps, their order, times and the progress % are unchanged.
import type { TrkActivity } from '.';

export const PHASES = ['Isolate & open', 'Content out', 'Clean & inspect', 'Repair & test', 'Box-up & load', 'Deblind'] as const;
export type Phase = 0 | 1 | 2 | 3 | 4 | 5;

const RULES: [Phase, RegExp][] = [
  [5, /\bde-?blind\w*|\bremove\s+blinds?\b/i],
  [4, /\bbox[\s-]?up\b|\bfix(ing)?\s*b\s?ack\b|\bfix\s+(top|back)\b|\bre-?(install|fix)\w*|\binstall\s+(trays?|psv|bundle|elements?|the tube|tube)|\bload\w*|\bremove\s+(internal\s+)?scaffold\w*|\bprepare\s+for\s+loading|\bconnect\s+piping|\bpush\s+back|\bshift\w*\s+back|\bdemister\s+back|\bcouple\b/i],
  [3, /\brepair\w*|\bweld(ing|ed)?\b(?!\s+joints?)|\breplac\w*|\brectif\w*|\btest\b|\btest\w*\s+at|\bhydro\s?-?test\w*|\bpainting|\bpaint\b|\boverhaul\w*|\bcoating|\bbelzona|\bretub\w*/i],
  [2, /\bclean\w*|\bblast\w*|\bh[\s/-]?blast|\bhydro\s?-?(blast|jet)\w*|\bjet\w*|\bgrit\b|\bbuff\w*|\boffer\w*|\binspect\w*|\beddy\b|\bndt\b|\bdpt\b|\blpt\b|\bradiograph\w*|\bmeasure\w*|\bclearance\b|\bpe\s*\/\s*op\b|\bscaffold\w*|\bgrating\b|\binsulat\w*|\bpigging\b|\bcollector ring\b|\bcheck\b/i],
  [1, /\bdump\w*|\bvacuum\w*|\b(remove|open|pull\w*|dismantl\w*|take)\b[^,;]*\b(catalyst|ceramic|chimney|cone|windows?|doors?|top trays|trays|bundle|shell|demister|elements?|lube oil|inlet elbow)\b|\bpull\s*(out)?\b|\bremove\s*&\s*dismantle|\bdemister\s+(out|removal)|\bshift\w*\s+to\s+workshop|\bto\s+(service\s+at\s+)?(the\s+)?(work)?shop\b/i],
  [0, /\bblind\w*|\bisolat\w*|\bis\s?olate\b|\bdrain\w*|\bneutrali\w*|\bsoda ash\b|\bdisconnect\w*|\bopen\w*|\bentry\b|\bpermit\b|\bremov\w*|\bventilation\b|\bmanway\b|\bswing\b|\bburners? down\b|\bsteam\w*|\bflush\w*|\bnitrogen\b|\bpurg\w*/i]];

/** The phase a step's name places it in, or null when its words do not say. */
export function phaseOf(name: string): Phase | null {
  // a scaffolding note in brackets ("Shell pull out (scaffolding modification as required)") is not the step's work
  const t = name.replace(/\([^)]*scaffold[^)]*\)?/gi, ' ');
  for (const [p, re] of RULES) if (re.test(t)) return p;
  return null;
}
/** Every step's phase, in the item's order: by its name, else the phase of the step before it (the first: 0). */
export function stepPhases(acts: Pick<TrkActivity, 'id' | 'activity'>[]): Map<string, Phase> {
  const out = new Map<string, Phase>(); let prev: Phase = 0;
  for (const a of acts) { const p: Phase = phaseOf(a.activity) ?? prev; out.set(a.id, p); prev = p; }
  return out;
}
/** The phase's name for one item: "Catalyst out" where the item's content is catalyst. */
export const phaseName = (p: Phase, acts: Pick<TrkActivity, 'activity'>[] = []) => (p === 1 && acts.some((a) => /catalyst/i.test(a.activity)) ? 'Catalyst out' : PHASES[p]);
