import { Bell, CalendarDays, HardHat, Home, LogOut, MoreHorizontal, Plus, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { supabase } from '@/data/supabase';
import { countPendingApprovals } from '@/data/approvals';
import { loadNotices } from '@/data/notifications';
import { actionCount } from '@/core/notifications';
import { cx } from '@/ui/components';
import { BrandTile } from '@/ui/brand';
import { WORKSPACES } from '@/app/moreItems';
import { isAdminStaff } from '@/core/users/access';
import { t } from '@/i18n';
import { VersionLine } from '@/app/VersionLine';
import { SidePanel } from '@/features/side/SidePanel';
import { ROLE_LABEL } from '@/features/auth/useSession';
import type { UserProfile } from '@/data/types';

// the bottom bar (27 Oct 2026): Manpower holds Requests, Employees, Controllers and Leave plan; Shutdowns holds the
// tracker, the plans, Unit status and FO levels; the Controllers calendar is a switch inside Calendar
const tabs = [
  { to: '/', label: 'Today', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/manpower', label: 'Manpower', icon: Users },
  { to: '/shutdowns', label: 'Shutdowns', icon: HardHat },
  { to: '/more', label: 'More', icon: MoreHorizontal }
];

export function Shell({ profile, children }: { profile: UserProfile; children: ReactNode }) {
  // open leave requests (waiting for review or decision), refreshed on every navigation
  const { pathname, search } = useLocation();
  const [openRequests, setOpenRequests] = useState(0);
  useEffect(() => {
    const refresh = () => countPendingApprovals().then(setOpenRequests).catch(() => setOpenRequests(0));
    refresh();
    window.addEventListener('requests-changed', refresh);
    return () => window.removeEventListener('requests-changed', refresh);
  }, [pathname]);
  const badge = (to: string) => (to === '/manpower' && openRequests > 0 ? openRequests : 0);
  // Notification Center badge: items needing action in the coming weeks (cached a few minutes)
  const [actions, setActions] = useState(0);
  useEffect(() => {
    const refresh = () => loadNotices(profile.role_code === 'section_head').then((n) => setActions(actionCount(n))).catch(() => setActions(0));
    refresh();
    window.addEventListener('notices-changed', refresh); window.addEventListener('requests-changed', refresh);
    return () => { window.removeEventListener('notices-changed', refresh); window.removeEventListener('requests-changed', refresh); };
  }, [pathname, profile.role_code]);
  const isHead = profile.role_code === 'section_head';
  const q = new URLSearchParams(search);
  const view = q.get('view');
  const onEntry = pathname === '/manpower' && (q.get('tab') ?? 'requests') === 'requests' && (view === 'entry' || (!view && !isHead));
  const onTracker = pathname.startsWith('/progress') || (pathname === '/shutdowns' && (q.get('section') ?? 'progress') === 'progress');
  const wide = WIDE.some((re) => re.test(pathname + search));
  return (
    <div className="flex min-h-full flex-col print:block">
      <header className="sticky top-0 z-40 bg-brand-700 text-white safe-top print:hidden">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-2.5 lg:max-w-[1680px] lg:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <BrandTile className="h-9 w-9" />
            <div className="min-w-0">
              <div className="truncate font-display text-[15px] font-bold leading-tight tracking-tight">ARDS Operations</div>
              <div className="truncate text-[11px] text-brand-100">{t('Manpower Control')} · {[...new Set([profile.display_name, t(ROLE_LABEL[profile.role_code] ?? profile.role_code)])].join(' · ')}</div>
            </div>
          </div>
          <Link to="/notifications" aria-label={`${t('Notifications')}${actions ? ` · ${actions}` : ''}`} className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 active:bg-white/20">
            <Bell className="h-5 w-5" />
            {actions > 0 && <span className="absolute -end-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-status-red px-1 text-[11px] font-bold leading-none text-white ring-2 ring-brand-700">{actions > 99 ? '99+' : actions}</span>}
          </Link>
        </div>
      </header>
      {/* desktop: every page in the left menu, the page in the middle, the side panel on the right (not on the wide pages) */}
      <div className={cx('mx-auto w-full max-w-5xl flex-1 lg:grid lg:max-w-[1680px] lg:gap-6 lg:px-6 print:block print:max-w-none print:px-0',
        wide ? 'lg:grid-cols-[13.5rem_minmax(0,1fr)]' : 'lg:grid-cols-[13.5rem_minmax(0,1fr)] xl:grid-cols-[13.5rem_minmax(0,1fr)_22rem]')}>
        <nav aria-label="All pages" className="sticky top-16 hidden max-h-[calc(100vh-4rem)] self-start overflow-y-auto py-4 pr-1 lg:block print:hidden">
          <div className="space-y-0.5">
            {tabs.filter((t) => t.to !== '/more').map(({ to, label, icon: Icon }) => <RailLink key={to} to={to} label={label} icon={Icon} end={to === '/'} count={badge(to)} />)}
          </div>
          <div className="mt-4">
            <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t('Administration')}</div>
            <div className="space-y-0.5">
              {WORKSPACES.filter((i) => !i.admin || isAdminStaff(profile.role_code)).map((i) => <RailLink key={i.to} to={i.to} label={t(i.label)} icon={i.icon} />)}
              <RailLink to="/more" label={t('More')} icon={MoreHorizontal} end />
            </div>
          </div>
          <button type="button" onClick={() => supabase.auth.signOut()} className="mt-4 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"><LogOut className="h-4 w-4" />{t('Sign out')}</button>
          <VersionLine className="mt-4 px-3 text-[10px] leading-tight text-slate-500" />
        </nav>
        <main className="min-w-0 flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-4 sm:pb-8 lg:px-0 print:p-0">{children}</main>
        {!wide && <aside aria-label="Side panel" className="sticky top-16 hidden max-h-[calc(100vh-4rem)] self-start overflow-y-auto py-4 xl:block print:hidden"><SidePanel isHead={isHead} /></aside>}
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur safe-bottom sm:hidden print:hidden">
        <div className="mx-auto grid max-w-5xl grid-cols-5">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px]', isActive ? 'text-brand-700 font-semibold' : 'text-slate-500')}>
              <span className="relative"><Icon className="h-5 w-5" />{badge(to) > 0 && <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-brand-700 px-1 text-center text-[10px] font-bold leading-4 text-white">{badge(to)}</span>}</span>
              <span>{t(label)}</span>
            </NavLink>
          ))}
        </div>
      </nav>
      {/* Quick Add: opens Requests → Entry (the one place to add or change); not shown on Entry itself */}
      {!onEntry && !onTracker && pathname !== '/shutdowns' && !pathname.startsWith('/sd/') && (
        <Link to="/manpower?tab=requests&view=entry" aria-label={t('Quick add')}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] end-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg shadow-brand-900/30 active:scale-95 sm:hidden print:hidden">
          <Plus className="h-7 w-7" />
        </Link>
      )}
      <nav className="fixed left-0 top-16 hidden w-44 flex-col gap-1 p-3 sm:flex lg:hidden print:hidden" aria-label="Tablet navigation">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => cx('flex items-center gap-2 rounded-xl px-3 py-2 text-sm', isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-100')}>
            <Icon className="h-4 w-4" /> {t(label)}{badge(to) > 0 && <span className="ms-auto rounded-full bg-brand-700 px-1.5 text-[10px] font-bold text-white">{badge(to)}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Pages that need the whole width (grids, calendars, printed sheets): no side panel. */
const WIDE = [/^\/progress/, /^\/calendar/, /^\/shutdowns/, /^\/manpower\?tab=leave/, /^\/shutdown\/[^/]+\/(schedule|overtime)/, /^\/admin/];

function RailLink({ to, label, icon: Icon, end, count = 0 }: { to: string; label: string; icon: typeof Bell; end?: boolean; count?: number }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx('flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm', isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-100')}>
      <Icon className="h-4 w-4 shrink-0" /><span className="truncate">{t(label)}</span>{count > 0 && <span className="ms-auto rounded-full bg-brand-700 px-1.5 text-[10px] font-bold text-white">{count}</span>}
    </NavLink>
  );
}
