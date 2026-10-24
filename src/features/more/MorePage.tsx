import { Bell, ChevronRight, LogOut } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/data/supabase';
import type { UserProfile } from '@/data/types';
import { ROLE_LABEL } from '@/features/auth/useSession';
import { WORKSPACES } from '@/app/moreItems';
import { VersionLine } from '@/app/VersionLine';
import { LangSwitch, t } from '@/i18n';
import { Button, Card, PageHeader } from '@/ui/components';

/** More: the six workspaces, notifications, language and sign out. */
export default function MorePage({ profile }: { profile: UserProfile }) {
  return (
    <div className="lg:max-w-3xl">
      <PageHeader title="More" subtitle={[...new Set([profile.display_name, t(ROLE_LABEL[profile.role_code])])].join(' · ')} />
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {WORKSPACES.map(({ to, label, desc, icon: Icon }) => (
          <li key={to}>
            <Link to={to} className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-slate-50">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1"><span className="block font-medium text-slate-800">{t(label)}</span><span className="block truncate text-xs text-slate-500">{desc.split(' · ').map((d) => t(d)).join(' · ')}</span></span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 rtl:rotate-180" />
            </Link>
          </li>
        ))}
        <li>
          <Link to="/notifications" className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-slate-50">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Bell className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1"><span className="block font-medium text-slate-800">{t('Notifications')}</span><span className="block truncate text-xs text-slate-500">{t('Open alerts and resolved history')}</span></span>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 rtl:rotate-180" />
          </Link>
        </li>
      </ul>
      <Card className="mt-4">
        <div className="mb-2 text-sm font-medium text-slate-700">{t('Language')}</div>
        <LangSwitch />
      </Card>
      <Card className="mt-4">
        <div className="text-sm text-slate-600">{t('Signed in as')} <span className="font-medium text-slate-800">{profile.display_name}</span></div>
        <Button variant="secondary" className="mt-3 w-full" onClick={() => supabase.auth.signOut()}><LogOut className="h-4 w-4" /> {t('Sign out')}</Button>
      </Card>
      <VersionLine className="mt-6 text-center text-[11px] text-slate-500" />
      <p className="mt-2 text-center text-[11px] text-slate-500">ARDS Operations · Area 4 · Unit 12 · Manpower Control</p>
    </div>
  );
}
