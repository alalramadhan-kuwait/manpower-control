import { ClipboardCheck, FileUp, ShieldCheck, Bell } from 'lucide-react';

/** admin: staff master, imports and administration (Section Head, Engineer, Manpower Coordinator; not an assignment). */
export type Item = { to: string; label: string; desc: string; icon: typeof Bell; admin?: boolean };
/** The workspaces left in More (27 Oct 2026): everything operational is a bottom tab (Today · Calendar · Manpower · Shutdowns). */
export const WORKSPACES: Item[] = [
  { to: '/data-quality', label: 'Data quality', desc: 'Summary · Issues · Take-Charge · Records · Oracle statistics', icon: ClipboardCheck, admin: true },
  { to: '/import', label: 'Excel import', desc: 'Upload · History', icon: FileUp, admin: true },
  { to: '/admin', label: 'Administration', desc: 'Users & access · Audit history', icon: ShieldCheck, admin: true }
];
