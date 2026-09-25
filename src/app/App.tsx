import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '@/features/auth/useSession';
import LoginPage from '@/features/auth/LoginPage';
import HomePage from '@/features/home/HomePage';
import DayOverviewPage from '@/features/day/DayOverviewPage';
import EmployeesPage from '@/features/employees/EmployeesPage';
import EmployeeProfilePage from '@/features/employees/EmployeeProfilePage';
import ImportCenterPage from '@/features/imports/ImportCenterPage';
import ImportHistoryPage from '@/features/imports/ImportHistoryPage';
import ImportBatchPage from '@/features/imports/ImportBatchPage';
import DataQualityPage from '@/features/review/DataQualityPage';
import TakeChargeBulkPage from '@/features/review/TakeChargeBulkPage';
import MorePage from '@/features/more/MorePage';
import UsersPage from '@/features/users/UsersPage';
import CalendarPage from '@/features/calendar/CalendarPage';
import LeavePlanPage from '@/features/leave/LeavePlanPage';
import MovementsPage from '@/features/movements/MovementsPage';
import ControllersPage from '@/features/controllers/ControllersPage';
import RequestsPage from '@/features/requests/RequestsPage';
import AuditPage from '@/features/audit/AuditPage';
import OperationPage from '@/features/operation/OperationPage';
import NotificationsPage from '@/features/notifications/NotificationsPage';
import RequestPage from '@/features/requests/RequestPage';
import { Shell } from './Shell';
import { Button } from '@/ui/components';
import { SplashScreen } from '@/ui/brand';
import { supabase } from '@/data/supabase';

export default function App() {
  const { loading, session, profile, profileError, access } = useSession();
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
  if (profile.employee_id && !access && ['section_head', 'manpower_coordinator'].includes(profile.role_code)) {
    return (
      <div className="mx-auto max-w-sm p-6 text-center">
        <p className="font-semibold text-brand-800">Access paused</p>
        <p className="mt-2 text-sm text-slate-600">The staff member linked to this login is no longer active. Ask the Section Head.</p>
        <Button variant="secondary" className="mt-6" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    );
  }
  if (!['section_head', 'manpower_coordinator'].includes(profile.role_code)) {
    return (
      <div className="mx-auto max-w-sm p-6 text-center">
        <p className="font-semibold text-brand-800">No app access</p>
        <p className="mt-2 text-sm text-slate-600">This login has no role with access. Only the Section Head and the Manpower Coordinator can use the application at this stage; ask the Section Head if you should have access.</p>
        <Button variant="secondary" className="mt-6" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    );
  }
  return (
    <Shell profile={profile}>
      <div className="sm:pl-44">
        <Routes>
          <Route path="/" element={<DayOverviewPage />} />
          <Route path="/summary" element={<HomePage />} />
          <Route path="/employees" element={<EmployeesPage profile={profile} />} />
          <Route path="/employees/:id" element={<EmployeeProfilePage profile={profile} />} />
          <Route path="/imports" element={<ImportCenterPage profile={profile} />} />
          <Route path="/imports/history" element={<ImportHistoryPage />} />
          <Route path="/imports/:batchId" element={<ImportBatchPage />} />
          <Route path="/review" element={<DataQualityPage profile={profile} />} />
          <Route path="/review/take-charge" element={<TakeChargeBulkPage profile={profile} />} />
          <Route path="/more" element={<MorePage profile={profile} />} />
          <Route path="/users" element={<UsersPage profile={profile} />} />
          <Route path="/controllers" element={<ControllersPage profile={profile} />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/leave-plan" element={<LeavePlanPage />} />
          <Route path="/movements" element={<MovementsPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/requests/:id" element={<RequestPage profile={profile} />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/operation" element={<OperationPage profile={profile} />} />
          <Route path="/notifications" element={<NotificationsPage profile={profile} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Shell>
  );
}
