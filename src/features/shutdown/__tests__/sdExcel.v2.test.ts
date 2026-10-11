// G16: the plan check, the print pages and the Excel file read one overtime calculation, so their figures agree.
import { describe, expect, it } from 'vitest';
import type { Crew } from '@/core/roster';
import type { MpPerson } from '@/core/manpower';
import { planDates, type SdMember, type SdPlan, type SdTeam } from '@/core/shutdown';
import { spreadGroup, spreadGroups } from '@/core/shutdown/spread';
import { checkPlan, type PersonInfo } from '@/core/shutdown/v2';
import { DEFAULT_RULES } from '@/core/validation';
import { buildSdWorkbook } from '../sdExcel';
import { rowOvertime } from '../docOt';
import type { Doc, Row } from '../SdDocuments';

// over a month-end, so the night team has a duty split between October and November
const plan: SdPlan = { id: 'p', title: 'Train-1 SD', kind: 'train', areas: [], sections: [], start: '2026-10-20', end: '2026-11-12', eventId: null,
  daysOn: 3, daysOff: 1, shiftHours: 12, rampDays: 2, rampHours: 12, normalHours: 8, maxOvertime: 72, maxOvertimeYear: 380, maxOvertimeHard: 80, maxOvertimeYearHard: 440, rulesVersion: 2 };
const needs = { controller: 2, senior: 2, good: 2, new: 1 }, reduced = { controller: 1, senior: 1, good: 1, new: 0 };
const night: SdTeam = { id: 'n', planId: 'p', name: 'Night', sort: 0, needs, rampNeeds: reduced, shiftCode: 'N', hoursLabel: '19:00 - 07:00' };
const crews: Record<string, Crew> = { c1: 'A', c2: 'C', s1: 'B', s2: 'D', g1: 'A', g2: 'C' };
const slotOf = (id: string): SdMember['slot'] => (id[0] === 'c' ? 'controller' : id[0] === 's' ? 'senior' : 'good');
let members: SdMember[] = Object.keys(crews).map((id) => ({ id, planId: 'p', teamId: 'n', employeeId: id, slot: slotOf(id), offset: 0, start: plan.start, end: plan.end, days: {} }));
for (const g of spreadGroups(plan, night, members, [])) {
  if (!g.memberIds.length) continue;
  const r = spreadGroup(plan, g, members, { crewOf: (id) => crews[id], away: () => false, maxRun: 6, v2: true });
  members = members.map((m) => { const d = r.days.get(m.id); return d ? { ...m, days: { ...m.days, ...Object.fromEntries(Object.entries(d).map(([k, w]) => [k, { works: w, hours: w ? r.hours.get(m.id)?.[k] ?? null : null }])) } } : m; });
}
const person = (id: string): MpPerson => ({ id, employeeNumber: id, name: id.toUpperCase(), role: id[0] === 'c' ? 'controller' : 'field_operator', crew: crews[id], grade: id[0] === 'c' ? 16 : 13, employmentType: 'knpc', takeCharge: null, panelQualified: null, actingController: null, moves: [{ start: plan.start, end: plan.end, crew: 'SD', kind: 'sd' }] });
const info = new Map(Object.keys(crews).map((id) => [id, { id, name: id.toUpperCase(), position: id[0] === 'c' ? 'controller' : 'field_operator', grade: id[0] === 'c' ? 16 : 13, foLevel: id[0] === 's' ? 'senior' : id[0] === 'g' ? 'good' : null } as PersonInfo]));
const dates = planDates(plan);
const rows: Row[] = members.map((m, i) => ({ m, team: night, r: { id: m.employeeId, display_name: m.employeeId.toUpperCase(), employee_number: String(70000 + i) } as never, crew: crews[m.employeeId], home: crews[m.employeeId], after: crews[m.employeeId], vr: false, group: m.slot === 'controller' ? 'Controller' : 'Operators', no: i + 1, person: person(m.employeeId) }));
const doc: Doc = { plan, teams: [night], rows, signatures: [], dates, months: ['2026-10', '2026-11'], name: 'TRAIN-1' };

describe('G16 · one overtime calculation everywhere', () => {
  const check = checkPlan({ plan, teams: [night], members, people: Object.keys(crews).map(person), absences: [], assignments: [], rules: DEFAULT_RULES, info, plans: [], otherDuties: [],
    otEntries: new Map(), sickEntries: new Map(), exceptions: [], today: '2026-10-01' });
  it('the plan check and the document rows agree per person, per month', () => {
    for (const x of rows) {
      const o = check.overtime.find((p) => p.employeeId === x.m.employeeId)!;
      expect(rowOvertime(doc, x).total).toBeCloseTo(o.plan, 2);
      for (const mo of o.months) expect(rowOvertime(doc, x).month(mo.key)).toBeCloseTo(mo.plan, 2);
    }
    expect(check.overtime.some((o) => o.duties.some((d) => d.split))).toBe(true);   // a night across 31 Oct
  });
  it('the Excel OT sheet carries the same totals', async () => {
    const wb = await buildSdWorkbook(doc, new Map(), undefined, '1 Oct 2026');
    const ws = wb.getWorksheet('OT hrs')!;
    let seen = 0;
    ws.eachRow((row) => {
      const name = row.getCell(4).value;
      const x = rows.find((y) => y.r?.display_name === name);
      if (!x || typeof row.getCell(20).value !== 'number') return;
      const o = check.overtime.find((p) => p.employeeId === x.m.employeeId)!;
      expect(row.getCell(20).value).toBeCloseTo(o.plan, 2);
      expect(row.getCell(21).value).toBeCloseTo(o.months.find((m) => m.key === '2026-10')!.plan, 2);
      expect(row.getCell(22).value).toBeCloseTo(o.months.find((m) => m.key === '2026-11')!.plan, 2);
      seen++;
    });
    expect(seen).toBe(rows.length);
  });
});
