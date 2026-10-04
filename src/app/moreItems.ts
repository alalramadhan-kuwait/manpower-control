import { ArrowLeftRight, BadgeCheck, CalendarDays, HardHat, Bell, BarChart3, CalendarRange, ClipboardCheck, FileUp, Gauge, History, ScrollText, ShieldCheck, Sun, UserCheck, UserCog, UserMinus } from 'lucide-react';

export type Item = { to: string; label: string; desc: string; icon: typeof Bell; headOnly?: boolean };
/** Related pages together, two to a row. */
export const GROUPS: { title: string; items: Item[] }[] = [
  { title: 'Shifts & cover', items: [
    { to: '/movements', label: 'Shift movements', desc: 'Covers · moves · day duty', icon: ArrowLeftRight },
    { to: '/controllers', label: 'Controllers', desc: 'Cover · VR assignments', icon: UserCheck },
    { to: '/controllers/board', label: 'Controllers calendar', desc: 'Cover · leave rules', icon: CalendarDays },
    { to: '/controllers/morning', label: 'Morning rotation', desc: 'Plan to end of next year', icon: Sun },
    { to: '/release', label: 'Task release', desc: 'Check the crew first', icon: UserMinus }] },
  { title: 'Leave', items: [
    { to: '/leave-plan', label: 'Leave plan', desc: 'Year plan · add / correct', icon: CalendarRange },
    { to: '/oracle', label: 'Oracle HR', desc: 'Submitted · approved · pending', icon: BadgeCheck },
    { to: '/notifications', label: 'Notifications', desc: 'Next 60 days', icon: Bell }] },
  { title: 'Planning', items: [
    { to: '/operation', label: 'Operating modes', desc: 'Shutdown · one train', icon: Gauge },
    { to: '/shutdown', label: 'Shutdown teams', desc: 'Teams · overtime', icon: HardHat }] },
  { title: 'Data', items: [
    { to: '/summary', label: 'Section summary', desc: 'Headcount · data quality', icon: BarChart3 },
    { to: '/review', label: 'Data quality', desc: 'Items to decide', icon: ClipboardCheck },
    { to: '/review/take-charge', label: 'Take-Charge', desc: 'Confirm Field Operators', icon: ShieldCheck },
    { to: '/imports', label: 'Excel import', desc: 'Workbook · promotion list', icon: FileUp }] },
  { title: 'Admin', items: [
    { to: '/users', label: 'Users & access', desc: 'Logins · roles', icon: UserCog, headOnly: true },
    { to: '/audit', label: 'Audit history', desc: 'Who changed what', icon: ScrollText },
    { to: '/imports/history', label: 'Import history', desc: 'Past uploads', icon: History }] }
];
