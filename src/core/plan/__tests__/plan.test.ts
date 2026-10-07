import { describe, expect, it } from 'vitest';
import { planContext, type PlanYear } from '..';

const years: PlanYear[] = [{ year: 2026, status: 'active' }, { year: 2027, status: 'planning' }];

describe('plan context', () => {
  it('names the active plan and allows changes', () => {
    expect(planContext(years, 2026)).toEqual({ year: 2026, kind: 'active', label: 'Active Plan · 2026', writable: true });
  });
  it('names next year as the PV draft, not writable to the active plan', () => {
    expect(planContext(years, 2027)).toMatchObject({ kind: 'draft', label: 'PV Plan · 2027 · Draft', writable: false });
    expect(planContext(years, 2028)).toMatchObject({ kind: 'draft', writable: false });
  });
  it('names an earlier year as closed', () => {
    expect(planContext(years, 2025)).toMatchObject({ kind: 'past', label: 'Plan · 2025 · Closed', writable: false });
  });
});
