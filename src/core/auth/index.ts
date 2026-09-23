/**
 * Short usernames (e.g. "ajr015") sign in as `<username>@manpower-control.local`: Supabase Auth needs an
 * email address, and a fixed domain means the real email of an account is never looked up or exposed.
 * Anything containing "@" is used as an email as typed.
 */
export const USERNAME_DOMAIN = 'manpower-control.local';

export function loginEmail(input: string): string {
  const v = input.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${USERNAME_DOMAIN}`;
}
