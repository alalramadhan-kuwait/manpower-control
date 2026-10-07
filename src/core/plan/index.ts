// Plan years: which year is the Active Plan (in use by manpower, alerts, calendar and Oracle follow-up) and which
// is being planned. Every leave page says which one it shows.

export type PlanYearStatus = 'active' | 'planning' | 'closed';
export interface PlanYear { year: number; status: PlanYearStatus }

export interface PlanContext { year: number; kind: 'active' | 'draft' | 'past' | 'none'; label: string; writable: boolean }

/** "Active Plan · 2026", "PV Plan · 2027 · Draft", "Plan · 2025 · Closed". Only the Active Plan is changed directly:
 *  next year's PV is planned in the PV draft. */
export function planContext(years: PlanYear[], year: number): PlanContext {
  const y = years.find((p) => p.year === year);
  const active = years.find((p) => p.status === 'active')?.year ?? null;
  if (y?.status === 'active') return { year, kind: 'active', label: `Active Plan · ${year}`, writable: true };
  if (y?.status === 'planning' || (active !== null && year > active)) return { year, kind: 'draft', label: `PV Plan · ${year} · Draft`, writable: false };
  if (y?.status === 'closed' || (active !== null && year < active)) return { year, kind: 'past', label: `Plan · ${year} · Closed`, writable: false };
  return { year, kind: 'none', label: `Plan · ${year}`, writable: false };
}
