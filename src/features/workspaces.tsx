// The workspaces (27 Oct 2026): Manpower and Shutdowns are bottom tabs, Data quality, Excel import and Administration are
// in More. Each groups pages that used to stand alone; a tab is kept in the address (?tab=, ?sub= for a second level,
// ?section= for Shutdowns because the tracker uses ?tab= itself). Only what the role may use is shown, and the
// database enforces it too.
import { lazy, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import type { UserProfile } from '@/data/types';
import { countPendingApprovals } from '@/data/approvals';
import { cx } from '@/ui/components';
import { t } from '@/i18n';
import { Workspace } from '@/ui/workspace';

// each screen is downloaded when it is first opened (the app opens on Today without the rest)
const RequestsPage = lazy(() => import('@/features/requests/RequestsPage'));
const EmployeesPage = lazy(() => import('@/features/employees/EmployeesPage'));
const TrackerPage = lazy(() => import('@/features/tracker/TrackerPage'));
const HomePage = lazy(() => import('@/features/home/HomePage'));
const DataQualityPage = lazy(() => import('@/features/review/DataQualityPage'));
const TakeChargeBulkPage = lazy(() => import('@/features/review/TakeChargeBulkPage'));
const ImportCenterPage = lazy(() => import('@/features/imports/ImportCenterPage'));
const ImportHistoryPage = lazy(() => import('@/features/imports/ImportHistoryPage'));
const UsersPage = lazy(() => import('@/features/users/UsersPage'));
const AuditPage = lazy(() => import('@/features/audit/AuditPage'));
const UserActivityPage = lazy(() => import('@/features/audit/UserActivityPage'));
const UnitStatusPage = lazy(() => import('@/features/operation/UnitStatusPage'));
const MaintenancePage = lazy(() => import('@/features/maintenance/MaintenancePage'));
const ShutdownListPage = lazy(() => import('@/features/shutdown/ShutdownListPage'));
const FoLevelsPage = lazy(() => import('@/features/shutdown/FoLevelsPage'));
const UnitLogPage = lazy(() => import('@/features/unitlog/UnitLogPage'));
const LeavePlanPage = lazy(() => import('@/features/leave/LeavePlanPage'));
const PvPage = lazy(() => import('@/features/pv/PvPage'));
const VacationPlanPage = lazy(() => import('@/features/vacation/VacationPlanPage'));
const ControllersPage = lazy(() => import('@/features/controllers/ControllersPage'));
const MorningPlanPage = lazy(() => import('@/features/controllers/MorningPlanPage'));
const OracleStatsPanel = lazy(() => import('@/features/oracle/OracleStats').then((m) => ({ default: m.OracleStatsPanel })));
const OracleStatsImport = lazy(() => import('@/features/oracle/OracleStats').then((m) => ({ default: m.OracleStatsImport })));
const EmployeeRecords = lazy(() => import('@/features/review/EmployeeRecords').then((m) => ({ default: m.EmployeeRecords })));

const head = (p: UserProfile) => p.role_code === 'section_head';

/** A second level of tabs inside a workspace tab, kept in ?sub= (the first is the default). */
function SubTabs({ tabs }: { tabs: { key: string; label: string; el: ReactNode }[] }) {
  const [params, setParams] = useSearchParams();
  const active = tabs.find((x) => x.key === params.get('sub')) ?? tabs[0];
  return (
    <div>
      <div role="tablist" className="mb-3 flex gap-1 rounded-lg bg-slate-200/60 p-1 text-sm lg:max-w-md">
        {tabs.map((x) => (
          <button key={x.key} role="tab" type="button" aria-selected={active.key === x.key}
            onClick={() => setParams((p) => { const n = new URLSearchParams(); const tab = p.get('tab'); if (tab) n.set('tab', tab); n.set('sub', x.key); return n; }, { replace: true })}
            className={cx('min-h-9 flex-1 whitespace-nowrap rounded-md px-2 font-semibold', active.key === x.key ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600')}>{t(x.label)}</button>
        ))}
      </div>
      {active.el}
    </div>
  );
}

/** Manpower: Requests (with the waiting count), Employees, Controllers (cover, Morning rotation), Leave plan. */
export function ManpowerWorkspace({ profile }: { profile: UserProfile }) {
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    const refresh = () => countPendingApprovals().then(setWaiting).catch(() => setWaiting(0));
    refresh(); window.addEventListener('requests-changed', refresh);
    return () => window.removeEventListener('requests-changed', refresh);
  }, []);
  return <Workspace title="Manpower" tabs={[
    { key: 'requests', label: 'Requests', badge: waiting, el: <RequestsPage profile={profile} /> },
    { key: 'employees', label: 'Employees', el: <EmployeesPage profile={profile} /> },
    { key: 'controllers', label: 'Controllers', el: <SubTabs tabs={[{ key: 'cover', label: 'Cover', el: <ControllersPage profile={profile} /> }, { key: 'morning', label: 'Morning rotation', el: <MorningPlanPage /> }]} /> },
    { key: 'leave', label: 'Leave', el: <SubTabs tabs={[{ key: 'annual', label: 'Annual plan', el: <LeavePlanPage /> }, { key: 'next', label: 'Plan next year', el: <VacationPlanPage profile={profile} /> }, { key: 'pv', label: 'PV cycles', el: <PvPage isHead={head(profile)} /> }]} /> }]} />;
}

/** Shutdowns (28 Oct 2026): Live (the running shutdown's tracker, its own ?tab=), every shutdown (each opens its own
 *  page), the Unit log (shift log, trains, lab from the e-mailed PDFs; 25 Nov 2026) and Unit status. FO levels moved to Data quality (an old ?section=fo address goes there). */
export function ShutdownsWorkspace({ profile }: { profile: UserProfile }) {
  const [params] = useSearchParams();
  if (params.get('section') === 'fo') return <Navigate to="/data-quality?tab=fo-levels" replace />;
  return <Workspace title="Shutdowns" param="section" tabs={[
    { key: 'progress', label: 'Live', el: <TrackerPage profile={profile} /> },
    { key: 'plans', label: 'Shutdowns', el: <ShutdownListPage /> },
    { key: 'log', label: 'Unit log', el: <UnitLogPage isHead={head(profile)} /> },
    { key: 'modes', label: 'Unit status', el: <UnitStatusPage profile={profile} /> },
    { key: 'maintenance', label: 'Maintenance', el: <MaintenancePage profile={profile} /> }]} />;
}

export function DataQualityWorkspace({ profile }: { profile: UserProfile }) {
  return <Workspace title="Data quality" tabs={[
    { key: 'summary', label: 'Summary', el: <HomePage /> },
    { key: 'issues', label: 'Issues', el: <DataQualityPage profile={profile} /> },
    { key: 'take-charge', label: 'Take-Charge', el: <TakeChargeBulkPage profile={profile} /> },
    { key: 'records', label: 'Employee records', el: <EmployeeRecords profile={profile} /> },
    { key: 'oracle', label: 'Oracle statistics', el: <OracleStatsPanel profile={profile} /> },
    { key: 'fo-levels', label: 'FO levels', el: <FoLevelsPage />, hidden: !head(profile) }]} />;
}

export function ImportWorkspace({ profile }: { profile: UserProfile }) {
  return <Workspace title="Excel import" tabs={[
    { key: 'upload', label: 'Upload', el: <><ImportCenterPage profile={profile} /><OracleStatsImport profile={profile} /></> },
    { key: 'history', label: 'History', el: <ImportHistoryPage /> }]} />;
}

export function AdminWorkspace({ profile }: { profile: UserProfile }) {
  return <Workspace title="Administration" tabs={[
    { key: 'users', label: 'Users & access', el: <UsersPage profile={profile} />, hidden: !head(profile) },
    { key: 'activity', label: 'User activity', el: <UserActivityPage />, hidden: !head(profile) },
    { key: 'audit', label: 'Audit history', el: <AuditPage /> }]} />;
}
