import { CalendarRange, ClipboardCheck, FileUp, HardHat, ShieldCheck, UserCheck, Bell } from 'lucide-react';

export type Item = { to: string; label: string; desc: string; icon: typeof Bell };
/** The six workspaces in More (each has its own tabs). */
export const WORKSPACES: Item[] = [
  { to: '/controllers', label: 'Controllers', desc: 'Cover · Calendar · Morning rotation', icon: UserCheck },
  { to: '/leave-planning', label: 'Leave planning', desc: 'Annual plan · PV cycles', icon: CalendarRange },
  { to: '/shutdown', label: 'Shutdown planning', desc: 'Shutdown plans · Operating modes', icon: HardHat },
  { to: '/data-quality', label: 'Data quality', desc: 'Summary · Issues · Take-Charge · Records · Oracle statistics', icon: ClipboardCheck },
  { to: '/import', label: 'Excel import', desc: 'Upload · History', icon: FileUp },
  { to: '/admin', label: 'Administration', desc: 'Users & access · Audit history', icon: ShieldCheck }
];
