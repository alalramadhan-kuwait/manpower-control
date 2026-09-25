// Calendar information styling: unit / train bar colours and event icons. None of these colours is a crew
// identity colour or a manpower status colour, so a bar is never read as a crew or a result.
import { CalendarDays, ClipboardList, FlaskConical, Gauge, GraduationCap, Play, Power, Wrench, ZapOff, type LucideIcon } from 'lucide-react';
import type { EventCategory } from '@/data/calendar';

/** Colour per unit / train, by its place in the sorted list of units in use. Operating periods use navy. */
export const UNIT_BAR = ['bg-teal-700', 'bg-slate-700', 'bg-cyan-700', 'bg-stone-600', 'bg-sky-900', 'bg-teal-900'];
export const EVENT_ICON: Record<EventCategory | 'mode', LucideIcon> = {
  shutdown: Power, startup: Play, maintenance: Wrench, catalyst: FlaskConical, outage: ZapOff, operational: ClipboardList, training: GraduationCap, other: CalendarDays, mode: Gauge
};
