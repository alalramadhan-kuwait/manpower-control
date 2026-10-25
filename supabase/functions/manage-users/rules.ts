/**
 * Account rules shared by the Users screen and the `manage-users` Edge Function.
 * This file has no imports so the Edge Function can ship a byte-identical copy
 * (supabase/functions/manage-users/rules.ts); a test keeps the two in step.
 */
export const USERNAME_DOMAIN = 'manpower-control.local';
export const MIN_PASSWORD = 6;
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

/** IT rule: the company login is never used here. A username that looks like a company ID (letters then digits,
 *  e.g. "abc015"), a staff / badge number or an email address is refused. */
export function looksLikeCompanyId(username: string): boolean {
  const v = username.trim().toLowerCase();
  // an address on this app's own local domains (e.g. coordinator@area4-manpower.local) is an app login, not a company one
  if (v.includes('@')) return !v.endsWith('.local');
  return /^[a-z]{2,4}\d{2,4}$/.test(v) || /^\d+$/.test(v);
}
export function usernameProblem(username: string): string | null {
  const v = username.trim().toLowerCase();
  if (looksLikeCompanyId(v)) return 'Not a company ID, staff number or email. Example: u12.ali';
  return USERNAME.test(v) ? null : 'Username: 2–32 letters, digits, dot, dash or underscore.';
}
/** The person's own app password: 8+ characters, not the username. */
export const OWN_PASSWORD_MIN = 8;
export function ownPasswordProblem(password: string, username: string): string | null {
  if (password.length < OWN_PASSWORD_MIN) return `At least ${OWN_PASSWORD_MIN} characters.`;
  if (username && password.toLowerCase().includes(username.toLowerCase())) return 'Do not use your username in it.';
  return null;
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
