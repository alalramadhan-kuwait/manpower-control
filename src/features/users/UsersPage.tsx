import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, KeyRound, Plus, RefreshCw, Trash2, UserCog } from 'lucide-react';
import type { EmployeeDirectoryRow, UserProfile } from '@/data/types';
import { fetchDirectory } from '@/data/queries';
import { createUser, deleteUser, fetchRoles, listUsers, updateUser, type AppRole, type ManagedUser } from '@/data/users';
import { accountEmail, passwordProblem } from '@/core/users/rules';
import { BottomSheet, Button, Card, Chip, EmptyState, ErrorBox, Field, PageHeader, Spinner, cx, fmtDate } from '@/ui/components';

const lastSeen = (iso: string | null) => (iso ? `${fmtDate(iso.slice(0, 10))}` : 'Never signed in');

function StatusChip({ u }: { u: ManagedUser }) {
  if (!u.role_code) return <Chip tone="amber">No role</Chip>;
  if (!u.is_active || u.banned) return <Chip tone="red">Disabled</Chip>;
  if (u.employee_id && u.employee_active === false) return <Chip tone="red">Staff inactive · no access</Chip>;
  if (u.role_code === 'employee') return <Chip>No app access</Chip>;
  return <Chip tone="green">Active</Chip>;
}

const ROLE_WHO: Record<string, string> = { controller: 'Controller', vr_controller: 'VR Controller', morning_controller: 'Morning Controller', panel_operator: 'Panel', field_operator: 'Field', section_head: 'Section Head', operating_engineer: 'Engineer' };

/** Links the login to one staff member (one login per person). People who already have another login are shown but cannot be chosen. */
function StaffPicker({ staff, users, self, value, onChange }: { staff: EmployeeDirectoryRow[]; users: ManagedUser[]; self: string | null; value: string; onChange: (id: string, name: string) => void }) {
  const loginOf = new Map(users.filter((u) => u.employee_id && u.auth_user_id !== self).map((u) => [u.employee_id!, u.display_name ?? u.username]));
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value, staff.find((x) => x.id === e.target.value)?.display_name ?? '')}>
      <option value="">Not linked to a staff member</option>
      {staff.map((x) => (
        <option key={x.id} value={x.id} disabled={loginOf.has(x.id)}>
          {x.display_name} · {x.crew_code ? `${x.crew_code} Shift ` : ''}{ROLE_WHO[x.position_code ?? ''] ?? x.position_label ?? ''}{loginOf.has(x.id) ? ` (has login "${loginOf.get(x.id)}")` : ''}
        </option>
      ))}
    </select>
  );
}

/** Before saving: a one-holder role (Manpower Coordinator) is taken from whoever holds it now. */
function RoleMoveNote({ roles, role, users, self }: { roles: AppRole[]; role: string; users: ManagedUser[]; self: string | null }) {
  const r = roles.find((x) => x.code === role);
  if (!r?.one_holder) return null;
  const holders = users.filter((u) => u.role_code === role && u.auth_user_id !== self);
  if (!holders.length) return <p className="text-xs text-slate-500">Only one login can be {r.label} at a time.</p>;
  return (
    <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span><b>{holders.map((h) => h.employee_name ?? h.display_name ?? h.username).join(', ')}</b> is {r.label} now. Saving moves the role to this login; {holders.length === 1 ? 'their' : 'those'} login keeps working for sign-in but loses all app access. The change is written to the audit history.</span>
    </div>
  );
}

const moved = (r: { moved_from?: string[] } | unknown, label: string) => {
  const from = (r as { moved_from?: string[] })?.moved_from ?? [];
  return from.length ? ` ${label} role taken from ${from.join(', ')}, who no longer has app access.` : '';
};

function newPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <input className="input" style={{ paddingRight: '2.75rem' }} type={show ? 'text' : 'password'} autoComplete="new-password" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-500">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <Button type="button" variant="secondary" onClick={() => { onChange(newPassword()); setShow(true); }} title="Generate a password"><KeyRound className="h-4 w-4" /></Button>
    </div>
  );
}

function RolePicker({ roles, value, onChange, locked }: { roles: AppRole[]; value: string; onChange: (v: string) => void; locked?: string }) {
  return (
    <div className="space-y-2">
      {roles.map((r) => (
        <label key={r.code} className={cx('flex items-center gap-3 rounded-xl px-3 py-2 ring-1', value === r.code ? 'bg-brand-50 ring-brand-600/40' : 'ring-slate-200', (!r.is_active || locked) && 'opacity-50')}>
          <input type="radio" name="role" checked={value === r.code} disabled={!r.is_active || Boolean(locked)} onChange={() => onChange(r.code)} />
          <span className="flex-1 text-sm text-slate-800">{r.label}</span>
          {!r.is_active && <span className="text-[11px] text-slate-500">later stage</span>}
        </label>
      ))}
      {locked && <p className="text-xs text-slate-500">{locked}</p>}
    </div>
  );
}

function CreateSheet({ roles, staff, users, onClose, onDone }: { roles: AppRole[]; staff: EmployeeDirectoryRow[]; users: ManagedUser[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [name, setName] = useState(''); const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [employee, setEmployee] = useState('');
  const [role, setRole] = useState('manpower_coordinator'); const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const problem = !name.trim() ? 'Enter a name.' : !accountEmail(username) ? 'Username: 2–32 letters, digits, dot, dash or underscore.' : passwordProblem(password);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await createUser({ username: username.trim().toLowerCase(), password, display_name: name.trim(), role_code: role, employee_id: employee || null });
      onDone(`Login "${username.trim().toLowerCase()}" created. Give the person the username and password.${moved(r, roles.find((x) => x.code === role)?.label ?? '')}`);
    }
    catch (e) { setErr(e); } finally { setBusy(false); }
  }
  return (
    <BottomSheet open onClose={onClose} title="New login">
      <div className="space-y-4">
        <Field label="Staff member" hint="Who this login belongs to. If the staff member is made inactive, the login loses access."><StaffPicker staff={staff} users={users} self={null} value={employee} onChange={(id, n) => { setEmployee(id); if (id && !name.trim()) setName(n); }} /></Field>
        <Field label="Name shown in the app"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Manpower Coordinator" /></Field>
        <Field label="Username" hint="What they type to sign in, e.g. ajr015."><input className="input" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Password" hint="At least 8 characters. The key button makes one."><PasswordInput value={password} onChange={setPassword} /></Field>
        <Field label="Role"><RolePicker roles={roles} value={role} onChange={setRole} /></Field>
        <RoleMoveNote roles={roles} role={role} users={users} self={null} />
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={busy || Boolean(problem)} onClick={save}>{busy ? 'Creating…' : 'Create login'}</Button>
        </div>
        {problem && (name || username || password) && <p className="text-xs text-slate-500">{problem}</p>}
      </div>
    </BottomSheet>
  );
}

function EditSheet({ user, roles, staff, users, isMe, onClose, onDone }: { user: ManagedUser; roles: AppRole[]; staff: EmployeeDirectoryRow[]; users: ManagedUser[]; isMe: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [name, setName] = useState(user.display_name ?? ''); const [username, setUsername] = useState(user.username);
  const [employee, setEmployee] = useState(user.employee_id ?? '');
  const [role, setRole] = useState(user.role_code ?? ''); const [active, setActive] = useState(user.role_code ? user.is_active && !user.banned : true);
  const [password, setPassword] = useState(''); const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const problem = !name.trim() ? 'Enter a name.' : !accountEmail(username) ? 'Username: 2–32 letters, digits, dot, dash or underscore.' : !role ? 'Choose a role.' : password ? passwordProblem(password) : null;
  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true); setErr(null);
    try { const r = await fn(); onDone(msg + moved(r, roles.find((x) => x.code === role)?.label ?? '')); } catch (e) { setErr(e); } finally { setBusy(false); }
  }
  const save = () => run(() => updateUser(user.auth_user_id, {
    display_name: name.trim(), username: username.trim().toLowerCase(), role_code: role, is_active: active, ...(password ? { password } : {}),
    ...(employee !== (user.employee_id ?? '') ? { employee_id: employee || null } : {})
  }), password ? `Saved. New password set for "${username.trim().toLowerCase()}".` : 'Saved.');
  return (
    <BottomSheet open onClose={onClose} title={isMe ? 'Your login' : 'Edit login'}>
      <div className="space-y-4">
        <Field label="Staff member" hint="Who this login belongs to. If the staff member is made inactive, the login loses access."><StaffPicker staff={staff} users={users} self={user.auth_user_id} value={employee} onChange={(id) => setEmployee(id)} /></Field>
        <Field label="Name shown in the app"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Username"><input className="input" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field label="Role"><RolePicker roles={roles} value={role} onChange={setRole} locked={isMe ? 'You cannot change your own role.' : undefined} /></Field>
        {role !== user.role_code && <RoleMoveNote roles={roles} role={role} users={users} self={user.auth_user_id} />}
        <label className={cx('flex items-center justify-between rounded-xl px-3 py-3 ring-1 ring-slate-200', isMe && 'opacity-50')}>
          <span><span className="block text-sm font-medium text-slate-800">Can sign in</span><span className="block text-xs text-slate-500">Turn off to block the login without deleting it.</span></span>
          <input type="checkbox" className="h-5 w-5" checked={active} disabled={isMe} onChange={(e) => setActive(e.target.checked)} />
        </label>
        <Field label="Reset password" hint="Leave empty to keep the current password."><PasswordInput value={password} onChange={setPassword} placeholder="New password" /></Field>
        {err != null && <ErrorBox error={err} />}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={busy || Boolean(problem)} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
        {problem && <p className="text-xs text-slate-500">{problem}</p>}
        {!isMe && (
          <div className="border-t border-slate-100 pt-4">
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-sm text-slate-700">Delete <b>{user.username}</b> permanently? The login stops working at once. Its past actions stay in the audit history.</p>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>Keep</Button>
                  <Button variant="danger" className="flex-1" disabled={busy} onClick={() => run(() => deleteUser(user.auth_user_id), `Login "${user.username}" deleted.`)}>Delete</Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" className="w-full text-red-700 hover:bg-red-50" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /> Delete login</Button>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

export default function UsersPage({ profile }: { profile: UserProfile }) {
  const [users, setUsers] = useState<ManagedUser[] | null>(null); const [roles, setRoles] = useState<AppRole[]>([]);
  const [staff, setStaff] = useState<EmployeeDirectoryRow[]>([]);
  const [err, setErr] = useState<unknown>(null); const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagedUser | null>(null); const [creating, setCreating] = useState(false);
  const load = useCallback(async () => {
    setErr(null);
    try {
      const [u, r, d] = await Promise.all([listUsers(), fetchRoles(), fetchDirectory()]);
      setUsers(u); setRoles(r); setStaff(d.filter((x) => x.is_active && x.in_unit12_scope).sort((a, b) => a.display_name.localeCompare(b.display_name)));
    } catch (e) { setErr(e); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const done = (msg: string) => { setEditing(null); setCreating(false); setNotice(msg); load(); };
  const roleLabel = (code: string | null) => roles.find((r) => r.code === code)?.label ?? code ?? '—';

  if (profile.role_code !== 'section_head') return <EmptyState title="Section Head only" body="Only the Section Head can manage logins." />;
  return (
    <div>
      <PageHeader title="Users & access" subtitle="Create logins, change roles, reset passwords, block or delete access."
        action={<Button className="shrink-0 whitespace-nowrap" onClick={() => { setNotice(null); setCreating(true); }}><Plus className="h-4 w-4" /> New login</Button>} />
      {notice && <div className="mb-3 rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800 ring-1 ring-green-200">{notice}</div>}
      {err != null && <div className="mb-3 space-y-2"><ErrorBox error={err} /><Button variant="secondary" onClick={load}><RefreshCw className="h-4 w-4" /> Try again</Button></div>}
      {!users && !err && <Spinner />}
      {users && (
        <>
          <div className="space-y-2 lg:hidden">
            {users.map((u) => (
              <button key={u.auth_user_id} onClick={() => { setNotice(null); setEditing(u); }} className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 active:bg-slate-50">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><UserCog className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-800">{u.display_name ?? u.username}{u.auth_user_id === profile.auth_user_id && <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>}</span>
                  <span className="block truncate text-xs text-slate-500">{u.username} · {roleLabel(u.role_code)}</span>
                  <span className="block truncate text-xs text-slate-500">{u.employee_name ? `Staff: ${u.employee_name}` : 'Not linked to a staff member'}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 whitespace-nowrap"><StatusChip u={u} /><span className="text-[11px] text-slate-500">{lastSeen(u.last_sign_in_at)}</span></span>
                </span>
              </button>
            ))}
          </div>
          <Card className="hidden overflow-hidden p-0 lg:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Staff member</th><th className="px-4 py-3">Username</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Last sign-in</th><th className="px-4 py-3" /></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.auth_user_id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{u.display_name ?? '—'}{u.auth_user_id === profile.auth_user_id && <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>}</td>
                    <td className="px-4 py-3 text-slate-600">{u.employee_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{u.username}</td>
                    <td className="px-4 py-3 text-slate-600">{roleLabel(u.role_code)}</td>
                    <td className="px-4 py-3"><StatusChip u={u} /></td>
                    <td className="px-4 py-3 text-slate-600">{lastSeen(u.last_sign_in_at)}</td>
                    <td className="px-4 py-3 text-right"><Button variant="secondary" onClick={() => { setNotice(null); setEditing(u); }}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="mt-4 text-xs text-slate-500">Section Head: full control, including this screen. Manpower Coordinator: everything except managing logins; only one login holds it at a time, so giving it to someone else takes it away from the previous holder. Staff (no app access yet): can sign in but sees nothing until given a role. A login linked to a staff member who is made inactive loses access. Every change here is written to the audit history.</p>
        </>
      )}
      {creating && users && <CreateSheet roles={roles} staff={staff} users={users} onClose={() => setCreating(false)} onDone={done} />}
      {editing && users && <EditSheet user={editing} roles={roles} staff={staff} users={users} isMe={editing.auth_user_id === profile.auth_user_id} onClose={() => setEditing(null)} onDone={done} />}
    </div>
  );
}
