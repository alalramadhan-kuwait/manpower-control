import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/data/supabase';
import type { UserProfile } from '@/data/types';

export interface SessionState {
  loading: boolean;
  session: Session | null;
  profile: UserProfile | null;
  profileError: string | null;
  /** Role the database grants right now (null when the login is disabled or its linked staff member is inactive). */
  access: string | null;
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ loading: true, session: null, profile: null, profileError: null, access: null });

  useEffect(() => {
    let cancelled = false;
    async function loadProfile(session: Session | null) {
      if (!session) { if (!cancelled) setState({ loading: false, session: null, profile: null, profileError: null, access: null }); return; }
      const [{ data, error }, role] = await Promise.all([
        supabase.from('user_profiles').select('*').eq('auth_user_id', session.user.id).maybeSingle(),
        supabase.rpc('app_current_role')
      ]);
      if (cancelled) return;
      const access = (role.data as string | null) ?? null;
      if (error) setState({ loading: false, session, profile: null, profileError: error.message, access });
      else setState({ loading: false, session, profile: (data as UserProfile | null), profileError: data ? null : 'No role has been assigned to this login yet.', access });
    }
    supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => { loadProfile(session); });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  return state;
}

export const ROLE_LABEL: Record<string, string> = {
  section_head: 'Section Head', manpower_coordinator: 'Manpower Coordinator', controller: 'Controller', employee: 'Staff (no app access yet)'
};
