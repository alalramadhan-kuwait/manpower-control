import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { accountEmail, lockoutProblem, passwordProblem, usernameOf } from '../rules';

const ME = 'me', OTHER = 'other';
const head = (id: string) => ({ authUserId: id, roleCode: 'section_head', isActive: true });

describe('account usernames', () => {
  it('maps short usernames to the fixed domain and keeps real emails', () => {
    expect(accountEmail(' AJR015 ')).toBe('ajr015@manpower-control.local');
    expect(accountEmail('someone@example.com')).toBe('someone@example.com');
    expect(usernameOf('ajr015@manpower-control.local')).toBe('ajr015');
    expect(usernameOf('someone@example.com')).toBe('someone@example.com');
  });
  it('rejects unusable usernames', () => {
    for (const bad of ['', 'a', 'has space', '-lead', 'x@', 'a'.repeat(33)]) expect(accountEmail(bad)).toBeNull();
  });
  it('requires 8-character passwords', () => {
    expect(passwordProblem('1234567')).toMatch(/at least 8/);
    expect(passwordProblem('12345678')).toBeNull();
  });
});

describe('lockout protection', () => {
  it('stops the caller disabling, demoting or deleting their own login', () => {
    expect(lockoutProblem(ME, head(ME), { remove: true }, 3)).toMatch(/own login/);
    expect(lockoutProblem(ME, head(ME), { isActive: false }, 3)).toMatch(/own login/);
    expect(lockoutProblem(ME, head(ME), { roleCode: 'manpower_coordinator' }, 3)).toMatch(/own login/);
    expect(lockoutProblem(ME, head(ME), { roleCode: 'section_head' }, 1)).toBeNull();
  });
  it('keeps at least one active Section Head', () => {
    expect(lockoutProblem(ME, head(OTHER), { isActive: false }, 1)).toMatch(/At least one/);
    expect(lockoutProblem(ME, head(OTHER), { isActive: false }, 2)).toBeNull();
  });
  it('allows any change to other roles', () => {
    const coord = { authUserId: OTHER, roleCode: 'manpower_coordinator', isActive: true };
    expect(lockoutProblem(ME, coord, { remove: true }, 1)).toBeNull();
    expect(lockoutProblem(ME, coord, { roleCode: 'section_head' }, 1)).toBeNull();
  });
});

describe('Edge Function copy', () => {
  it('is byte-identical to src/core/users/rules.ts', () => {
    const a = readFileSync(new URL('../rules.ts', import.meta.url), 'utf8');
    const b = readFileSync(new URL('../../../../supabase/functions/manage-users/rules.ts', import.meta.url), 'utf8');
    expect(b).toBe(a);
  });
});
