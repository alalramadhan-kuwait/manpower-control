// Validation rules and the check of one change before it is sent or decided (Phase 1 step 3).
import { supabase } from './supabase';
import { fetchManpowerInputs } from './manpower';
import { fetchSdDuties } from './shutdown';
import { evaluateRange } from '@/core/manpower';
import { addDaysIso, CREWS, type Crew } from '@/core/roster';
import type { ManpowerInputs } from './manpower';
import { DEFAULT_RULES, SEVERITY_RANK, applyProposal, ruleOf, shiftTimesOf, validateProposal, type Finding, type Proposal, type ProposalInputs, type RuleConfig, type Validation } from '@/core/validation';

export async function fetchValidationRules(): Promise<RuleConfig[]> {
  const { data, error } = await supabase.from('validation_rules').select('code,severity,enabled,params');
  if (error || !data?.length) return DEFAULT_RULES;
  return data as RuleConfig[];
}

/** Crew-days below the operating minimum because of the change (critical by default: the Section Head may accept it). */
function crewMinimum(inp: ManpowerInputs, before: ProposalInputs, after: ProposalInputs, from: string, to: string, rules: RuleConfig[]): Finding[] {
  const rule = ruleOf(rules, 'crew_minimum');
  if (!rule.enabled) return [];
  const short = (x: ProposalInputs) => {
    const out = new Map<Crew, string[]>();
    for (const day of evaluateRange(from, to, x.people, x.absences, inp.rules, x.assignments))
      for (const c of CREWS) if (day.crews.find((y) => y.crew === c)?.confirmedShortage) out.set(c, [...(out.get(c) ?? []), day.date]);
    return out;
  };
  const was = short(before), now = short(after);
  const out: Finding[] = [];
  for (const c of CREWS) {
    const extra = (now.get(c) ?? []).filter((d) => !(was.get(c) ?? []).includes(d));
    if (extra.length) out.push({ rule: 'crew_minimum', severity: rule.severity, date: extra[0], key: `crew:${c}`,
      message: `${c} Shift short on ${extra.length} more day${extra.length === 1 ? '' : 's'}, from ${Number(extra[0].slice(8))}/${Number(extra[0].slice(5, 7))}.` });
  }
  return out;
}

export interface Check extends Validation { ranAt: string; proposal: Proposal }

/** Every check for one change: the person's schedule (days in a row, rest, overlaps) and the crews' minimums. */
export async function checkProposal(pr: Proposal): Promise<Check> {
  const span = { start: pr.start, end: pr.end ?? addDaysIso(pr.start, 27) };
  const from = addDaysIso(span.start, -21), to = addDaysIso(span.end, 21);
  const [inputs, rules, sdDuty] = await Promise.all([fetchManpowerInputs(from, to), fetchValidationRules(), fetchSdDuties(from, to).catch(() => undefined)]);
  const base: ProposalInputs = { people: inputs.people, absences: inputs.absencesAll, assignments: inputs.assignments };
  const v = validateProposal(base, pr, rules, { times: shiftTimesOf(rules), sdDuty });
  const findings = [...v.findings, ...crewMinimum(inputs, base, applyProposal(base, pr), span.start, span.end, rules)];
  const worst = findings.reduce<Check['worst']>((w, f) => (w === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[w] ? f.severity : w), null);
  return { ...v, findings, worst, ranAt: new Date().toISOString(), proposal: pr };
}

/** What is kept with the request: the findings, the problems already there, and when it was checked. */
export const checkRecord = (c: Check) => ({ ranAt: c.ranAt, findings: c.findings.map(({ rule, severity, message, date, hours }) => ({ rule, severity, message, date, hours })), existing: c.existing.map(({ rule, severity, message, date }) => ({ rule, severity, message, date })) });
