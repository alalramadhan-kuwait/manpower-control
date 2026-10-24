import { CalendarRange, ClipboardCheck, FileUp, HardHat, ShieldCheck, UserCheck, Bell, Gauge } from 'lucide-react';

/** admin: staff master, imports and administration (Section Head, Engineer, Manpower Coordinator; not an assignment). */
export type Item = { to: string; label: string; desc: string; icon: typeof Bell; admin?: boolean };
/** The workspaces in More (each has its own tabs). */
export const WORKSPACES: Item[] = [
  { to: '/controllers', label: 'Controllers', desc: 'Cover · Calendar · Morning rotation', icon: UserCheck },
  { to: '/leave-planning', label: 'Leave planning', desc: 'Annual plan · PV cycles', icon: CalendarRange },
  { to: '/shutdown', label: 'Shutdown planning', desc: 'Shutdown plans · Unit status', icon: HardHat },
  { to: '/progress', label: 'Shutdown progress', desc: 'Today · Guideline · Equipment · Report', icon: Gauge },
  { to: '/data-quality', label: 'Data quality', desc: 'Summary · Issues · Take-Charge · Records · Oracle statistics', icon: ClipboardCheck, admin: true },
  { to: '/import', label: 'Excel import', desc: 'Upload · History', icon: FileUp, admin: true },
  { to: '/admin', label: 'Administration', desc: 'Users & access · Audit history', icon: ShieldCheck, admin: true }
];
