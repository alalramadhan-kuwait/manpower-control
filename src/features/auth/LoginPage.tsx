import { useState } from 'react';
import { supabase } from '@/data/supabase';
import { Button, Field } from '@/ui/components';
import { PortalMark } from '@/ui/brand';
import { loginEmail } from '@/core/auth';

/** The public page (before sign-in): neutral, no organisation, site or unit named (owner, 26 Oct 2026). */
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(email), password });
    if (error) setError(error.message === 'Invalid login credentials' ? 'Username or password is not correct.' : error.message);
    setBusy(false);
  }

  return (
    <div className="flex min-h-full flex-col bg-white">
      <div className="flex flex-1 flex-col justify-center px-4 py-10 safe-top">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <PortalMark className="h-14 w-14" />
            <h1 className="mt-4 text-[22px] font-bold text-brand-700">Operations Portal</h1>
            <p className="mt-1 text-sm text-slate-500">Secure access for authorized users</p>
          </div>
          <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
            <Field label="Username">
              <input className="input" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password">
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>
          <p className="mt-5 text-center text-xs text-slate-500">Use your portal account only, never a corporate password. · <a href="/about.html" className="font-semibold text-brand-700 underline">About</a></p>
        </div>
      </div>
    </div>
  );
}
