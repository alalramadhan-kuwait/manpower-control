// IT rule: the company login is never used in this app. A username that looks like a company ID is blocked (the
// Section Head gives a new one); everyone sets their own app password at the next sign-in, confirming it is not
// their company password.
import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/data/supabase';
import { looksLikeCompanyId, ownPasswordProblem, usernameOf } from '@/core/users/rules';
import { Button, ErrorBox, Field } from '@/ui/components';
import { BrandBackdrop, BrandLockup } from '@/ui/brand';

/** What still has to happen before this login may use the app (null = nothing). */
export function ownLoginStep(session: Session, roleCode: string): 'username' | 'password' | null {
  const username = usernameOf(session.user.email);
  if (looksLikeCompanyId(username) && roleCode !== 'section_head') return 'username';
  return session.user.user_metadata?.own_pw ? null : 'password';
}

export function OwnLogin({ session, step }: { session: Session; step: 'username' | 'password' }) {
  const username = usernameOf(session.user.email);
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [notCompany, setNotCompany] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<unknown>(null);
  const problem = ownPasswordProblem(pw, username) ?? (pw2 && pw2 !== pw ? 'The two passwords differ.' : null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (problem || pw !== pw2 || !notCompany) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.updateUser({ password: pw, data: { own_pw: true } });
    if (error) setErr(error); setBusy(false);
  }
  return (
    <BrandBackdrop>
      <div className="flex flex-1 flex-col justify-center px-4 py-10 safe-top">
        <div className="mx-auto w-full max-w-sm">
          <BrandLockup stacked product="Manpower Control" className="mb-8" />
          {step === 'username' ? (
            <div className="space-y-4 rounded-2xl bg-white/95 p-5 shadow-lg ring-1 ring-slate-200">
              <h1 className="text-[17px] font-bold text-brand-700">New username needed</h1>
              <p className="text-sm text-slate-600">“{username}” looks like a company ID. Ask the Section Head for an app username.</p>
              <Button variant="secondary" className="w-full" onClick={() => supabase.auth.signOut()}>Sign out</Button>
            </div>
          ) : (
            <form onSubmit={save} className="space-y-4 rounded-2xl bg-white/95 p-5 shadow-lg ring-1 ring-slate-200">
              <h1 className="text-[17px] font-bold text-brand-700">Set your app password</h1>
              <Field label="New password"><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
              <Field label="Again"><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
              <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={notCompany} onChange={(e) => setNotCompany(e.target.checked)} />This is not my company password.</label>
              {pw && problem && <p className="text-xs text-red-700">{problem}</p>}
              {err != null && <ErrorBox error={err} />}
              <Button type="submit" className="w-full" disabled={busy || !!problem || pw !== pw2 || !notCompany}>{busy ? 'Saving…' : 'Save'}</Button>
              <button type="button" className="w-full text-xs text-slate-500" onClick={() => supabase.auth.signOut()}>Sign out</button>
            </form>
          )}
        </div>
      </div>
    </BrandBackdrop>
  );
}
