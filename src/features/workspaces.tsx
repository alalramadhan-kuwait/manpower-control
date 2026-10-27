// The workspaces (27 Oct 2026): Manpower and Shutdowns are bottom tabs, Data quality, Excel import and Administration are
// in More. Each groups pages that used to stand alone; a tab is kept in the address (?tab=, ?sub= for a second level,
// ?section= for Shutdowns because the tracker uses ?tab= itself). Only what the role may use is shown, and the
// database enforces it too.
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { UserProfile } from '@/data/types';
import { countPendingApprovals } from '@/data/approvals';
import { cx } from '@/ui/components';
import { t } from '@/i18n';
import RequestsPage from '@/features/requests/RequestsPage';
import EmployeesPage from '@/features/employees/EmployeesPage';
import TrackerPage from '@/features/tracker/TrackerPage';
import { Workspace } from '@/ui/workspace';
import HomePage from '@/features/home/HomePage';
import DataQualityPage from '@/features/review/DataQualityPage';
import TakeChargeBulkPage from '@/features/review/TakeChargeBulkPage';
import ImportCenterPage from '@/features/imports/ImportCenterPage';
import ImportHistoryPage from '@/features/imports/ImportHistoryPage';
import UsersPage from '@/features/users/UsersPage';
import AuditPage from '@/features/audit/AuditPage';
import UserActivityPage from '@/features/audit/UserActivityPage';
import OperationPage from '@/features/operation/OperationPage';
import ShutdownListPage from '@/features/shutdown/ShutdownListPage';
import FoLevelsPage from '@/features/shutdown/FoLevelsPage';
import LeavePlanPage from '@/features/leave/LeavePlanPage';
import PvPage from '@/features/pv/PvPage';
import VacationPlanPage from '@/features/vacation/VacationPlanPage';
import ControllersPage from '@/features/controllers/ControllersPage';
import MorningPlanPage from '@/features/controllers/MorningPlanPage';
import { OracleStatsPanel, OracleStatsImport } from '@/features/oracle/OracleStats';
import { EmployeeRecords } from '@/features/review/EmployeeRecords';

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

/** Shutdowns: the progress tracker first (its own ?tab=), then the plans, Unit status and FO levels (Section Head). */
export function ShutdownsWorkspace({ profile }: { profile: UserProfile }) {
  return <Workspace title="Shutdowns" param="section" tabs={[
    { key: 'progress', label: 'Progress', el: <TrackerPage profile={profile} /> },
    { key: 'plans', label: 'Plans', el: <ShutdownListPage /> },
    { key: 'modes', label: 'Unit status', el: <OperationPage profile={profile} /> },
    { key: 'fo', label: 'FO levels', el: <FoLevelsPage />, hidden: !head(profile) }]} />;
}

export function DataQualityWorkspace({ profile }: { profile: UserProfile }) {
  return <Workspace title="Data quality" tabs={[
    { key: 'summary', label: 'Summary', el: <HomePage /> },
    { key: 'issues', label: 'Issues', el: <DataQualityPage profile={profile} /> },
    { key: 'take-charge', label: 'Take-Charge', el: <TakeChargeBulkPage profile={profile} /> },
    { key: 'records', label: 'Employee records', el: <EmployeeRecords profile={profile} /> },
    { key: 'oracle', label: 'Oracle statistics', el: <OracleStatsPanel profile={profile} /> }]} />;
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
