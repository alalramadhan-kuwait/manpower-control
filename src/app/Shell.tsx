import { CalendarDays, ClipboardList, Home, MoreHorizontal, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { countOpenRequests } from '@/data/requests';
import { cx } from '@/ui/components';
import { BrandTile } from '@/ui/brand';
import { ROLE_LABEL } from '@/features/auth/useSession';
import type { UserProfile } from '@/data/types';

const tabs = [
  { to: '/', label: 'Today', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/requests', label: 'Requests', icon: ClipboardList },
  { to: '/employees', label: 'Employees', icon: Users },
  { to: '/more', label: 'More', icon: MoreHorizontal }
];

export function Shell({ profile, children }: { profile: UserProfile; children: ReactNode }) {
  // open leave requests (waiting for review or decision), refreshed on every navigation
  const { pathname } = useLocation();
  const [openRequests, setOpenRequests] = useState(0);
  useEffect(() => {
    const refresh = () => countOpenRequests().then(setOpenRequests).catch(() => setOpenRequests(0));
    refresh();
    window.addEventListener('requests-changed', refresh);
    return () => window.removeEventListener('requests-changed', refresh);
  }, [pathname]);
  const badge = (to: string) => (to === '/requests' && openRequests > 0 ? openRequests : 0);
  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col lg:max-w-7xl">
      <header className="sticky top-0 z-40 bg-brand-700 text-white safe-top">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandTile className="h-9 w-9" />
            <div className="min-w-0">
              <div className="truncate font-display text-[15px] font-bold leading-tight tracking-tight">ARDS Operations</div>
              <div className="truncate text-[11px] text-brand-100">Manpower Control · {[...new Set([profile.display_name, ROLE_LABEL[profile.role_code] ?? profile.role_code])].join(' · ')}</div>
            </div>
          </div>
          <div className="shrink-0 whitespace-nowrap rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium">Stage J</div>
        </div>
      </header>
      <main className="flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-4 sm:pb-8">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur safe-bottom sm:hidden">
        <div className="mx-auto grid max-w-5xl grid-cols-5 lg:max-w-7xl">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]', isActive ? 'text-brand-700 font-semibold' : 'text-slate-500')}>
              <span className="relative"><Icon className="h-5 w-5" />{badge(to) > 0 && <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-brand-700 px-1 text-center text-[10px] font-bold leading-4 text-white">{badge(to)}</span>}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
      <nav className="fixed left-0 top-16 hidden w-44 flex-col gap-1 p-3 sm:flex" aria-label="Desktop navigation">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex items-center gap-2 rounded-xl px-3 py-2 text-sm', isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-100')}>
            <Icon className="h-4 w-4" /> {label}{badge(to) > 0 && <span className="ml-auto rounded-full bg-brand-700 px-1.5 text-[10px] font-bold text-white">{badge(to)}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
