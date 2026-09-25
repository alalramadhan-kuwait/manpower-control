import { ArrowLeftRight, BadgeCheck, Bell, BarChart3, CalendarRange, ChevronRight, ClipboardCheck, FileUp, Gauge, History, LogOut, ScrollText, ShieldCheck, UserCheck, UserCog } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/data/supabase';
import type { UserProfile } from '@/data/types';
import { ROLE_LABEL } from '@/features/auth/useSession';
import { Button, Card, PageHeader } from '@/ui/components';

const active = [
  { to: '/movements', label: 'Shift movements', desc: 'Covers · moves · day duty', icon: ArrowLeftRight },
  { to: '/leave-plan', label: 'Leave plan', desc: 'Year plan · add / correct', icon: CalendarRange },
  { to: '/oracle', label: 'Oracle HR', desc: 'Submitted · approved · pending', icon: BadgeCheck },
  { to: '/notifications', label: 'Notifications', desc: 'Next 60 days', icon: Bell },
  { to: '/operation', label: 'Operating modes', desc: 'Shutdown · one train', icon: Gauge },
  { to: '/controllers', label: 'Controllers', desc: 'Cover · VR · Morning rotation', icon: UserCheck },
  { to: '/summary', label: 'Section summary', desc: 'Headcount · data quality', icon: BarChart3 },
  { to: '/imports', label: 'Excel import', desc: 'Workbook · promotion list', icon: FileUp },
  { to: '/audit', label: 'Audit history', desc: 'Who changed what', icon: ScrollText },
  { to: '/imports/history', label: 'Import history', desc: 'Past uploads', icon: History },
  { to: '/review', label: 'Data quality', desc: 'Items to decide', icon: ClipboardCheck },
  { to: '/review/take-charge', label: 'Take-Charge', desc: 'Confirm Field Operators', icon: ShieldCheck }
];
const headOnly = [
  { to: '/users', label: 'Users & access', desc: 'Logins · roles', icon: UserCog }
];

export default function MorePage({ profile }: { profile: UserProfile }) {
  return (
    <div>
      <PageHeader title="More" subtitle={[...new Set([profile.display_name, ROLE_LABEL[profile.role_code]])].join(' · ')} />
      <div className="space-y-2">
        {[...(profile.role_code === 'section_head' ? headOnly : []), ...active].map(({ to, label, desc, icon: Icon }) => (
          <Link key={to} to={to} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 active:bg-slate-50">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1"><span className="block font-medium text-slate-800">{label}</span><span className="block truncate text-xs text-slate-500">{desc}</span></span>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </Link>
        ))}
      </div>
      <Card className="mt-6">
        <div className="text-sm text-slate-600">Signed in as <span className="font-medium text-slate-800">{profile.display_name}</span></div>
        <Button variant="secondary" className="mt-3 w-full" onClick={() => supabase.auth.signOut()}><LogOut className="h-4 w-4" /> Sign out</Button>
      </Card>
      <p className="mt-6 text-center text-[11px] text-slate-400">ARDS Operations · Area 4 · Unit 12 · Manpower Control · standalone from Time Keeper</p>
    </div>
  );
}
