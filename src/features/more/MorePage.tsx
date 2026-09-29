import { ArrowLeftRight, BadgeCheck, CalendarDays, HardHat, Bell, BarChart3, CalendarRange, ClipboardCheck, FileUp, Gauge, History, LogOut, ScrollText, ShieldCheck, Sun, UserCheck, UserCog } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/data/supabase';
import type { UserProfile } from '@/data/types';
import { ROLE_LABEL } from '@/features/auth/useSession';
import { Button, Card, PageHeader } from '@/ui/components';

type Item = { to: string; label: string; desc: string; icon: typeof Bell; headOnly?: boolean };
/** Related pages together, two to a row. */
const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Shifts & cover', items: [
    { to: '/movements', label: 'Shift movements', desc: 'Covers · moves · day duty', icon: ArrowLeftRight },
    { to: '/controllers', label: 'Controllers', desc: 'Cover · VR assignments', icon: UserCheck },
    { to: '/controllers/board', label: 'Controllers calendar', desc: 'Cover · leave rules', icon: CalendarDays },
    { to: '/controllers/morning', label: 'Morning rotation', desc: 'Plan to end of next year', icon: Sun }] },
  { title: 'Leave', items: [
    { to: '/leave-plan', label: 'Leave plan', desc: 'Year plan · add / correct', icon: CalendarRange },
    { to: '/oracle', label: 'Oracle HR', desc: 'Submitted · approved · pending', icon: BadgeCheck },
    { to: '/notifications', label: 'Notifications', desc: 'Next 60 days', icon: Bell }] },
  { title: 'Planning', items: [
    { to: '/operation', label: 'Operating modes', desc: 'Shutdown · one train', icon: Gauge },
    { to: '/shutdown', label: 'Shutdown teams', desc: 'Teams · overtime', icon: HardHat }] },
  { title: 'Data', items: [
    { to: '/summary', label: 'Section summary', desc: 'Headcount · data quality', icon: BarChart3 },
    { to: '/review', label: 'Data quality', desc: 'Items to decide', icon: ClipboardCheck },
    { to: '/review/take-charge', label: 'Take-Charge', desc: 'Confirm Field Operators', icon: ShieldCheck },
    { to: '/imports', label: 'Excel import', desc: 'Workbook · promotion list', icon: FileUp }] },
  { title: 'Admin', items: [
    { to: '/users', label: 'Users & access', desc: 'Logins · roles', icon: UserCog, headOnly: true },
    { to: '/audit', label: 'Audit history', desc: 'Who changed what', icon: ScrollText },
    { to: '/imports/history', label: 'Import history', desc: 'Past uploads', icon: History }] }
];

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
