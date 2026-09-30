// One colour per leave type, so a type is recognised at a glance in the picker, the lists and the leave sheets.
// Families: annual (yellow / orange / amber), personal (violet / fuchsia), family & special (pink / teal / emerald / indigo),
// study & training (sky / cyan / blue), unpaid & other (stone / slate), sick & medical (reds).
export interface LeaveTone {
  /** A small chip: light fill, dark text. */
  chip: string;
  /** A round marker. */
  dot: string;
  /** A selected button: strong fill, white text. */
  on: string;
}
const tone = (chip: string, dot: string, on: string): LeaveTone => ({ chip, dot, on });
const AMBER = tone('bg-amber-100 text-amber-900 ring-amber-300', 'bg-amber-500', 'bg-amber-500 text-white ring-amber-500');
const YELLOW = tone('bg-yellow-100 text-yellow-900 ring-yellow-300', 'bg-yellow-400', 'bg-yellow-400 text-yellow-950 ring-yellow-400');
const ORANGE = tone('bg-orange-100 text-orange-900 ring-orange-300', 'bg-orange-500', 'bg-orange-500 text-white ring-orange-500');
const VIOLET = tone('bg-violet-100 text-violet-900 ring-violet-300', 'bg-violet-500', 'bg-violet-600 text-white ring-violet-600');
const FUCHSIA = tone('bg-fuchsia-100 text-fuchsia-900 ring-fuchsia-300', 'bg-fuchsia-500', 'bg-fuchsia-600 text-white ring-fuchsia-600');
const PINK = tone('bg-pink-100 text-pink-900 ring-pink-300', 'bg-pink-500', 'bg-pink-600 text-white ring-pink-600');
const TEAL = tone('bg-teal-100 text-teal-900 ring-teal-300', 'bg-teal-500', 'bg-teal-600 text-white ring-teal-600');
const EMERALD = tone('bg-emerald-100 text-emerald-900 ring-emerald-300', 'bg-emerald-500', 'bg-emerald-600 text-white ring-emerald-600');
const INDIGO = tone('bg-indigo-100 text-indigo-900 ring-indigo-300', 'bg-indigo-500', 'bg-indigo-600 text-white ring-indigo-600');
const SKY = tone('bg-sky-100 text-sky-900 ring-sky-300', 'bg-sky-500', 'bg-sky-600 text-white ring-sky-600');
const CYAN = tone('bg-cyan-100 text-cyan-900 ring-cyan-300', 'bg-cyan-500', 'bg-cyan-600 text-white ring-cyan-600');
const BLUE = tone('bg-blue-100 text-blue-900 ring-blue-300', 'bg-blue-500', 'bg-blue-600 text-white ring-blue-600');
const STONE = tone('bg-stone-200 text-stone-800 ring-stone-300', 'bg-stone-500', 'bg-stone-600 text-white ring-stone-600');
const SLATE = tone('bg-slate-100 text-slate-700 ring-slate-300', 'bg-slate-400', 'bg-slate-600 text-white ring-slate-600');
const RED = tone('bg-red-100 text-red-900 ring-red-300', 'bg-red-500', 'bg-red-600 text-white ring-red-600');
const ZINC = tone('bg-zinc-300 text-zinc-900 ring-zinc-400', 'bg-zinc-800', 'bg-zinc-800 text-white ring-zinc-800');
const ROSE = tone('bg-rose-200 text-rose-950 ring-rose-400', 'bg-rose-700', 'bg-rose-800 text-white ring-rose-800');

const BY_CODE: Record<string, LeaveTone> = {
  annual_leave_planned: YELLOW, annual_leave_rescheduled: YELLOW, annual_leave_unscheduled: ORANGE, leave_extension: AMBER,
  personal_qb: VIOLET, short_leave: FUCHSIA,
  death_leave: ZINC, marriage_leave: PINK, escort_leave: TEAL, hajj_leave: EMERALD, special_leave: INDIGO,
  study_leave: SKY, course: CYAN, long_course: BLUE,
  unpaid_leave: STONE, other_known_absence: SLATE,
  sick_leave: RED, long_sick: ROSE, medical_absence: ROSE
};
/** Short codes (PV, UL, SL …) for the places that only have those; SL is the plain sick leave. */
const BY_SHORT: Record<string, LeaveTone> = {
  PV: YELLOW, UL: ORANGE, EXT: AMBER, PCP: VIOLET, SHORT: FUCHSIA, DEATH: ZINC, MARR: PINK, ESC: TEAL, HAJJ: EMERALD, SPEC: INDIGO,
  STUDY: SKY, COURSE: CYAN, LCOURSE: BLUE, UNPAID: STONE, OTHER: SLATE, SL: RED, MED: ROSE
};
export const leaveTone = (typeCode: string | null | undefined): LeaveTone => (typeCode ? BY_CODE[typeCode] : undefined) ?? SLATE;
export const leaveToneShort = (short: string | null | undefined): LeaveTone => (short ? BY_SHORT[short.toUpperCase()] : undefined) ?? SLATE;
