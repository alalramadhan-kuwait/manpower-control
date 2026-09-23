import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface ManagedUser {
  auth_user_id: string;
  profile_id: string | null;
  username: string;
  email: string | null;
  display_name: string | null;
  role_code: string | null;
  is_active: boolean;
  banned: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface AppRole { code: string; label: string; is_active: boolean }

/** All account changes go through the `manage-users` Edge Function (it holds the Auth admin key). */
async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('manage-users', { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const msg = await error.context.json().then((b: { error?: string }) => b.error).catch(() => null);
      throw new Error(msg ?? error.message);
    }
    throw error;
  }
  return data as T;
}

export const listUsers = () => call<{ users: ManagedUser[] }>({ action: 'list' }).then((r) => r.users);
export const createUser = (u: { username: string; password: string; display_name: string; role_code: string }) => call({ action: 'create', ...u });
export const updateUser = (auth_user_id: string, patch: { username?: string; password?: string; display_name?: string; role_code?: string; is_active?: boolean }) =>
  call({ action: 'update', auth_user_id, ...patch });
export const deleteUser = (auth_user_id: string) => call({ action: 'delete', auth_user_id });

export async function fetchRoles(): Promise<AppRole[]> {
  const { data, error } = await supabase.from('app_roles').select('code,label,is_active').order('sort_order');
  if (error) throw error;
  return data as AppRole[];
}
