import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/data/supabase';
import type { UserProfile } from '@/data/types';

export interface SessionState {
  loading: boolean;
  session: Session | null;
  profile: UserProfile | null;
  profileError: string | null;
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ loading: true, session: null, profile: null, profileError: null });

  useEffect(() => {
    let cancelled = false;
    async function loadProfile(session: Session | null) {
      if (!session) { if (!cancelled) setState({ loading: false, session: null, profile: null, profileError: null }); return; }
      const { data, error } = await supabase.from('user_profiles').select('*').eq('auth_user_id', session.user.id).maybeSingle();
      if (cancelled) return;
      if (error) setState({ loading: false, session, profile: null, profileError: error.message });
      else setState({ loading: false, session, profile: (data as UserProfile | null), profileError: data ? null : 'No role has been assigned to this login yet.' });
    }
    supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => { loadProfile(session); });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  return state;
}

export const ROLE_LABEL: Record<string, string> = {
  section_head: 'Section Head', manpower_coordinator: 'Manpower Coordinator', controller: 'Controller', employee: 'Employee'
};
