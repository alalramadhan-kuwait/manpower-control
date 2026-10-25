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
  // the first view says what the site is; the sign-in form opens on request (not a bare login box)
  const [form, setForm] = useState(false);

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
          {!form && <div className="space-y-4 rounded-2xl bg-white/95 p-5 shadow-lg shadow-brand-900/5 ring-1 ring-slate-200 backdrop-blur">
            <div>
              <h1 className="text-[17px] font-bold text-brand-700">Internal operations tool</h1>
              <p className="mt-1 text-sm leading-6 text-slate-600">Shift manpower, leave and shutdown progress for the Area 4 · Unit 12 operations team. For staff with an account from the Section Head only.</p>
            </div>
            <Button className="w-full" onClick={() => setForm(true)}>Sign in</Button>
          </div>}
          {form && <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white/95 p-5 shadow-lg shadow-brand-900/5 ring-1 ring-slate-200 backdrop-blur">
            <Field label="Username">
              <input className="input" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="your app username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password">
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            <p className="text-xs font-semibold text-slate-600">App login only. Never your company ID or company password.</p>
            {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>}
          <p className="mt-5 text-center text-xs text-slate-500">Internal operations app. Access is given by the Section Head. · <a href="/about.html" className="font-semibold text-brand-700 underline">About this site</a></p>
        </div>
      </div>
    </BrandBackdrop>
  );
}
