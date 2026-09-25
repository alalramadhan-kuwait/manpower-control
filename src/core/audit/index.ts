// Audit history (Stage J): turns audit_log rows into plain sentences.
// The database writes one row for every insert / update / delete on the audited tables (trigger audit_row_change),
// plus the login changes made by the manage-users Edge Function (entity_table = 'user_accounts').
// Nothing here changes data; it only reads the before / after snapshots.
import { ORACLE_LABEL, type OracleStatus } from '../oracle';

export type AuditCategory = 'crews' | 'leave' | 'requests' | 'controllers' | 'modes' | 'qualifications' | 'staff' | 'logins' | 'other';

export const AUDIT_CATEGORIES: { key: AuditCategory; label: string; tables: string[] }[] = [
  { key: 'crews', label: 'Crews & roles', tables: ['employee_role_assignments', 'crew_movements'] },
  { key: 'leave', label: 'Leave', tables: ['leave_records'] },
  { key: 'requests', label: 'Requests', tables: ['leave_requests'] },
  { key: 'controllers', label: 'Controllers', tables: ['controller_assignments', 'controller_rules'] },
  { key: 'modes', label: 'Modes & calendar', tables: ['operating_modes', 'operation_periods', 'public_holidays', 'unit_events'] },
  { key: 'qualifications', label: 'Qualifications', tables: ['employee_qualifications'] },
  { key: 'staff', label: 'Staff records', tables: ['employees'] },
  { key: 'logins', label: 'Logins', tables: ['user_accounts'] }
];

export interface AuditRow {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  entity_table: string;
  entity_id: string | null;
  action: 'insert' | 'update' | 'delete' | string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  reason: string | null;
  related_employee_id: string | null;
  batch_id: string | null;
}

/** Names for ids and codes found in the snapshots. */
export interface AuditLookups {
  people: Map<string, string>;       // employee id → display name
  positions: Map<string, string>;    // position id → label
  crews: Map<string, string>;        // crew id → code (A..D)
  absence: Map<string, string>;      // absence type code → short code or label
  actors: Map<string, string>;       // auth user id → login display name
}

export interface AuditEntry {
  id: string;
  at: string;
  category: AuditCategory;
  /** One line: what happened. */
  title: string;
  /** Further lines: what changed (field: before → after) or the reason given. */
  details: string[];
  employeeId: string | null;
  employeeName: string | null;
  actor: string;
  fromImport: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-09-24 → 24 Sep 2026 */
export const day = (d: unknown): string => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d)) return '—';
  return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
};
const range = (a: unknown, b: unknown) => (b ? (a === b ? day(a) : `${day(a)} – ${day(b)}`) : `${day(a)} onward`);
const s = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const WORDS: Record<string, string> = {
  yes: 'Yes', no: 'No', not_yet_confirmed: 'Not yet', approved: 'approved', planned: 'planned', cancelled: 'cancelled', rescheduled: 'not taken on these dates',
  unresolved: 'unresolved', submitted: 'entered', reviewed: 'reviewed', not_approved: 'not approved', withdrawn: 'withdrawn', active: 'active',
  knpc: 'KNPC', contractor: 'Contractor', section_head: 'Section Head', manpower_coordinator: 'Manpower Coordinator', controller: 'Controller', employee: 'no app access',
  take_charge: 'Take-Charge', panel_operator: 'Panel qualification', acting_controller: 'Acting Controller', controller_qualified: 'Controller qualification',
  shift_cover: 'Controller cover', morning_rotation: 'Morning rotation', scheduled: 'Scheduled', unscheduled: 'Unscheduled', unpaid: 'Unpaid'
};
const ora = (v: unknown) => ORACLE_LABEL[v as OracleStatus] ?? w(v);
const w = (v: unknown) => { const t = s(v); return t === null ? 'not recorded' : WORDS[t] ?? t; };

/** Field-by-field changes between two snapshots, only for the listed fields. */
function changes(prev: Record<string, unknown> | null, next: Record<string, unknown> | null, fields: [string, string, (v: unknown) => string][]): string[] {
  if (!prev || !next) return [];
  const out: string[] = [];
  for (const [key, label, fmt] of fields) if (JSON.stringify(prev[key] ?? null) !== JSON.stringify(next[key] ?? null)) out.push(`${label}: ${fmt(prev[key])} → ${fmt(next[key])}`);
  return out;
}

export function describe(row: AuditRow, lk: AuditLookups): AuditEntry {
  const cur = (row.next ?? row.previous ?? {}) as Record<string, unknown>;
  const prev = row.previous, next = row.next;
  const empId = row.related_employee_id ?? (s(cur.employee_id) as string | null);
  const who = (id: unknown) => (typeof id === 'string' ? lk.people.get(id) ?? 'a staff member' : 'a staff member');
  const crewOf = (id: unknown) => (typeof id === 'string' ? lk.crews.get(id) ?? '?' : null);
  const cat = AUDIT_CATEGORIES.find((c) => c.tables.includes(row.entity_table))?.key ?? 'other';
  let title = `${row.entity_table}: ${row.action}`;
  let details: string[] = [];

  switch (row.entity_table) {
    case 'employees': {
      const name = s(cur.display_name) ?? 'Staff member';
      if (row.action === 'insert') title = `Staff member added: ${name} (#${s(cur.employee_number) ?? '?'})`;
      else if (row.action === 'delete') title = `Staff member removed: ${name} (#${s(cur.employee_number) ?? '?'})`;
      else {
        title = next?.is_active === false && prev?.is_active !== false ? `${name} marked inactive` : next?.is_active === true && prev?.is_active === false ? `${name} marked active again` : `Staff record changed: ${name}`;
        details = changes(prev, next, [['display_name', 'Name', w], ['grade', 'Grade', w], ['employment_type', 'Employment', w], ['cost_center', 'Cost centre', w],
          ['in_unit12_scope', 'In Unit 12', (v) => (v ? 'Yes' : 'No')], ['last_promotion_date', 'Last promotion', day], ['master_position', 'Master position', w]]);
      }
      break;
    }
    case 'employee_role_assignments': {
      const pos = lk.positions.get(String(cur.position_id)) ?? 'a role no longer in use';
      const crew = crewOf(cur.home_crew_id);
      const where = crew ? `, ${crew} Shift` : '';
      if (row.action === 'insert') title = `${who(empId)}: ${pos}${where} from ${day(cur.effective_from)}`;
      else if (row.action === 'delete') title = `${who(empId)}: role period removed (${pos}${where}, ${range(cur.effective_from, cur.effective_to)})`;
      else {
        const crewChange = prev && next && prev.home_crew_id !== next.home_crew_id;
        title = crewChange ? `${who(empId)}: crew ${crewOf(prev!.home_crew_id) ?? 'none'} → ${crewOf(next!.home_crew_id) ?? 'none'} from ${day(cur.effective_from)}`
          : next?.effective_to && !prev?.effective_to ? `${who(empId)}: ${pos}${where} ended ${day(next.effective_to)}` : `${who(empId)}: role record changed`;
        details = changes(prev, next, [['position_id', 'Role', (v) => lk.positions.get(String(v)) ?? '—'], ['effective_from', 'From', day], ['effective_to', 'Until', (v) => (v ? day(v) : 'open')]]);
      }
      if (s(cur.note)) details.push(String(cur.note));
      break;
    }
    case 'crew_movements': {
      const to = cur.to_crew === 'DAY' ? 'day duty' : `${s(cur.to_crew)} Shift`;
      const kind = cur.kind === 'permanent' ? 'Permanent move' : cur.to_crew === 'DAY' ? 'Day duty' : 'Temporary cover';
      const span = cur.end_date ? range(cur.start_date, cur.end_date) : `${day(cur.start_date)} until further notice`;
      const what = cur.kind === 'permanent' ? `${s(cur.from_crew) ?? '?'} → ${s(cur.to_crew)} from ${day(cur.start_date)}`
        : cur.to_crew === 'DAY' ? `from ${s(cur.from_crew) ?? '?'} Shift, ${span}` : `${s(cur.from_crew) ?? '?'} → ${to}, ${span}`;
      if (row.action === 'insert') title = `${who(empId)}: ${kind.toLowerCase()} ${what}`;
      else if (next?.status === 'cancelled' && prev?.status !== 'cancelled') { title = `${who(empId)}: ${kind.toLowerCase()} cancelled (${what})`; if (s(next.cancel_reason)) details.push(`Reason: ${next.cancel_reason}`); }
      else if (prev && next && prev.end_date !== next.end_date) title = `${who(empId)}: ${kind.toLowerCase()} ends ${day(next.end_date)} (was ${next.end_date && prev.end_date ? day(prev.end_date) : 'until further notice'})`;
      else title = `${who(empId)}: ${kind.toLowerCase()} changed`;
      if (row.action === 'insert' && s(cur.reason)) details.push(`Reason: ${cur.reason}`);
      break;
    }
    case 'leave_records': {
      const type = lk.absence.get(String(cur.absence_type_code)) ?? w(cur.absence_type_code);
      const span = range(cur.start_date, cur.end_date);
      if (row.action === 'insert') title = `${who(empId)}: ${type} ${span} recorded (${w(cur.status)})`;
      else if (row.action === 'delete') title = `${who(empId)}: ${type} ${span} deleted`;
      else {
        const st = prev?.status !== next?.status;
        const oracle = prev?.oracle_status !== next?.oracle_status && prev?.start_date === next?.start_date && prev?.end_date === next?.end_date;
        title = oracle && !st ? `${who(empId)}: ${type} ${span} · Oracle: ${ora(next?.oracle_status)}`
          : st && next?.status === 'cancelled' ? `${who(empId)}: ${type} ${span} cancelled`
          : st && next?.status === 'rescheduled' ? `${who(empId)}: ${type} ${span} not taken on these dates`
          : `${who(empId)}: ${type} ${span} changed`;
        details = changes(prev, next, [['start_date', 'First day', day], ['end_date', 'Last day', day], ['status', 'Status', w],
          ['absence_type_code', 'Type', (v) => lk.absence.get(String(v)) ?? w(v)], ['in_current_plan', 'Counts', (v) => (v === false ? 'No' : 'Yes')], ['oracle_status', 'Oracle', ora], ['oracle_ref', 'Oracle no.', (v) => (s(v) ? String(v) : '—')]]);
      }
      if (s(cur.note) && row.action === 'insert') details.push(String(cur.note));
      break;
    }
    case 'leave_requests': {
      const span = range(cur.start_date, cur.end_date);
      const type = w(cur.request_type);
      if (row.action === 'insert') title = `${who(empId)}: ${type} leave request ${span} entered`;
      else if (prev?.status !== next?.status) {
        title = `${who(empId)}: leave request ${span} ${w(next?.status)}`;
        const remark = next?.status === 'reviewed' ? next?.review_remarks : next?.status === 'withdrawn' ? next?.withdraw_reason : next?.decision_remarks;
        if (next?.status === 'reviewed' && typeof next?.overtime_required === 'boolean') details.push(`Overtime: ${next.overtime_required ? 'required' : 'not required'}`);
        if (s(remark)) details.push(String(remark));
      } else { title = `${who(empId)}: leave request ${span} edited`; details = changes(prev, next, [['start_date', 'First day', day], ['end_date', 'Last day', day], ['request_type', 'Type', w]]); }
      break;
    }
    case 'controller_assignments': {
      const kind = w(cur.kind);
      const span = range(cur.start_date, cur.end_date);
      const desc = cur.kind === 'shift_cover' ? `${who(cur.employee_id)} covers ${s(cur.crew_code)} Shift${cur.covers_employee_id ? ` for ${who(cur.covers_employee_id)}` : ''}, ${span}` : `${who(cur.employee_id)} holds the Morning post, ${span}`;
      if (row.action === 'insert') title = `${kind}: ${desc}`;
      else if (next?.status === 'cancelled' && prev?.status !== 'cancelled') { title = `${kind} cancelled: ${desc}`; if (s(next.cancel_reason)) details.push(`Reason: ${next.cancel_reason}`); }
      else { title = `${kind} changed: ${desc}`; details = changes(prev, next, [['start_date', 'First day', day], ['end_date', 'Last day', day]]); }
      if (s(cur.note) && row.action === 'insert') details.push(String(cur.note));
      break;
    }
    case 'controller_rules':
      title = 'Controller rules changed';
      details = changes(prev, next, [['shift_cover_max_days', 'Longest shift cover (days)', w]]);
      break;
    case 'operating_modes': {
      const mins = (v: Record<string, unknown> | null) => (v ? `Controller ${v.controller_min} · Panel ${v.panel_min} (${v.panel_grade14_min} Grade 14+) · Field ${v.field_min}` : '—');
      const name = s(cur.label) ?? s(cur.code) ?? 'Mode';
      if (row.action === 'insert') { title = `Operating mode added: ${name}`; details = [mins(next)]; }
      else {
        title = next?.is_active === false && prev?.is_active !== false ? `Operating mode switched off: ${name}` : `Operating mode changed: ${name}`;
        details = changes(prev, next, [['label', 'Name', w]]);
        if (mins(prev) !== mins(next)) details.push(`Minimums: ${mins(prev)} → ${mins(next)}`);
      }
      break;
    }
    case 'operation_periods': {
      const span = range(cur.start_date, cur.end_date);
      const mode = s(cur.mode_code)?.replace(/_/g, ' ') ?? 'mode';
      if (row.action === 'insert') title = `Operating period scheduled: ${mode}, ${span}`;
      else if (next?.status === 'cancelled' && prev?.status !== 'cancelled') { title = `Operating period cancelled: ${mode}, ${span}`; if (s(next.cancel_reason)) details.push(`Reason: ${next.cancel_reason}`); }
      else { title = `Operating period changed: ${mode}, ${span}`; details = changes(prev, next, [['start_date', 'First day', day], ['end_date', 'Last day', day]]); }
      if (row.action === 'insert' && s(cur.note)) details.push(String(cur.note));
      break;
    }
    case 'public_holidays': {
      const what = `${s(cur.name) ?? 'Holiday'}, ${range(cur.start_date, cur.end_date)}${cur.expected ? ' (expected)' : ''}`;
      title = row.action === 'insert' ? `Public holiday added: ${what}` : row.action === 'delete' ? `Public holiday removed: ${what}` : `Public holiday changed: ${what}`;
      if (row.action === 'update') details = changes(prev, next, [['name', 'Name', w], ['start_date', 'First day', day], ['end_date', 'Last day', day], ['expected', 'Expected', (v) => (v ? 'Yes' : 'No')]]);
      break;
    }
    case 'unit_events': {
      const what = `${s(cur.unit) ? `${cur.unit} ` : ''}${s(cur.title) ?? 'Event'}, ${range(cur.start_date, cur.end_date)}`;
      if (row.action === 'insert') title = `Unit event added: ${what}`;
      else if (next?.status === 'cancelled' && prev?.status !== 'cancelled') { title = `Unit event cancelled: ${what}`; if (s(next.cancel_reason)) details.push(`Reason: ${next.cancel_reason}`); }
      else { title = `Unit event changed: ${what}`; details = changes(prev, next, [['title', 'Title', w], ['unit', 'Unit', w], ['category', 'Type', w], ['start_date', 'First day', day], ['end_date', 'Last day', day]]); }
      if (row.action === 'insert' && s(cur.note)) details.push(String(cur.note));
      break;
    }
    case 'employee_qualifications': {
      const q = w(cur.qualification);
      if (row.action === 'insert') title = `${who(empId)}: ${q} = ${w(cur.status)} from ${day(cur.effective_from)}`;
      else if (row.action === 'delete') title = `${who(empId)}: ${q} record removed`;
      else title = next?.effective_to && !prev?.effective_to ? `${who(empId)}: ${q} (${w(cur.status)}) ended ${day(next.effective_to)}` : `${who(empId)}: ${q} changed`;
      if (s(cur.evidence) && row.action === 'insert') details.push(String(cur.evidence));
      break;
    }
    case 'user_accounts': {
      const name = s(next?.display_name) ?? s(prev?.display_name) ?? 'Login';
      const user = s(next?.username) ?? s(prev?.username);
      if (row.action === 'insert') title = `Login created: ${name}${user ? ` (${user})` : ''} · ${w(next?.role_code)}`;
      else if (row.action === 'delete') title = `Login deleted: ${name}${user ? ` (${user})` : ''}`;
      else {
        title = `Login changed: ${name}`;
        details = changes(prev, next, [['display_name', 'Name', w], ['username', 'Username', w], ['role_code', 'Role', w], ['is_active', 'Sign-in', (v) => (v === false ? 'blocked' : 'allowed')],
          ['employee_id', 'Linked staff', (v) => (v ? who(v) : 'none')]]);
        if (next?.password_reset) details.push('Password reset');
      }
      if (row.reason && !/^Account (created|edited|deleted) by Section Head$/.test(row.reason)) details.push(row.reason);
      break;
    }
  }
  const actor = row.actor_id ? lk.actors.get(row.actor_id) ?? 'Unknown login' : 'System';
  return { id: row.id, at: row.occurred_at, category: cat, title, details, employeeId: empId, employeeName: empId ? lk.people.get(empId) ?? null : null, actor, fromImport: row.batch_id !== null };
}
