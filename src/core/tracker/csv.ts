// CSV as exported from Excel / the tracker pack: commas, quoted fields with "" inside, a header row.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); if (row.some((x) => x !== '')) rows.push(row); }
  const [head, ...body] = rows;
  return head ? body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()]))) : [];
}

/** A bar-chart row as the import sends it (Kuwait time written without a zone, as in the P6 export). */
export function barchartRows(rows: Record<string, string>[]) {
  const ts = (v: string) => (v ? `${v.replace(' ', 'T')}${v.length <= 16 ? ':00' : ''}+03:00` : '');
  // a bar-chart line without an activity id (a summary line in the P6 export) keeps its place with a made-up one
  return rows.filter((r) => r.equipment_key).map((r, i) => ({
    activity_id: r.activity_id || `ROW-${i + 1}`, group: r.group ?? '', equipment_key: r.equipment_key, activity: r.activity ?? '', duration_h: r.duration_h ?? '',
    planned_start: ts(r.planned_start ?? ''), planned_finish: ts(r.planned_finish ?? ''), stage: r.stage ?? '', tracked: r.tracked === '0' ? '0' : '1',
  }));
}
