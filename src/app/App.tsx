import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { recordVisit } from '@/data/activity';
import { useSession } from '@/features/auth/useSession';
import { appAccess, isAdminStaff } from '@/core/users/access';
import LoginPage from '@/features/auth/LoginPage';
import DayOverviewPage from '@/features/day/DayOverviewPage';
import EmployeesPage from '@/features/employees/EmployeesPage';
import EmployeeProfilePage from '@/features/employees/EmployeeProfilePage';
import ImportBatchPage from '@/features/imports/ImportBatchPage';
import MorePage from '@/features/more/MorePage';
import CalendarPage from '@/features/calendar/CalendarPage';
import SdPlanPage from '@/features/shutdown/SdPlanPage';
import { SdOvertimePage, SdSchedulePage } from '@/features/shutdown/SdDocuments';
import { SdMemoPage } from '@/features/shutdown/SdMemo';
import TrackerPage from '@/features/tracker/TrackerPage';
import RequestsPage from '@/features/requests/RequestsPage';
import NotificationsPage from '@/features/notifications/NotificationsPage';
import { AdminWorkspace, ControllersWorkspace, DataQualityWorkspace, ImportWorkspace, LeavePlanningWorkspace, ShutdownWorkspace } from '@/features/workspaces';
import RequestPage from '@/features/requests/RequestPage';
import { Shell } from './Shell';
import { Button } from '@/ui/components';
import { SplashScreen } from '@/ui/brand';
import { engineerLink, supabase } from '@/data/supabase';
import EngineerApp from '@/features/engineer/EngineerApp';

/** An engineer's personal link (?sd=…) or one already opened on this device: the shutdown tracker only, no login. */
export default function App() {
  return new URLSearchParams(window.location.search).has('sd') || engineerLink() ? <EngineerApp /> : <MainApp />;
}

function MainApp() {
  const { loading, session, profile, profileError, access, tasks } = useSession();
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
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/requests" element={<RequestsPage profile={profile} />} />
          <Route path="/requests/:id" element={<RequestPage profile={profile} />} />
          <Route path="/employees" element={<EmployeesPage profile={profile} />} />
          <Route path="/employees/:id" element={<EmployeeProfilePage profile={profile} />} />
          <Route path="/more" element={<MorePage profile={profile} />} />
          <Route path="/notifications" element={<NotificationsPage profile={profile} />} />
          <Route path="/controllers" element={<ControllersWorkspace profile={profile} />} />
          <Route path="/leave-planning" element={<LeavePlanningWorkspace profile={profile} />} />
          <Route path="/shutdown" element={<ShutdownWorkspace profile={profile} />} />
          <Route path="/shutdown/:id" element={<SdPlanPage isHead={profile.role_code === 'section_head'} />} />
          <Route path="/shutdown/:id/schedule" element={<SdSchedulePage />} />
          <Route path="/shutdown/:id/overtime" element={<SdOvertimePage />} />
          <Route path="/shutdown/:id/memo" element={<SdMemoPage />} />
          <Route path="/progress" element={<TrackerPage profile={profile} />} />
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
  const tab = new URLSearchParams(search).get('tab');
  useEffect(() => { recordVisit(`${pathname}${tab ? `?tab=${tab}` : ''}`); }, [pathname, tab]);
  return null;
}

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
