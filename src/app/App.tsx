import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '@/features/auth/useSession';
import LoginPage from '@/features/auth/LoginPage';
import HomePage from '@/features/home/HomePage';
import EmployeesPage from '@/features/employees/EmployeesPage';
import EmployeeProfilePage from '@/features/employees/EmployeeProfilePage';
import ImportCenterPage from '@/features/imports/ImportCenterPage';
import ImportHistoryPage from '@/features/imports/ImportHistoryPage';
import ImportBatchPage from '@/features/imports/ImportBatchPage';
import DataQualityPage from '@/features/review/DataQualityPage';
import TakeChargeBulkPage from '@/features/review/TakeChargeBulkPage';
import MorePage from '@/features/more/MorePage';
import { Shell } from './Shell';
import { Button, Spinner } from '@/ui/components';
import { supabase } from '@/data/supabase';

function ComingLater({ stage, title }: { stage: string; title: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
      <p className="text-lg font-semibold text-brand-800">{title}</p>
      <p className="mt-1 text-sm text-slate-600">This screen is built in {stage}. Stage A covers the employee foundation and the Excel Import Center only.</p>
    </div>
  );
}

export default function App() {
  const { loading, session, profile, profileError } = useSession();
  if (loading) return <Spinner label="Starting…" />;
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
  if (!['section_head', 'manpower_coordinator'].includes(profile.role_code)) {
    return (
      <div className="mx-auto max-w-sm p-6 text-center">
        <p className="font-semibold text-brand-800">Role not active in Phase 1</p>
        <p className="mt-2 text-sm text-slate-600">Only the Section Head and the Manpower Coordinator can use the application at this stage.</p>
        <Button variant="secondary" className="mt-6" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    );
  }
  return (
    <Shell profile={profile}>
      <div className="sm:pl-44">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/employees" element={<EmployeesPage />} />
          <Route path="/employees/:id" element={<EmployeeProfilePage profile={profile} />} />
          <Route path="/imports" element={<ImportCenterPage profile={profile} />} />
          <Route path="/imports/history" element={<ImportHistoryPage />} />
          <Route path="/imports/:batchId" element={<ImportBatchPage />} />
          <Route path="/review" element={<DataQualityPage profile={profile} />} />
          <Route path="/review/take-charge" element={<TakeChargeBulkPage profile={profile} />} />
          <Route path="/more" element={<MorePage profile={profile} />} />
          <Route path="/calendar" element={<ComingLater stage="Stage E" title="Manpower Calendar" />} />
          <Route path="/requests" element={<ComingLater stage="Stage F" title="Requests" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Shell>
  );
}
