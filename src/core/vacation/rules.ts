// Annual vacation planning rules (owner, 27 Oct 2026). One place for every number the planner, the forms, the
// server check and the PV cycles page use. Pure.

export const VAC_RULES = {
  /** Vacation periods per person per year: a period is one run of consecutive whole cycles. */
  minPeriods: 4, maxPeriods: 5,
  /** People in a shift's Panel group (assigned, not on duty). */
  panelGroup: 4,
  /** One vacation slot per this many counted people (Panel group or counted Field). */
  perSlot: 4,
  /** Controllers: one off at a time across the whole unit. */
  controllersOffUnit: 1,
  /** Summer (by the cycle's first day): June to September, one period of two cycles at the longest. */
  summerFromMonth: 6, summerToMonth: 9, summerMaxCycles: 2, summerMaxPeriods: 1
} as const;

/** Simultaneous vacation slots: one per four counted people, never below the operating minimum on duty. */
export const slotsFor = (counted: number, minimum: number) => Math.max(0, Math.min(Math.floor(counted / VAC_RULES.perSlot), counted - minimum));
/** Field: floor(counted Field / 4), and Field on duty never below its minimum (6 in full operation). */
export const fieldSlots = (counted: number, minimum = 6) => slotsFor(counted, minimum);
/** Panel: floor(Panel group / 4), and Panel on duty never below its minimum (3 in full operation). */
export const panelSlots = (group: number, minimum = 3) => slotsFor(group, minimum);
