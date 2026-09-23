import { CalendarDays, ClipboardList, Home, MoreHorizontal, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cx } from '@/ui/components';
import { ROLE_LABEL } from '@/features/auth/useSession';
import type { UserProfile } from '@/data/types';

const tabs = [
  { to: '/', label: 'Today', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays, soon: 'Stage E' },
  { to: '/requests', label: 'Requests', icon: ClipboardList, soon: 'Stage F' },
  { to: '/employees', label: 'Employees', icon: Users },
  { to: '/more', label: 'More', icon: MoreHorizontal }
];

export function Shell({ profile, children }: { profile: UserProfile; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col lg:max-w-7xl">
      <header className="sticky top-0 z-40 bg-brand-700 text-white safe-top">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">Area 4 Manpower Control</div>
            <div className="truncate text-[11px] text-brand-100">U-12 Section 1 · {profile.display_name} · {ROLE_LABEL[profile.role_code] ?? profile.role_code}</div>
          </div>
          <div className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium">Stage H</div>
        </div>
      </header>
      <main className="flex-1 px-4 pb-28 pt-4 sm:pb-8">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur safe-bottom sm:hidden">
        <div className="mx-auto grid max-w-5xl grid-cols-5 lg:max-w-7xl">
          {tabs.map(({ to, label, icon: Icon, soon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]', isActive ? 'text-brand-700 font-semibold' : 'text-slate-500', soon && 'opacity-60')}>
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
      <nav className="fixed left-0 top-16 hidden w-44 flex-col gap-1 p-3 sm:flex" aria-label="Desktop navigation">
        {tabs.map(({ to, label, icon: Icon, soon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex items-center gap-2 rounded-xl px-3 py-2 text-sm', isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-100', soon && 'opacity-60')}>
            <Icon className="h-4 w-4" /> {label}{soon && <span className="ml-auto text-[10px] text-slate-400">{soon}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
