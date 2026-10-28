// Times in 12-hour AM / PM, Kuwait time (owner, 28 Oct 2026: "show the time as AM PM" everywhere in the app).
// Data files (CSV exports) and the time fields people type into keep their own formats.
const KW = 3 * 3_600_000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ms = (t: string | number | Date) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t));

/** "2:32 PM" */
export const clock12 = (t: string | number | Date) => { const d = new Date(ms(t) + KW); const h = d.getUTCHours(); return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
/** "7 AM", "7:30 PM": an hour on the dot without its minutes (shift and team hours) */
export const hour12 = (t: string | number | Date) => clock12(t).replace(':00 ', ' ');
/** "28 Oct 2:32 PM", with the year when asked: "28 Oct 2026, 2:32 PM" */
export const dateTime12 = (t: string | number | Date, year = false) => { const d = new Date(ms(t) + KW); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()},` : ''} ${clock12(t)}`; };
/** A "HH:MM" time of day (a rule's shift time) as "7:00 PM". */
export const hhmm12 = (hhmm: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm); if (!m) return hhmm; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 || h === 24 ? 'AM' : 'PM'}`; };
