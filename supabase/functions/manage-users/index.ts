// Area 4 Manpower Control — account management for the Section Head.
// Creating and editing logins needs the Auth admin API (service key), which must never reach the browser,
// so the Users screen calls this function. Every call is checked against the caller's own session:
// only an active Section Head may use it. Passwords are never logged or written to the audit trail.
// A login can be linked to one staff member. A one-holder role (Manpower Coordinator) moves with the person:
// giving it to a login takes it from the previous holder (set_login_role), and that change is audited too.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { accountEmail, lockoutProblem, passwordProblem, usernameOf } from './rules.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const FOREVER = '876000h';

const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  (JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>).default;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

class Refused extends Error {}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

interface Profile { id: string; auth_user_id: string; role_code: string; display_name: string; is_active: boolean; employee_id: string | null }

interface Role { code: string; label: string; one_holder: boolean }
async function activeRoles(): Promise<Map<string, Role>> {
  const { data, error } = await admin.from('app_roles').select('code,label,one_holder').eq('is_active', true);
  if (error) throw error;
  return new Map((data as Role[]).map((r) => [r.code, r]));
}
/** A staff member a login may be linked to: exists, active, and not linked to another login. */
async function checkStaff(employeeId: string, exceptProfile: string | null): Promise<{ id: string; display_name: string }> {
  const { data: e, error } = await admin.from('employees').select('id,display_name,is_active').eq('id', employeeId).maybeSingle();
  if (error) throw error;
  if (!e) throw new Refused('Staff member not found.');
  if (!e.is_active) throw new Refused(`${e.display_name} is not an active staff member.`);
  let q = admin.from('user_profiles').select('id,display_name').eq('employee_id', employeeId);
  if (exceptProfile) q = q.neq('id', exceptProfile);
  const { data: other, error: oErr } = await q.maybeSingle();
  if (oErr) throw oErr;
  if (other) throw new Refused(`${e.display_name} already has a login ("${other.display_name}"). Unlink it there first.`);
  return { id: e.id, display_name: e.display_name };
}
/** Sets the role in one database step; a one-holder role is taken from whoever had it, and each loss is audited. */
async function setRole(caller: string, profileId: string, roleCode: string, role: Role, newHolder: string) {
  const { data: lost, error } = await admin.rpc('set_login_role', { p_profile: profileId, p_role: roleCode });
  if (error) throw error;
  for (const l of (lost ?? []) as { profile_id: string; display_name: string }[]) {
    await audit(caller, l.profile_id, 'update', { role_code: roleCode, display_name: l.display_name }, { role_code: 'employee', display_name: l.display_name },
      `${role.label} role moved to ${newHolder}; this login no longer has app access`);
  }
  return ((lost ?? []) as { display_name: string }[]).map((l) => l.display_name);
}
async function profileOf(authUserId: string): Promise<Profile | null> {
  const { data, error } = await admin.from('user_profiles').select('*').eq('auth_user_id', authUserId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}
async function activeSectionHeads(): Promise<number> {
  const { count, error } = await admin.from('user_profiles').select('id', { count: 'exact', head: true }).eq('role_code', 'section_head').eq('is_active', true);
  if (error) throw error;
  return count ?? 0;
}
async function audit(actor: string, entityId: string | null, action: string, previous: unknown, next: unknown, reason: string) {
  const { error } = await admin.from('audit_log').insert({ actor_id: actor, entity_table: 'user_accounts', entity_id: entityId, action, previous, next, reason });
  if (error) throw error;
}
async function listUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  const { data: profiles, error } = await admin.from('user_profiles').select('*, employees(display_name, is_active)');
  if (error) throw error;
  const byAuth = new Map((profiles as (Profile & { employees: { display_name: string; is_active: boolean } | null })[]).map((p) => [p.auth_user_id, p]));
  return users.map((u) => {
    const p = byAuth.get(u.id);
    return {
      auth_user_id: u.id, profile_id: p?.id ?? null, username: usernameOf(u.email), email: u.email ?? null,
      display_name: p?.display_name ?? null, role_code: p?.role_code ?? null, is_active: p?.is_active ?? false,
      employee_id: p?.employee_id ?? null, employee_name: p?.employees?.display_name ?? null, employee_active: p?.employees?.is_active ?? null,
      banned: Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
      created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null
    };
  }).sort((a, b) => (a.display_name ?? a.username).localeCompare(b.display_name ?? b.username));
}
const snapshot = (p: Profile | null, email?: string | null) => (p ? { role_code: p.role_code, display_name: p.display_name, is_active: p.is_active, employee_id: p.employee_id, username: usernameOf(email) } : null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });
  try {
    // --- who is calling
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: who, error: whoErr } = await admin.auth.getUser(token);
    if (whoErr || !who.user) return reply(401, { error: 'Sign in again.' });
    const caller = who.user.id;
    const me = await profileOf(caller);
    if (!me || !me.is_active || me.role_code !== 'section_head') return reply(403, { error: 'Only the Section Head can manage accounts.' });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : undefined);

    switch (body.action) {
      case 'list':
        return reply(200, { users: await listUsers() });

      case 'create': {
        const email = accountEmail(str('username') ?? '');
        if (!email) throw new Refused('Username: 2–32 letters, digits, dot, dash or underscore (or a full email address).');
        const password = str('password') ?? '';
        const pw = passwordProblem(password); if (pw) throw new Refused(pw);
        const staffId = str('employee_id') || null;
        const staff = staffId ? await checkStaff(staffId, null) : null;
        const displayName = (str('display_name') ?? '').trim() || staff?.display_name || '';
        if (!displayName) throw new Refused('Enter the name to show for this login.');
        const roleCode = str('role_code') ?? '';
        const role = (await activeRoles()).get(roleCode);
        if (!role) throw new Refused('Choose an active role.');
        const { data: made, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
        if (error) throw new Refused(/already/i.test(error.message) ? 'That username is already taken.' : error.message);
        // created without access, then given its role in one step (a one-holder role moves here)
        const { data: prof, error: pErr } = await admin.from('user_profiles')
          .insert({ auth_user_id: made.user.id, role_code: 'employee', display_name: displayName, is_active: true, employee_id: staff?.id ?? null }).select('*').single();
        if (pErr) { await admin.auth.admin.deleteUser(made.user.id); throw pErr; }
        let lost: string[];
        try { lost = await setRole(caller, (prof as Profile).id, roleCode, role, displayName); }
        catch (e) { await admin.auth.admin.deleteUser(made.user.id); throw e; }
        await audit(caller, (prof as Profile).id, 'insert', null, snapshot({ ...(prof as Profile), role_code: roleCode }, email), 'Account created by Section Head');
        return reply(200, { ok: true, moved_from: lost });
      }

      case 'update': {
        const id = str('auth_user_id'); if (!id) throw new Refused('Missing account.');
        const { data: target, error: tErr } = await admin.auth.admin.getUserById(id);
        if (tErr || !target.user) throw new Refused('Account not found.');
        const before = await profileOf(id);
        const roleCode = str('role_code');
        const isActive = typeof body.is_active === 'boolean' ? body.is_active : undefined;
        const lock = lockoutProblem(caller, { authUserId: id, roleCode: before?.role_code ?? null, isActive: before?.is_active ?? false }, { roleCode, isActive }, await activeSectionHeads());
        if (lock) throw new Refused(lock);
        const roles = await activeRoles();
        const role = roleCode !== undefined ? roles.get(roleCode) : undefined;
        if (roleCode !== undefined && roleCode !== before?.role_code && !role) throw new Refused('Choose an active role.');
        const linkChange = 'employee_id' in body;
        const staffId = linkChange ? (str('employee_id') || null) : undefined;
        const staff = staffId ? await checkStaff(staffId, before?.id ?? null) : null;

        // auth side: username, password, sign-in block
        const authChange: Record<string, unknown> = {};
        const newUsername = str('username');
        let email = target.user.email ?? null;
        if (newUsername !== undefined && accountEmail(newUsername) !== email) {
          const e = accountEmail(newUsername);
          if (!e) throw new Refused('Username: 2–32 letters, digits, dot, dash or underscore (or a full email address).');
          authChange.email = e; authChange.email_confirm = true; email = e;
        }
        const password = str('password');
        if (password) { const pw = passwordProblem(password); if (pw) throw new Refused(pw); authChange.password = password; }
        if (isActive !== undefined) authChange.ban_duration = isActive ? 'none' : FOREVER;
        if (Object.keys(authChange).length) {
          const { error } = await admin.auth.admin.updateUserById(id, authChange);
          if (error) throw new Refused(/already/i.test(error.message) ? 'That username is already taken.' : error.message);
        }

        // profile side: name, staff link, active; then the role in one step (a one-holder role moves here)
        const displayName = str('display_name')?.trim();
        const patch: Record<string, unknown> = {};
        if (displayName) patch.display_name = displayName;
        if (isActive !== undefined) patch.is_active = isActive;
        if (linkChange) patch.employee_id = staff?.id ?? null;
        let after = before;
        if (before && Object.keys(patch).length) {
          const { data, error } = await admin.from('user_profiles').update(patch).eq('id', before.id).select('*').single();
          if (error) throw error; after = data as Profile;
        } else if (!before) {
          if (!roleCode || !role) throw new Refused('Choose a role for this login.');
          const { data, error } = await admin.from('user_profiles')
            .insert({ auth_user_id: id, role_code: 'employee', display_name: displayName || staff?.display_name || usernameOf(email), is_active: isActive ?? true, employee_id: staff?.id ?? null }).select('*').single();
          if (error) throw error; after = data as Profile;
        }
        let lost: string[] = [];
        if (after && roleCode !== undefined && role && (roleCode !== after.role_code || !before)) {
          lost = await setRole(caller, after.id, roleCode, role, after.display_name);
          after = { ...after, role_code: roleCode };
        }
        await audit(caller, after?.id ?? null, 'update', snapshot(before, target.user.email), { ...snapshot(after, email), password_reset: Boolean(password) }, 'Account edited by Section Head');
        return reply(200, { ok: true, moved_from: lost });
      }

      case 'delete': {
        const id = str('auth_user_id'); if (!id) throw new Refused('Missing account.');
        const { data: target } = await admin.auth.admin.getUserById(id);
        const before = await profileOf(id);
        const lock = lockoutProblem(caller, { authUserId: id, roleCode: before?.role_code ?? null, isActive: before?.is_active ?? false }, { remove: true }, await activeSectionHeads());
        if (lock) throw new Refused(lock);
        await audit(caller, before?.id ?? null, 'delete', snapshot(before, target?.user?.email), null, 'Account deleted by Section Head');
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw error;
        return reply(200, { ok: true });
      }

      default:
        return reply(400, { error: 'Unknown action.' });
    }
  } catch (e) {
    if (e instanceof Refused) return reply(400, { error: e.message });
    console.error(e);
    return reply(500, { error: e instanceof Error ? e.message : 'Unexpected error.' });
  }
});
