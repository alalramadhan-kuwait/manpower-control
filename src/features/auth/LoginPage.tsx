import { useState } from 'react';
import { supabase } from '@/data/supabase';
import { Button, Field } from '@/ui/components';
import { BrandBackdrop, BrandLockup } from '@/ui/brand';
import { loginEmail } from '@/core/auth';

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
    <BrandBackdrop>
      <div className="flex flex-1 flex-col justify-center px-4 py-10 safe-top">
        <div className="mx-auto w-full max-w-sm">
          <BrandLockup stacked product="Manpower Control" className="mb-8" />
          <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white/95 p-5 shadow-lg shadow-brand-900/5 ring-1 ring-slate-200 backdrop-blur">
            <Field label="Username">
              <input className="input" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="e.g. ajr015" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password">
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>
          <p className="mt-5 text-center text-xs text-slate-500">Internal operations app. Access is given by the Section Head.</p>
        </div>
      </div>
    </BrandBackdrop>
  );
}
