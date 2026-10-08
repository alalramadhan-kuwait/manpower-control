// The shutdown workbook, one Excel file with four sheets, laid out like the section's own sheets:
//   OT hrs       each person's overtime per day, the totals and each month against the cap (for the admin, so nobody reaches the limit)
//   Duty         each person's M / N / O per day (for the employees: their schedule of work)
//   Summary      the overtime sheet for the management's approval (per team and month, with the signatures)
//   instruction  personal instructions: when to join the team (with the days off first), and when to rejoin his own shift after it
// Every sheet opens with the KNPC letterhead (logo, title, the refinery and unit, the issue date, the flame's three colours).
import type { Workbook, Worksheet, Cell } from 'exceljs';
import { addDaysIso, type Crew } from '@/core/roster';
import { dayOvertime, isDutyDay, memberHoursOn, memberWorks } from '@/core/shutdown';
import type { Doc, Row } from './SdDocuments';

const DAYS_PER_BLOCK = 14;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const wd = (iso: string) => WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
/** "Mon 8 Apr" */
export const dayText = (iso: string) => `${wd(iso)} ${Number(iso.slice(8))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
const dmy = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
const rangeText = (a: string, b: string) => (a === b ? dayText(a) : `${dayText(a)} – ${dayText(b)}`);
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

/** The KNPC colours, taken from the logo (flame red and green, sea blue). */
const KNPC = { blue: 'FF005DAA', red: 'FFE31E24', green: 'FF009A3E', pale: 'FFE3EDF7', weekend: 'FFC3D7EC', ink: 'FF1F2937', grey: 'FF5B6573' } as const;
const FILL = { head: KNPC.blue, days: KNPC.pale, ctl: 'FFE2EFDA', day: 'FFFCE4D6', night: 'FFEDEDED', off: 'FFFFFF00', not: 'FF000000', sum: 'FFFFC7CE', over: 'FFFF0000' } as const;
const solid = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
const thin = { style: 'thin' as const, color: { argb: 'FF8C96A3' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

function style(c: Cell, o: { bold?: boolean; fill?: string; red?: boolean; align?: 'left' | 'center'; size?: number; wrap?: boolean; border?: boolean; white?: boolean } = {}) {
  c.font = { name: 'Calibri', size: o.size ?? 10, bold: o.bold, color: { argb: o.red ? 'FFFF0000' : o.white ? 'FFFFFFFF' : 'FF000000' } };
  if (o.fill) c.fill = solid(o.fill);
  c.alignment = { horizontal: o.align ?? 'center', vertical: 'middle', wrapText: o.wrap };
  if (o.border !== false) c.border = box;
}
/** A column heading: KNPC blue with white letters. */
const head = (c: Cell, wrap = false) => style(c, { bold: true, fill: KNPC.blue, white: true, wrap });
const rowFill = (x: Row) => (x.group === 'Controller' ? FILL.ctl : x.team.shiftCode === 'N' ? FILL.night : FILL.day);

/** What the letterhead needs: the logo (added to the workbook once) and the line under the title. */
interface Brand { logo?: number; sub: string; issued: string }

/**
 * The KNPC letterhead across columns 1..lastCol, from row `top`: the logo on the left, the title beside it, the refinery,
 * unit and period under it with the issue date on the right, and a thin red / green / blue rule. Returns the next free row.
 */
function letterhead(ws: Worksheet, brand: Brand, title: string, lastCol: number, top = 1, titleCol = 5) {
  ws.getRow(top).height = 28; ws.getRow(top + 1).height = 24; ws.getRow(top + 2).height = 18;
  if (brand.logo !== undefined) ws.addImage(brand.logo, { tl: { col: 0.15, row: top - 1 + 0.2 }, ext: { width: 248, height: 74 }, editAs: 'oneCell' });
  const t = ws.getCell(top, titleCol); t.value = title; ws.mergeCells(top, titleCol, top + 1, lastCol);
  t.font = { name: 'Calibri', size: 14, bold: true, color: { argb: KNPC.blue } }; t.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const half = lastCol - titleCol >= 6 ? lastCol - 3 : lastCol;   // where the issue date starts (the last column on a narrow sheet)
  const s = ws.getCell(top + 2, titleCol); s.value = brand.sub; if (half - 1 > titleCol) ws.mergeCells(top + 2, titleCol, top + 2, half - 1);
  s.font = { name: 'Calibri', size: 10, color: { argb: KNPC.grey } }; s.alignment = { horizontal: 'center', vertical: 'middle' };
  if (half > titleCol) { const d = ws.getCell(top + 2, half); d.value = `Issued ${brand.issued}`; ws.mergeCells(top + 2, half, top + 2, lastCol); d.font = { name: 'Calibri', size: 9, italic: true, color: { argb: KNPC.grey } }; d.alignment = { horizontal: 'right', vertical: 'middle' }; }
  // the rule: the flame's colours, red and green short, then the sea blue to the end
  const rule = top + 3; ws.getRow(rule).height = 5;
  const redTo = Math.max(1, Math.round(lastCol * 0.12)), greenTo = Math.max(redTo + 1, Math.round(lastCol * 0.24));
  for (let c = 1; c <= lastCol; c++) ws.getCell(rule, c).fill = solid(c <= redTo ? KNPC.red : c <= greenTo ? KNPC.green : KNPC.blue);
  ws.getRow(rule + 1).height = 8;
  return rule + 2;
}

/** A4 landscape (or portrait), fitted to the width, centred, with the KNPC footer and the page number on every page. */
function printSetup(ws: Worksheet, title: string) {
  ws.pageSetup.margins = { left: 0.4, right: 0.4, top: 0.45, bottom: 0.55, header: 0.2, footer: 0.25 };
  ws.pageSetup.horizontalCentered = true;
  const esc = (x: string) => x.replace(/&/g, '&&');
  ws.headerFooter.oddFooter = `&L&8&K5B6573KNPC · Mina Abdullah Refinery · ARDS Unit 12&C&8&K5B6573Page &P of &N&R&8&K5B6573${esc(title)}`;
}

/** The 14-day blocks the dates are laid out in, as in the section's sheets. */
const blocksOf = (dates: string[]) => { const out: string[][] = []; for (let i = 0; i < dates.length; i += DAYS_PER_BLOCK) out.push(dates.slice(i, i + DAYS_PER_BLOCK)); return out; };

/** Group labels down the left side (merged cells): consecutive rows of a team with the same group. */
function groupRuns(rows: Row[]) {
  const out: { from: number; to: number; label: string }[] = [];
  rows.forEach((x, i) => { const last = out[out.length - 1]; if (last && rows[i - 1].team.id === x.team.id && rows[i - 1].group === x.group) last.to = i; else out.push({ from: i, to: i, label: x.group }); });
  return out;
}

/** Sheets with a person per row and the days across, in 14-day blocks (OT hrs and Duty). */
function dayGrid(ws: Worksheet, doc: Doc, brand: Brand, title: string, cellOf: (x: Row, d: string) => { v: string | number | null; fill?: string; red?: boolean }, extra?: { head: string[]; of: (x: Row, blockIndex: number) => (string | number | { v: string | number; fill?: string; bold?: boolean })[] }) {
  const { rows, dates } = doc;
  const blocks = blocksOf(dates);
  const lastCol = 4 + DAYS_PER_BLOCK + (extra ? extra.head.length + 1 : 0);
  let r = letterhead(ws, brand, title, lastCol);
  blocks.forEach((b, bi) => {
    if (bi > 0) ws.getRow(r - 3).addPageBreak();   // each 14-day block on its own page
    ws.getCell(r, 2).value = 'EMPLOYEES'; ws.mergeCells(r, 2, r, 4); head(ws.getCell(r, 2));
    ws.getCell(r, 5).value = `DAYS · ${dayText(b[0])} – ${dayText(b[b.length - 1])}`; ws.mergeCells(r, 5, r, 4 + DAYS_PER_BLOCK); style(ws.getCell(r, 5), { bold: true, fill: KNPC.blue, white: true, size: 11 });
    ws.getRow(r).height = 18;
    r++;
    ['S.NO', 'E NO.', 'E. NAME'].forEach((h, i) => { const c = ws.getCell(r, 2 + i); c.value = h; style(c, { bold: true, fill: KNPC.pale }); });
    for (let i = 0; i < DAYS_PER_BLOCK; i++) { const c = ws.getCell(r, 5 + i); c.value = b[i] ? `${wd(b[i])}\n${dmy(b[i])}` : ''; style(c, { bold: true, wrap: true, fill: b[i] && [5, 6].includes(new Date(`${b[i]}T00:00:00Z`).getUTCDay()) ? KNPC.weekend : KNPC.pale }); }
    const tot = ws.getCell(r, 5 + DAYS_PER_BLOCK); tot.value = 'TOTAL'; style(tot, { bold: true, fill: KNPC.pale });
    if (extra && bi === 0) extra.head.forEach((h, i) => { const c = ws.getCell(r, 6 + DAYS_PER_BLOCK + i); c.value = h; style(c, { bold: true, fill: KNPC.pale, wrap: true }); });
    ws.getRow(r).height = 30;
    r++;
    const top = r;
    rows.forEach((x) => {
      const fill = rowFill(x);
      const no = ws.getCell(r, 2); no.value = x.no; style(no, { fill });
      const num = ws.getCell(r, 3); num.value = x.r ? Number(x.r.employee_number) || x.r.employee_number : ''; style(num, { fill });
      const nm = ws.getCell(r, 4); nm.value = x.r?.display_name ?? ''; style(nm, { fill, align: 'left', bold: true });
      let sum = 0;
      for (let i = 0; i < DAYS_PER_BLOCK; i++) {
        const c = ws.getCell(r, 5 + i);
        if (!b[i]) { style(c, { fill: 'FFFFFFFF' }); continue; }
        const v = cellOf(x, b[i]);
        c.value = v.v; style(c, { fill: v.fill ?? fill, red: v.red, bold: v.red });
        if (typeof v.v === 'number') sum += v.v; else if (v.v && v.v !== 'O') sum += 1;
      }
      const t = ws.getCell(r, 5 + DAYS_PER_BLOCK); t.value = sum; style(t, { bold: true, fill: FILL.sum });
      if (extra && bi === 0) extra.of(x, bi).forEach((e, i) => { const c = ws.getCell(r, 6 + DAYS_PER_BLOCK + i); const o = typeof e === 'object' ? e : { v: e }; c.value = o.v; style(c, { bold: true, fill: o.fill ?? 'FFFFFFFF' }); });
      r++;
    });
    groupRuns(rows).forEach((g) => { ws.mergeCells(top + g.from, 1, top + g.to, 1); const c = ws.getCell(top + g.from, 1); c.value = g.label; c.alignment = { textRotation: 90, horizontal: 'center', vertical: 'middle', shrinkToFit: true }; c.font = { name: 'Calibri', bold: true, size: 9, color: { argb: KNPC.blue } }; c.border = box; });
    r += 2;
  });
  ws.getColumn(1).width = 5; ws.getColumn(2).width = 6; ws.getColumn(3).width = 9; ws.getColumn(4).width = 24;
  for (let i = 0; i < DAYS_PER_BLOCK; i++) ws.getColumn(5 + i).width = 9;
  ws.getColumn(5 + DAYS_PER_BLOCK).width = 8;
  if (extra) for (let i = 0; i < extra.head.length; i++) ws.getColumn(6 + DAYS_PER_BLOCK + i).width = 12;
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 0, showGridLines: false }];
  printSetup(ws, title);
  return r;
}

function otSheet(ws: Worksheet, doc: Doc, brand: Brand) {
  const { plan, dates, months } = doc;
  const otOf = (x: Row, d: string) => dayOvertime(plan, x.m, x.crew, d);
  const onTeam = (x: Row, d: string) => d >= x.m.start && d <= x.m.end;
  const monthTotal = (x: Row, ym: string) => dates.filter((d) => d.startsWith(ym) && onTeam(x, d)).reduce((n, d) => n + otOf(x, d), 0);
  const end = dayGrid(ws, doc, brand, `ARDS UNIT-12 ${doc.name} SHUTDOWN OVERTIME HOURS`, (x, d) => {
    if (!onTeam(x, d)) return { v: null, fill: FILL.not };
    const works = memberWorks(plan, x.m, d);
    const h = otOf(x, d);
    return works ? { v: h, red: h >= plan.shiftHours } : { v: 0, fill: FILL.off };
  }, {
    head: [`TOTAL OT HRS ${dmy(dates[0])} - ${dmy(dates[dates.length - 1])}`, ...months.map((ym) => `${monthLabel(ym)} OT (max ${plan.maxOvertime})`)],
    of: (x) => [{ v: dates.filter((d) => onTeam(x, d)).reduce((n, d) => n + otOf(x, d), 0), fill: 'FFFFFF00' }, ...months.map((ym) => { const t = monthTotal(x, ym); return { v: t, fill: t > plan.maxOvertime ? 'FFFF7C80' : t >= plan.maxOvertime - 8 ? 'FFFFE699' : 'FFC6EFCE' }; })]
  });
  const note = ws.getCell(end, 2);
  note.value = `Overtime = hours worked on the shutdown less the ${plan.normalHours} h of a normal duty day of his crew; a day worked on his rest day counts in full (red). Yellow = off. Black = not on the team. Month columns: green = within the limit, amber = within 8 h of it, red = over ${plan.maxOvertime} h.`;
  ws.mergeCells(end, 2, end, 4 + DAYS_PER_BLOCK); note.alignment = { wrapText: true, vertical: 'top' }; note.font = { name: 'Calibri', size: 9, italic: true }; ws.getRow(end).height = 38;
}

function dutySheet(ws: Worksheet, doc: Doc, brand: Brand) {
  const { plan } = doc;
  const end = dayGrid(ws, doc, brand, `ARDS UNIT-12 ${doc.name} SHUTDOWN MANPOWER SCHEDULE`, (x, d) => {
    if (d < x.m.start || d > x.m.end) return { v: null, fill: FILL.not };
    if (!memberWorks(plan, x.m, d)) return { v: 'O', fill: FILL.off };
    const h = memberHoursOn(plan, x.m, d);
    // red letter: working on his crew's rest day (full overtime); the hours beside the letter on a shorter day
    return { v: `${x.team.shiftCode}${h < plan.shiftHours ? h : ''}`, red: !isDutyDay(x.crew, d), fill: x.team.shiftCode === 'N' ? 'FFD9D9D9' : 'FFDDEBF7' };
  });
  const legend = [`M / N = day / night shift of ${plan.shiftHours} h`, `M${plan.normalHours} / N${plan.normalHours} = a shorter day, the hours beside the letter`, 'O (yellow) = off', 'Red letter = working on his crew\'s rest day (full overtime)', 'Black = not on the team'];
  legend.forEach((t, i) => { const c = ws.getCell(end + i, 2); c.value = t; ws.mergeCells(end + i, 2, end + i, 12); c.font = { name: 'Calibri', size: 9 }; c.alignment = { horizontal: 'left' }; });
}

/** The overtime sheet for approval: per month, per team, each day's overtime, the month's total and the shutdown total; the signatures. */
function summarySheet(ws: Worksheet, doc: Doc, brand: Brand) {
  const { plan, teams, rows, dates, months, signatures } = doc;
  const widest = Math.max(...months.map((ym) => dates.filter((d) => d.startsWith(ym)).length));
  const lastCol = 3 + widest + 2;
  const sheetTitle = `KNPC-MAB - ARDS UNIT-12 ${doc.name} SHUTDOWN MANPOWER OVERTIME`;
  let r = 1;
  months.forEach((ym, mi) => {
    const days = dates.filter((d) => d.startsWith(ym));
    // each month is a page for approval, with its own letterhead and signatures
    if (mi > 0) ws.getRow(r - 1).addPageBreak();
    r = letterhead(ws, { ...brand, sub: `${brand.sub.split(' · ').slice(0, -1).join(' · ')} · ${monthLabel(ym)} ${ym.slice(0, 4)}` }, sheetTitle, lastCol, r, 4);
    teams.forEach((t) => {
      const list = rows.filter((x) => x.team.id === t.id);
      if (!list.length) return;
      const title = ws.getCell(r, 1); title.value = `${t.name.toUpperCase()} ${plan.kind === 'total' ? 'SHIFT' : 'GROUP'}${t.hoursLabel ? ` (${t.hoursLabel.replace(/(\d\d:\d\d)/g, '$1 HRS').replace(/\s*-\s*/, ' TO ')})` : ''} ${monthLabel(ym).toUpperCase()} ${ym.slice(0, 4)}`;
      ws.mergeCells(r, 1, r, lastCol); style(title, { bold: true, align: 'left', fill: KNPC.pale }); title.font = { ...title.font, color: { argb: KNPC.blue } };
      r++;
      // a shorter month leaves blank day columns, so the two totals stay over their own columns
      const heads = ['Sr.No.', 'NAME', 'EMP.NO', ...days.map((d) => String(Number(d.slice(8)))), ...Array<string>(widest - days.length).fill(''), `Tot ${monthLabel(ym)} OT`, 'Total OT'];
      heads.forEach((h, i) => { const c = ws.getCell(r, 1 + i); c.value = h; if (h) head(c, true); else style(c, { fill: 'FFFFFFFF' }); });
      ws.getRow(r).height = 30;
      r++;
      list.forEach((x, i) => {
        const fill = x.group === 'Controller' ? FILL.ctl : undefined;
        const put = (col: number, v: string | number | null, o: Parameters<typeof style>[1] = {}) => { const c = ws.getCell(r, col); c.value = v; style(c, { fill, ...o }); };
        put(1, i + 1); put(2, x.r?.display_name ?? '', { align: 'left' }); put(3, x.r ? Number(x.r.employee_number) || x.r.employee_number : '');
        let month = 0, all = 0;
        days.forEach((d, k) => {
          const h = dayOvertime(plan, x.m, x.crew, d); month += h;
          const off = !memberWorks(plan, x.m, d) && d >= x.m.start && d <= x.m.end;
          put(4 + k, d >= x.m.start && d <= x.m.end ? h : null, { fill: off ? FILL.off : d < x.m.start || d > x.m.end ? FILL.not : fill, red: h >= plan.shiftHours });
        });
        for (const d of dates) all += dayOvertime(plan, x.m, x.crew, d);
        for (let k = days.length; k < widest; k++) put(4 + k, null, { fill: 'FFFFFFFF' });
        put(4 + widest, month, { bold: true, fill: month > plan.maxOvertime ? 'FFFF7C80' : FILL.sum });
        put(5 + widest, all, { bold: true });
        r++;
      });
      r++;
    });
    const notes = [`Note:- ${teams.map((t) => `${t.name} Shift ${t.hoursLabel?.replace(/(\d\d:\d\d)/g, '$1 Hrs') ?? ''}`).join(' · ')}`, `Legend: 0 = no OT · ${plan.shiftHours - plan.normalHours} = ${plan.shiftHours - plan.normalHours} hrs OT · ${plan.shiftHours} = ${plan.shiftHours} hrs OT · yellow = off`];
    notes.forEach((t) => { const c = ws.getCell(r, 1); c.value = t; ws.mergeCells(r, 1, r, lastCol); c.font = { name: 'Calibri', size: 9 }; c.alignment = { horizontal: 'left' }; r++; });
    r += 2;
    const per = Math.max(1, signatures.length);
    const span = Math.max(1, Math.floor(lastCol / per));
    signatures.forEach((s, i) => {
      const c0 = 1 + i * span;
      const a = ws.getCell(r, c0); a.value = s.name; ws.mergeCells(r, c0, r, Math.min(lastCol, c0 + span - 1)); a.font = { name: 'Calibri', bold: true, size: 10 }; a.alignment = { horizontal: 'center' }; a.border = { top: thin };
      const b = ws.getCell(r + 1, c0); b.value = s.title; ws.mergeCells(r + 1, c0, r + 1, Math.min(lastCol, c0 + span - 1)); b.font = { name: 'Calibri', size: 9, bold: true }; b.alignment = { horizontal: 'center', wrapText: true };
    });
    r += 4;
  });
  ws.getColumn(1).width = 7; ws.getColumn(2).width = 24; ws.getColumn(3).width = 9;
  for (let i = 0; i < widest; i++) ws.getColumn(4 + i).width = 5;
  ws.getColumn(4 + widest).width = 12; ws.getColumn(5 + widest).width = 10;
  ws.views = [{ showGridLines: false }];
  printSetup(ws, sheetTitle);
}

export interface FollowMove { start: string; end: string | null; to: Crew }

/** What one person is told, in two parts: how to begin (before and when joining) and how to end (rejoining his own shift). "No change" when nothing differs. */
export function personalInstruction(doc: Doc, x: Row, move?: FollowMove) {
  const { plan, dates } = doc;
  const worked = dates.filter((d) => memberWorks(plan, x.m, d));
  if (!worked.length) return null;
  const first = worked[0]; const last = worked[worked.length - 1];
  const from = x.m.start > plan.start ? x.m.start : plan.start;
  const home = x.after;
  const homeName = home ? `${home} Shift` : 'day duty';
  const team = `the ${x.team.name} ${plan.kind === 'total' ? 'shift' : 'team'}`;
  const offFirst = first > from;
  let begin = 'No change'; let beginKind: 'follow' | 'off' | 'move' | 'days' | null = null;
  if (move) { beginKind = 'follow'; begin = `Follow ${move.to} Shift from ${dayText(move.start)}${offFirst ? `, take off ${rangeText(from, addDaysIso(first, -1))}` : ''}, join ${team} ${dayText(first)}`; }
  else if (offFirst) { beginKind = 'off'; begin = `Take off ${rangeText(from, addDaysIso(first, -1))}, join ${team} ${dayText(first)}`; }
  else if (x.vr && x.m.followCrew) { beginKind = 'move'; begin = `Move to ${x.m.followCrew} Shift${offFirst ? `, take off ${rangeText(from, addDaysIso(first, -1))}` : ''}, join ${team} ${dayText(first)}`; }
  else if (x.m.followCrew) { beginKind = 'days'; begin = `Join ${team} ${dayText(first)}, working ${x.m.followCrew} Shift's days`; }
  const e = addDaysIso(last, 1);
  let back = e;
  for (let i = 0; i < 16 && !isDutyDay(home, back); i++) back = addDaysIso(back, 1);
  const vrMove = x.vr && !!x.m.followCrew && !!home;   // a VR Controller moves back to his placement, even when the days line up
  const end = back === e ? (vrMove ? `Move to ${homeName} ${dayText(e)}` : 'No change') : `Take off ${rangeText(e, addDaysIso(back, -1))}, ${vrMove ? 'move to' : 'rejoin'} ${homeName} ${dayText(back)}`;
  const beginAction = begin !== 'No change', endAction = end !== 'No change';
  const endKind: 'off' | 'move' | null = !endAction ? null : back !== e ? 'off' : 'move';
  return { first, last, begin, end, beginAction, endAction, action: beginAction || endAction, beginKind, endKind, beginOn: move ? move.start : from, endOn: e };
}

function instructionSheet(ws: Worksheet, doc: Doc, brand: Brand, moves: Map<string, FollowMove>) {
  const { rows } = doc;
  const title = `ARDS UNIT-12 ${doc.name} SHUTDOWN: PERSONAL INSTRUCTIONS`;
  const top = letterhead(ws, brand, title, 6, 1, 4);
  ws.getCell(top, 1).value = 'BEGIN: what to do to join the shutdown team. END: what to do to return to the own shift. "No change" = keep the own shift as it is. Yellow = needs action.';
  ws.mergeCells(top, 1, top, 6); ws.getCell(top, 1).font = { name: 'Calibri', size: 9, italic: true, color: { argb: KNPC.grey } }; ws.getCell(top, 1).alignment = { wrapText: true, vertical: 'top' }; ws.getRow(top).height = 28;
  ['S.NO', 'E NO.', 'E. NAME', 'TEAM · OWN SHIFT', 'BEGIN', 'END'].forEach((h, i) => { const c = ws.getCell(top + 1, 1 + i); c.value = h; head(c, true); });
  ws.getRow(top + 1).height = 20;
  let r = top + 2;
  rows.forEach((x, i) => {
    const p = personalInstruction(doc, x, moves.get(x.m.employeeId));
    if (!p) return;
    const vals: (string | number)[] = [i + 1, x.r ? Number(x.r.employee_number) || x.r.employee_number : '', x.r?.display_name ?? '', `${x.team.name} · ${x.home ? `${x.home} Shift` : 'Day staff'}`, p.begin, p.end];
    vals.forEach((v, k) => {
      const c = ws.getCell(r, 1 + k); c.value = v;
      style(c, { fill: (k === 4 && p.beginAction) || (k === 5 && p.endAction) ? 'FFFFF2CC' : undefined, align: k >= 4 ? 'left' : 'center', wrap: true, bold: k === 2 });
      c.alignment = { ...c.alignment, vertical: 'middle' };
    });
    ws.getRow(r).height = 32;
    r++;
  });
  [6, 9, 24, 18, 52, 44].forEach((w, i) => { ws.getColumn(1 + i).width = w; });
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: top + 1, showGridLines: false }];
  printSetup(ws, title);
}

/** The KNPC logo as base64 PNG (public/brand/knpc-logo.png); the workbook is still made without it if it cannot be read. */
export async function knpcLogo(): Promise<string | undefined> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}brand/knpc-logo.png`);
    if (!res.ok) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch { return undefined; }
}

const issuedToday = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuwait' });

/** Builds the workbook (ExcelJS is loaded on demand: it is large and only needed here). */
export async function buildSdWorkbook(doc: Doc, moves: Map<string, FollowMove> = new Map(), logo?: string, issued = issuedToday()): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KNPC · ARDS Operations · Manpower Control'; wb.company = 'Kuwait National Petroleum Company'; wb.created = new Date();
  const { start, end } = doc.plan;
  const brand: Brand = {
    logo: logo ? wb.addImage({ base64: logo, extension: 'png' }) : undefined,
    sub: `Mina Abdullah Refinery · ARDS Operations · Area 4 · Unit 12 · ${dayText(start)} – ${dayText(end)} ${end.slice(0, 4)}`,
    issued,
  };
  const sheet = (name: string, color: string, landscape = true) => wb.addWorksheet(name, { properties: { tabColor: { argb: color } }, pageSetup: { orientation: landscape ? 'landscape' : 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }, views: [{ showGridLines: false }] });
  otSheet(sheet('OT hrs', KNPC.red), doc, brand);
  dutySheet(sheet('Duty', KNPC.blue), doc, brand);
  summarySheet(sheet('Summary', KNPC.green), doc, brand);
  instructionSheet(sheet('instruction', KNPC.blue), doc, brand, moves);
  return wb;
}

export const workbookFileName = (doc: Doc) => `${doc.plan.title.replace(/[^A-Za-z0-9 ()-]/g, '').trim() || 'Shutdown'} - manpower schedule, overtime and instructions.xlsx`;

export async function downloadSdWorkbook(doc: Doc, moves: Map<string, FollowMove>) {
  const wb = await buildSdWorkbook(doc, moves, await knpcLogo());
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = workbookFileName(doc); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
