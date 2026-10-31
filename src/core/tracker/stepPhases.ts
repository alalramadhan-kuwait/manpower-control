// The phases of every item's work (owner, 30–31 Oct 2026: "unify all the steps progress", one set of words): each step is placed by
// the words of its name; a step the words do not place takes the phase of the step before it. Display only: the
// steps, their order, times and the progress % are unchanged.
import type { TrkActivity } from '.';

export const PHASES = ['OP to handover', 'Under maintenance', 'Under inspection', 'Under repair', 'To be boxed up', 'Completed'] as const;
export type Phase = 0 | 1 | 2 | 3 | 4 | 5;
export const PHASE_IDS: Phase[] = [0, 1, 2, 3, 4, 5];

// one vocabulary for every item (owner, 31 Oct 2026): Operations hands over, maintenance opens and cleans, inspection,
// repair and tests, box-up and loading; Completed = back to Operations (the deblind is its step)
const RULES: [Phase, RegExp][] = [
  [5, /\bde-?blind\w*|\bremove\s+blinds?\b/i],
  [4, /\bbox[\s-]?up\b|\bfix(ing)?\s*b\s?ack\b|\bfix\s+(top|back)\b|\bre-?(install|fix)\w*|\binstall\s+(trays?|psv|bundle|elements?|the tube|tube)|\bload\w*|\bremove\s+(internal\s+)?scaffold\w*|\bscaffold\w*\s+removal|\bprepare\s+for\s+loading|\bconnect\s+piping|\bpush\s+back|\bshift\w*\s+back|\bdemister\s+back|\bcouple\b/i],
  [3, /\brepair\w*|\bweld(ing|ed)?\b(?!\s+joints?)|\breplac\w*|\brectif\w*|\btest\b|\btest\w*\s+at|\bhydro\s?-?test\w*|\bpainting|\bpaint\b|\boverhaul\w*|\bcoating|\bbelzona|\bretub\w*/i],
  // cleaning and the removal of the content before the inspection words ("Hydro blast cleaning for Inspection" is cleaning)
  [1, /\bclean\w*|\bblast\w*|\bh[\s/-]?blast|\bhydro\s?-?(blast|jet)\w*|\bjet\w*|\bgrit\b|\bbuff\w*|\bscaffold\w*|\bpigging\b|\bdump\w*|\bvacuum\w*/i],
  [2, /\boffer\w*|\binspect\w*|\beddy\b|\bndt\b|\bdpt\b|\blpt\b|\bradiograph\w*|\bmeasure\w*|\bclearance\b|\bpe\s*\/\s*op\b/i],
  [0, /\bblind\w*|\bisolat\w*|\bdrain\w*|\bneutrali\w*|\bsoda ash\b|\bentry\b|\bpermit\b|\bgas test\b|\bsteam\w*|\bflush\w*|\bnitrogen\b|\bpurg\w*/i],
  [1, /\bgrating\b|\binsulat\w*|\bcollector ring\b|\bcheck\b|\bremov\w*|\bopen\w*|\bpull\w*|\bdismantl\w*|\bdisconnect\w*|\bdemister\b|\bshift\w*|\bto\s+(service\s+at\s+)?(the\s+)?(work)?shop\b|\bventilation\b|\bmanway\b|\bswing\b|\bburners? down\b/i]];

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
/** The phase's name (the same words for every item). */
export const phaseName = (p: Phase, _acts: Pick<TrkActivity, 'activity'>[] = []) => PHASES[p];
