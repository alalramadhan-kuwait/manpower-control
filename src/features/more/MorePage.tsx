import { LogOut } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/data/supabase';
import type { UserProfile } from '@/data/types';
import { ROLE_LABEL } from '@/features/auth/useSession';
import { GROUPS } from '@/app/moreItems';
import { Button, Card, PageHeader } from '@/ui/components';

export default function MorePage({ profile }: { profile: UserProfile }) {
  return (
    <div>
      <PageHeader title="More" subtitle={[...new Set([profile.display_name, ROLE_LABEL[profile.role_code]])].join(' · ')} />
      <div className="space-y-4">
        {GROUPS.map((g) => {
          const items = g.items.filter((i) => !i.headOnly || profile.role_code === 'section_head');
          return (
            <section key={g.title}>
              <h2 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.title}</h2>
              <div className="grid grid-cols-2 gap-2">
                {items.map(({ to, label, desc, icon: Icon }) => (
                  <Link key={to} to={to} className="flex min-h-[5.5rem] flex-col justify-between gap-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200 active:bg-slate-50">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0"><span className="block text-sm font-medium leading-tight text-slate-800">{label}</span><span className="mt-0.5 block text-[11px] leading-tight text-slate-500">{desc}</span></span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <Card className="mt-6">
        <div className="text-sm text-slate-600">Signed in as <span className="font-medium text-slate-800">{profile.display_name}</span></div>
        <Button variant="secondary" className="mt-3 w-full" onClick={() => supabase.auth.signOut()}><LogOut className="h-4 w-4" /> Sign out</Button>
      </Card>
      <p className="mt-6 text-center text-[11px] text-slate-400">ARDS Operations · Area 4 · Unit 12 · Manpower Control · standalone from Time Keeper</p>
    </div>
  );
}
