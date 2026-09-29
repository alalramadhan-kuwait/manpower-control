// Server stand-in for src/data/supabase.ts: the same data layer runs here with the service key.
import { createClient } from 'npm:@supabase/supabase-js@2';

const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  (JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>).default;
export const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
