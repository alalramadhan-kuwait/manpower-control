import { useState } from 'react';
import { supabase } from '@/data/supabase';
import { Button, Field } from '@/ui/components';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="min-h-full flex flex-col justify-center px-4 py-10 safe-top">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-700 text-2xl font-bold text-white">A4</div>
          <h1 className="text-2xl font-semibold text-brand-800">Area 4 Manpower Control</h1>
          <p className="mt-1 text-sm text-slate-600">KNPC · Mina Abdullah Refinery · Unit 12 · Section 1</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <Field label="Email">
            <input className="input" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-500">Internal KNPC operations tool. Access is limited to the Section Head and the Manpower Coordinator.</p>
      </div>
    </div>
  );
}
