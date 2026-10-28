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
/** To the nearest half hour (owner: the times on the WhatsApp picture, "round to 30 mins"). */
export const round30 = (t: number) => Math.round(t / 1_800_000) * 1_800_000;
/** "Tue 28 Oct" in Kuwait. */
export const kwWeekDay = (t: number) => { const d = new Date(t + KW); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
/** "28 Oct", or "28→29 Oct" / "31 Oct→1 Nov" for two days. */
export const dayRange = (a: number, b: number | null) => {
  const da = new Date(a + KW); const sa = `${da.getUTCDate()} ${MON[da.getUTCMonth()]}`;
  if (b === null) return sa; const db = new Date(b + KW); const sb = `${db.getUTCDate()} ${MON[db.getUTCMonth()]}`;
  if (sa === sb) return sa; return da.getUTCMonth() === db.getUTCMonth() ? `${da.getUTCDate()}→${sb}` : `${sa}→${sb}`;
};
