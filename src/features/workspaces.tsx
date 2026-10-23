// The six workspaces in More (and the Requests tab bar is built the same way). Each groups pages that used to stand
// alone; a tab is kept in the address (?tab=). Only what the role may use is shown, and the database enforces it too.
import type { UserProfile } from '@/data/types';
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
import ControllersPage from '@/features/controllers/ControllersPage';
import ControllersBoardPage from '@/features/controllers/ControllersBoardPage';
import MorningPlanPage from '@/features/controllers/MorningPlanPage';
import { OracleStatsPanel, OracleStatsImport } from '@/features/oracle/OracleStats';
import { EmployeeRecords } from '@/features/review/EmployeeRecords';

const head = (p: UserProfile) => p.role_code === 'section_head';

export function ControllersWorkspace({ profile }: { profile: UserProfile }) {
  return <Workspace title="Controllers" tabs={[
    { key: 'cover', label: 'Cover', el: <ControllersPage profile={profile} /> },
    { key: 'calendar', label: 'Calendar', el: <ControllersBoardPage profile={profile} /> },
    { key: 'morning', label: 'Morning rotation', el: <MorningPlanPage /> }]} />;
}

export function LeavePlanningWorkspace({ profile }: { profile: UserProfile }) {
  return <Workspace title="Leave planning" tabs={[
    { key: 'annual', label: 'Annual plan', el: <LeavePlanPage /> },
    { key: 'pv', label: 'PV cycles', el: <PvPage isHead={head(profile)} /> }]} />;
}

export function ShutdownWorkspace({ profile }: { profile: UserProfile }) {
  return <Workspace title="Shutdown planning" tabs={[
    { key: 'plans', label: 'Shutdown plans', el: <ShutdownListPage /> },
    { key: 'modes', label: 'Unit status', el: <OperationPage profile={profile} /> }]} />;
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
