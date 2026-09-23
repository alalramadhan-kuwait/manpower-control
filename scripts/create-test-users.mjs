// Creates the two initial logins through Supabase Auth (anon key + signUp). Prints the credentials once.
// Profiles (role assignment) are inserted separately with SQL because user_profiles is Section-Head-managed.
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
const url = process.env.VITE_SUPABASE_URL, key = process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing');
const sb = createClient(url, key, { auth: { persistSession: false } });
const users = [
  { email: 'section.head@area4-manpower.local', role: 'section_head', name: 'Section Head' },
  { email: 'coordinator@area4-manpower.local', role: 'manpower_coordinator', name: 'Manpower Coordinator' }
];
const out = [];
for (const u of users) {
  const password = randomBytes(9).toString('base64url') + '!A4';
  const { data, error } = await sb.auth.signUp({ email: u.email, password, options: { data: { display_name: u.name } } });
  if (error) { console.error(u.email, error.message); continue; }
  out.push({ ...u, password, id: data.user?.id });
}
console.log(JSON.stringify(out, null, 2));
