import { describe, expect, it } from 'vitest';
import { appAccess, isAdminStaff } from '../access';

describe('app access by level and assignment', () => {
  it('Section Head, Manpower Coordinator and Engineer open the whole app', () => {
    expect(['section_head', 'manpower_coordinator', 'engineer'].map((r) => appAccess(r))).toEqual(['full', 'full', 'full']);
  });
  it('a Controller opens the tracker only, the whole app with the Manpower assignment', () => {
    expect(appAccess('controller')).toBe('tracker');
    expect(appAccess('controller', ['manpower'])).toBe('full');
  });
  it('staff logins and unknown roles open nothing', () => {
    expect([appAccess('employee'), appAccess(null), appAccess('x', ['manpower'])]).toEqual(['none', 'none', 'none']);
  });
  it('administration is by role only: the Manpower assignment does not open it', () => {
    expect(['section_head', 'manpower_coordinator', 'engineer', 'controller', 'employee'].map(isAdminStaff)).toEqual([true, true, true, false, false]);
  });
});
