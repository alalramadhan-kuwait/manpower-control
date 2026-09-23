import { ChevronRight, ClipboardCheck, FileUp, History, LogOut, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/data/supabase';
import type { UserProfile } from '@/data/types';
import { ROLE_LABEL } from '@/features/auth/useSession';
import { Button, Card, PageHeader } from '@/ui/components';

const active = [
  { to: '/imports', label: 'Excel Import Center', desc: 'Upload the U-12 manpower workbook or the promotion master', icon: FileUp },
  { to: '/imports/history', label: 'Import History', desc: 'Every import batch with its counts and row outcomes', icon: History },
  { to: '/review', label: 'Data Quality Review', desc: 'Unresolved absences, unconfirmed qualifications, unmatched rows', icon: ClipboardCheck },
  { to: '/review/take-charge', label: 'Take-Charge confirmation', desc: 'Bulk-confirm Take-Charge for all Field Operators', icon: ShieldCheck }
];
const later = [
  ['Annual Leave Plan', 'Stage E'], ['Shift Movements', 'Stage G'], ['Controller Management', 'Stage H'], ['Shutdown', 'Stage I'], ['Notification Center', 'after Stage F'], ['Audit History', 'Stage J']
];

export default function MorePage({ profile }: { profile: UserProfile }) {
  return (
    <div>
      <PageHeader title="More" subtitle={`${profile.display_name} · ${ROLE_LABEL[profile.role_code]}`} />
      <div className="space-y-2">
        {active.map(({ to, label, desc, icon: Icon }) => (
          <Link key={to} to={to} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 active:bg-slate-50">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><Icon className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1"><span className="block font-medium text-slate-800">{label}</span><span className="block truncate text-xs text-slate-500">{desc}</span></span>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </Link>
        ))}
      </div>
      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-slate-500">Planned for later stages</h2>
      <Card className="divide-y divide-slate-100 p-0">
        {later.map(([l, s]) => (
          <div key={l} className="flex items-center justify-between px-4 py-3 text-sm text-slate-500"><span>{l}</span><span className="text-xs">{s}</span></div>
        ))}
      </Card>
      <Card className="mt-6">
        <div className="text-sm text-slate-600">Signed in as <span className="font-medium text-slate-800">{profile.display_name}</span></div>
        <Button variant="secondary" className="mt-3 w-full" onClick={() => supabase.auth.signOut()}><LogOut className="h-4 w-4" /> Sign out</Button>
      </Card>
      <p className="mt-6 text-center text-[11px] text-slate-400">Area 4 Manpower Control · Stage A · standalone from Time Keeper</p>
    </div>
  );
}
