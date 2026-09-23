/**
 * Account rules shared by the Users screen and the `manage-users` Edge Function.
 * This file has no imports so the Edge Function can ship a byte-identical copy
 * (supabase/functions/manage-users/rules.ts); a test keeps the two in step.
 */
export const USERNAME_DOMAIN = 'manpower-control.local';
export const MIN_PASSWORD = 8;
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "ajr015" → ajr015@manpower-control.local; anything with "@" is taken as an email. Null when invalid. */
export function accountEmail(input: string): string | null {
  const v = input.trim().toLowerCase();
  if (v.includes('@')) return EMAIL.test(v) ? v : null;
  return USERNAME.test(v) ? `${v}@${USERNAME_DOMAIN}` : null;
}

/** What the person types to sign in: the short username, or the full email for other domains. */
export function usernameOf(email: string | null | undefined): string {
  const v = (email ?? '').toLowerCase();
  return v.endsWith(`@${USERNAME_DOMAIN}`) ? v.slice(0, -USERNAME_DOMAIN.length - 1) : v;
}

export function passwordProblem(password: string): string | null {
  return password.length < MIN_PASSWORD ? `Password must be at least ${MIN_PASSWORD} characters.` : null;
}

export interface AccountState { authUserId: string; roleCode: string | null; isActive: boolean }
export interface AccountChange { roleCode?: string; isActive?: boolean; remove?: boolean }

/**
 * Refuses changes that would lock the section out: the caller cannot disable, demote or delete
 * their own login, and at least one active Section Head must always remain.
 */
export function lockoutProblem(callerId: string, target: AccountState, change: AccountChange, activeSectionHeads: number): string | null {
  const losesHead = target.roleCode === 'section_head' && target.isActive &&
    (change.remove || change.isActive === false || (change.roleCode !== undefined && change.roleCode !== 'section_head'));
  if (target.authUserId === callerId) {
    if (change.remove) return 'You cannot delete your own login.';
    if (change.isActive === false) return 'You cannot disable your own login.';
    if (losesHead) return 'You cannot remove the Section Head role from your own login.';
  }
  if (losesHead && activeSectionHeads <= 1) return 'At least one active Section Head login must remain.';
  return null;
}
