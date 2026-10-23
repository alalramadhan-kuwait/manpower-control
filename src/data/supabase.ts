import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see .env.example)');
}

/** An engineer link on this device (its hidden key and the ID typed with it): sent with every request, the
 *  database lets it read and update the shutdown tracker only. */
export interface EngineerLink { key: string; id: string }
const LINK = 'trk-link';
export function engineerLink(): EngineerLink | null {
  try { const v = JSON.parse(localStorage.getItem(LINK) ?? 'null') as EngineerLink | null; return v?.key && v.id ? v : null; } catch { return null; }
}
export function setEngineerLink(v: EngineerLink | null) {
  try { if (v) localStorage.setItem(LINK, JSON.stringify(v)); else localStorage.removeItem(LINK); } catch { /* storage blocked */ }
}
const link = engineerLink();

/** The one Supabase client for the app. Project: area4-manpower-control (never a Time Keeper project). */
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  ...(link ? { global: { headers: { 'x-trk-key': link.key, 'x-trk-id': link.id } } } : {}),
});
