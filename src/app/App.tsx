import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { recordVisit } from '@/data/activity';
import { useSession } from '@/features/auth/useSession';
import { appAccess, isAdminStaff } from '@/core/users/access';
import LoginPage from '@/features/auth/LoginPage';
import { OwnLogin, ownLoginStep } from '@/features/auth/OwnLogin';
import DayOverviewPage from '@/features/day/DayOverviewPage';
import EmployeeProfilePage from '@/features/employees/EmployeeProfilePage';
import ImportBatchPage from '@/features/imports/ImportBatchPage';
import MorePage from '@/features/more/MorePage';
import CalendarPage from '@/features/calendar/CalendarPage';
import SdPlanPage from '@/features/shutdown/SdPlanPage';
import { SdOvertimePage, SdSchedulePage } from '@/features/shutdown/SdDocuments';
import { SdMemoPage } from '@/features/shutdown/SdMemo';
import TrackerPage from '@/features/tracker/TrackerPage';
import NotificationsPage from '@/features/notifications/NotificationsPage';
import { AdminWorkspace, DataQualityWorkspace, ImportWorkspace, ManpowerWorkspace, ShutdownsWorkspace } from '@/features/workspaces';
import RequestPage from '@/features/requests/RequestPage';
import { Shell } from './Shell';
import { Button } from '@/ui/components';
import { SplashScreen } from '@/ui/brand';
import { engineerLink, supabase } from '@/data/supabase';
import EngineerApp from '@/features/engineer/EngineerApp';
import RulesPage from '@/features/rules/RulesPage';
import { useAppRules } from './useAppRules';

/** An engineer's personal link (?sd=…) or one already opened on this device: the shutdown tracker only, no login. */
export default function App() {
  return new URLSearchParams(window.location.search).has('sd') || engineerLink() ? <EngineerApp /> : <MainApp />;
}

function MainApp() {
  const { loading, session, profile, profileError, access, tasks } = useSession();
  const rulesReady = useAppRules(!!session && !!profile);
  if (loading) return <SplashScreen />;
  if (!session) return <LoginPage />;
  if (!profile) {
    return (
      <div className="mx-auto max-w-sm p-6 text-center">
        <p className="font-semibold text-brand-800">Signed in, but no role assigned</p>
        <p className="mt-2 text-sm text-slate-600">{profileError ?? 'Ask the Section Head to assign a role to this login.'}</p>
        <Button variant="secondary" className="mt-6" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    );
  }
  if (!profile.is_active) {
    return (
      <div className="mx-auto max-w-sm p-6 text-center">
        <p className="font-semibold text-brand-800">This login is disabled</p>
        <p className="mt-2 text-sm text-slate-600">Ask the Section Head to turn it back on.</p>
        <Button variant="secondary" className="mt-6" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    );
  }
  // IT rule: no company login here; own app password first
  const own = ownLoginStep(session, profile.role_code);
  if (own) return <OwnLogin session={session} step={own} />;
  const level = appAccess(profile.role_code, tasks), admin = isAdminStaff(profile.role_code);
  if (profile.employee_id && !access && appAccess(profile.role_code) !== 'none') {
    return (
      <div className="mx-auto max-w-sm p-6 text-center">
        <p className="font-semibold text-brand-800">Access paused</p>
        <p className="mt-2 text-sm text-slate-600">The staff member linked to this login is no longer active. Ask the Section Head.</p>
        <Button variant="secondary" className="mt-6" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    );
  }
  if (!rulesReady) return <SplashScreen />;
  if (level === 'tracker') return <TrackerOnly profile={profile} />;
  if (level === 'none') {
    return (
      <div className="mx-auto max-w-sm p-6 text-center">
        <p className="font-semibold text-brand-800">No app access</p>
        <p className="mt-2 text-sm text-slate-600">This login has no role with access. Ask the Section Head if you should have access.</p>
        <Button variant="secondary" className="mt-6" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    );
  }
  return (
    <Shell profile={profile}>
      <VisitRecorder />
      <div className="sm:pl-44 lg:pl-0 print:pl-0">
        <Routes>
          <Route path="/" element={<DayOverviewPage />} />
          <Route path="/calendar" element={<CalendarPage profile={profile} />} />
          <Route path="/manpower" element={<ManpowerWorkspace profile={profile} />} />
          <Route path="/shutdowns" element={<ShutdownsWorkspace profile={profile} />} />
          {/* the addresses before 27 Oct 2026 (bookmarks, notices, the back button): every one lands on the same page */}
          <Route path="/requests" element={<Legacy to={(q) => rest('/manpower?tab=requests', q)} />} />
          <Route path="/requests/:id" element={<RequestPage profile={profile} />} />
          <Route path="/employees" element={<Legacy to={(q) => rest('/manpower?tab=employees', q)} />} />
          <Route path="/employees/:id" element={<EmployeeProfilePage profile={profile} />} />
          <Route path="/rules" element={<RulesPage profile={profile} />} />
          <Route path="/more" element={<MorePage profile={profile} />} />
          <Route path="/notifications" element={<NotificationsPage profile={profile} />} />
          <Route path="/controllers" element={<Legacy to={(q) => (q.get('tab') === 'calendar' ? rest('/calendar?board=controllers', q, ['tab']) : rest(`/manpower?tab=controllers&sub=${q.get('tab') === 'morning' ? 'morning' : 'cover'}`, q, ['tab']))} />} />
          <Route path="/leave-planning" element={<Legacy to={(q) => rest(`/manpower?tab=leave&sub=${['annual', 'next', 'pv'].find((k) => k === q.get('tab')) ?? 'annual'}`, q, ['tab'])} />} />
          <Route path="/vacation-plan" element={<Legacy to={(q) => rest('/manpower?tab=leave&sub=next', q, ['tab'])} />} />
          <Route path="/shutdown" element={<Legacy to={(q) => rest(q.get('tab') === 'modes' ? '/shutdowns?section=modes' : '/shutdowns?section=plans', q, ['tab'])} />} />
          <Route path="/shutdown/:id" element={<SdPlanPage isHead={profile.role_code === 'section_head'} />} />
          <Route path="/shutdown/:id/schedule" element={<SdSchedulePage />} />
          <Route path="/shutdown/:id/overtime" element={<SdOvertimePage />} />
          <Route path="/shutdown/:id/memo" element={<SdMemoPage />} />
          <Route path="/progress" element={<Legacy to={(q) => rest('/shutdowns?section=progress', q)} />} />
          <Route path="/progress/:id" element={<TrackerPage profile={profile} />} />
          <Route path="/data-quality" element={admin ? <DataQualityWorkspace profile={profile} /> : <Navigate to="/" replace />} />
          <Route path="/import" element={admin ? <ImportWorkspace profile={profile} /> : <Navigate to="/" replace />} />
          <Route path="/import/:batchId" element={admin ? <ImportBatchPage /> : <Navigate to="/" replace />} />
          <Route path="/admin" element={admin ? <AdminWorkspace profile={profile} /> : <Navigate to="/" replace />} />
          {/* an old or mistyped address lands on Today with a short note (no old page is kept) */}
          <Route path="*" element={<Navigate to="/" replace state={{ moved: true }} />} />
        </Routes>
      </div>
    </Shell>
  );
}

/** Records the page each time it changes (for the Section Head's User activity). */
function VisitRecorder() {
  const { pathname, search } = useLocation();
  const q = new URLSearchParams(search);
  const tab = pathname === '/shutdowns' ? `section=${q.get('section') ?? 'progress'}` : q.get('tab') ? `tab=${q.get('tab')}` : '';
  useEffect(() => { recordVisit(`${pathname}${tab ? `?${tab}` : ''}`); }, [pathname, tab]);
  return null;
}

/** An address from before the 27 Oct 2026 layout: the same page under its new tab, with the rest of the address kept. */
function Legacy({ to }: { to: (q: URLSearchParams) => string }) {
  const { search } = useLocation();
  return <Navigate to={to(new URLSearchParams(search))} replace />;
}
const rest = (base: string, q: URLSearchParams, drop: string[] = []) => { const n = new URLSearchParams(q); for (const k of drop) n.delete(k); const s = n.toString(); return s ? `${base}&${s}` : base; };

/** A Controller without the Manpower assignment: the shutdown tracker only (the database allows nothing else). */
function TrackerOnly({ profile }: { profile: NonNullable<ReturnType<typeof useSession>['profile']> }) {
  return (
    <div className="min-h-full bg-canvas">
      <header className="sticky top-0 z-30 flex items-center gap-2 bg-brand-700 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] text-white print:hidden">
        <div className="min-w-0 flex-1"><p className="truncate text-[17px] font-bold">ARDS Operations</p><p className="truncate text-xs opacity-80">{profile.display_name} · Controller</p></div>
        <button type="button" className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <div className="mx-auto max-w-6xl p-3">
        <Routes>
          <Route path="/progress" element={<TrackerPage profile={profile} />} />
          <Route path="/progress/:id" element={<TrackerPage profile={profile} />} />
          <Route path="*" element={<Navigate to="/progress" replace />} />
        </Routes>
      </div>
    </div>
  );
}
