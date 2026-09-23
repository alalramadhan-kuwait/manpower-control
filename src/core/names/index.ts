/**
 * Employee naming rule shared by the app and the import planner.
 *
 * official_name  – the full name exactly as the KNPC Promotion Master lists it (never shortened).
 * display_name   – what screens show: for a KNPC employee confirmed against the master, the first and
 *                  last word of the official name in title case ("AHMAD ALI SAMPLE HASSAN" → "Ahmad Hassan");
 *                  for everyone else (contractors, unconfirmed) the workbook short name.
 * Employee number stays the matching key everywhere.
 */
export interface NameSource {
  officialName: string | null | undefined;
  shortName: string | null | undefined;
  employmentType: 'knpc' | 'contractor';
  employmentTypeSource: 'inferred' | 'confirmed';
}

function titleWord(w: string): string {
  return w.split('-').map((p) => (p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p)).join('-');
}

/** First and last word of a full name, title-cased. A single word is returned as is (title-cased). */
export function firstAndLast(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return titleWord(parts[0]);
  return `${titleWord(parts[0])} ${titleWord(parts[parts.length - 1])}`;
}

export function displayNameFor(src: NameSource): string {
  const official = (src.officialName ?? '').trim();
  const short = (src.shortName ?? '').trim();
  if (src.employmentType === 'knpc' && src.employmentTypeSource === 'confirmed' && official) return firstAndLast(official);
  return short || official || '';
}
