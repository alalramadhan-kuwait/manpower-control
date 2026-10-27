// Annual vacation planning rules (owner, 27 Oct 2026). One place for every number the planner, the forms, the
// server check and the PV cycles page use. Pure.

export const VAC_RULES = {
  /** Vacation periods per person per year: a period is one run of consecutive whole cycles. */
  minPeriods: 4, maxPeriods: 5,
  /** People in a shift's Panel group (assigned, not on duty). */
  panelGroup: 4,
  /** One vacation slot per this many counted people (Panel group or counted Field). */
  perSlot: 4,
  /** Panel and Field Operators left on duty while others are on leave, when no operating mode says otherwise. */
  panelMinOnDuty: 3, fieldMinOnDuty: 6,
  /** Controllers: one off at a time across the whole unit. */
  controllersOffUnit: 1,
  /** Summer (by the cycle's first day): June to September, one period of two cycles at the longest. */
  summerFromMonth: 6, summerToMonth: 9, summerMaxCycles: 2, summerMaxPeriods: 1
} as const;

/** The smallest group that has a vacation slot. */
export const slotFloor = (minimum: number) => Math.max(VAC_RULES.perSlot, minimum + 1);
/** Simultaneous vacation slots: one per four counted people, never below the operating minimum on duty. */
export const slotsFor = (counted: number, minimum: number) => Math.max(0, Math.min(Math.floor(counted / VAC_RULES.perSlot), counted - minimum));
/** Field: floor(counted Field / people per slot), and Field on duty never below its minimum. */
export const fieldSlots = (counted: number, minimum: number = VAC_RULES.fieldMinOnDuty) => slotsFor(counted, minimum);
/** Panel: floor(Panel group / people per slot), and Panel on duty never below its minimum. */
export const panelSlots = (group: number, minimum: number = VAC_RULES.panelMinOnDuty) => slotsFor(group, minimum);
