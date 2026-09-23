// Verifies Row Level Security from the outside, exactly as the browser would see it.
// usage: SH_EMAIL=.. SH_PASSWORD=.. MC_EMAIL=.. MC_PASSWORD=.. node scripts/rls-check.mjs   (reads VITE_* from .env)
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split('\n')) { const m = line.match(/^(\w+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_ANON_KEY;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const anon = createClient(url, key, { auth: { persistSession: false } });
{ const { data, error } = await anon.from('employees').select('id'); check('anonymous cannot read employees', !error && (data ?? []).length === 0, error?.message ?? `${data?.length} rows`); }
{ const { data, error } = await anon.from('employee_directory_v').select('id'); check('anonymous cannot read directory view', (data ?? []).length === 0, error?.message ?? `${data?.length} rows`); }
{ const { error } = await anon.rpc('commit_import_batch', { p_batch_id: '00000000-0000-0000-0000-000000000000' }); check('anonymous cannot call commit_import_batch', !!error, error?.message); }
async function asUser(label, email, password) {
  const c = createClient(url, key, { auth: { persistSession: false } });
  const { data: s, error } = await c.auth.signInWithPassword({ email, password });
  check(`${label}: login through Supabase Auth`, !error && !!s.session, error?.message);
  if (error) return;
  const { data: prof } = await c.from('user_profiles').select('role_code').eq('auth_user_id', s.user.id).maybeSingle();
  check(`${label}: profile role loaded`, !!prof, prof?.role_code);
  const { data: emps, error: e1 } = await c.from('employee_directory_v').select('id');
  check(`${label}: reads all employees in scope`, !e1 && (emps ?? []).length === 60, e1?.message ?? `${emps?.length} rows`);
  const { data: audit } = await c.from('audit_log').select('id').limit(1);
  check(`${label}: can read audit log`, (audit ?? []).length === 1);
  const { error: e2 } = await c.from('audit_log').insert({ entity_table: 'x', action: 'x' });
  check(`${label}: cannot write audit log directly`, !!e2, e2?.message);
  const { error: e3 } = await c.from('user_profiles').insert({ auth_user_id: s.user.id, role_code: 'employee', display_name: 'x' });
  if (prof?.role_code === 'section_head') check(`${label}: may manage user_profiles (duplicate rejected by unique key, not by RLS)`, !!e3 && /duplicate|unique/i.test(e3.message), e3?.message);
  else check(`${label}: cannot manage user_profiles`, !!e3 && /policy|permission|row-level/i.test(e3.message), e3?.message);
  const { error: e4 } = await c.from('absence_types').update({ label: 'Planned Annual Leave' }).eq('code', 'annual_leave_planned');
  if (prof?.role_code === 'section_head') check(`${label}: may edit reference data`, !e4, e4?.message);
  else { const { data: after } = await c.from('absence_types').select('label').eq('code', 'annual_leave_planned').single(); check(`${label}: reference data edit is silently blocked by RLS`, !e4 && after?.label === 'Planned Annual Leave'); }
  // profile update round-trip on the note field of one employee
  const { data: one } = await c.from('employees').select('id, notes').eq('employee_number', process.env.RLS_EMPLOYEE_NUMBER ?? '').single();
  const marker = `rls-check ${new Date().toISOString()}`;
  const { error: e5 } = await c.from('employees').update({ notes: marker }).eq('id', one.id);
  const { data: back } = await c.from('employees').select('notes').eq('id', one.id).single();
  check(`${label}: profile update saves and reads back`, !e5 && back?.notes === marker, e5?.message);
  await c.from('employees').update({ notes: one.notes }).eq('id', one.id);
  await c.auth.signOut();
}
if (process.env.SH_EMAIL) await asUser('Section Head', process.env.SH_EMAIL, process.env.SH_PASSWORD);
if (process.env.MC_EMAIL) await asUser('Manpower Coordinator', process.env.MC_EMAIL, process.env.MC_PASSWORD);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
