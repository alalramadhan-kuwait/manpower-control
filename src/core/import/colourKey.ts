// The monthly sheets' colour key (identical on every month sheet) mapped to absence types.
// SheetJS reads plain RGB and theme+tint fills; the key's indexed colours (Re schedule leave, un schedule leave
// aproved, hajj leave) come back empty and are treated as unknown.

export interface ColourMeaning { label: string; type: string | null; absence: boolean }

const KEY: Record<string, ColourMeaning> = {
  'rgb:00B050': { label: 'schedule leave', type: 'annual_leave_planned', absence: true },
  'rgb:FF0000': { label: 'schedule leave aproved', type: 'annual_leave_planned', absence: true },
  'rgb:7030A0': { label: 'Re schedule leave aproved', type: 'annual_leave_rescheduled', absence: true },
  'rgb:00B0F0': { label: 'SPECIAL LEAVE', type: 'special_leave', absence: true },
  'rgb:0000FF': { label: 'long sick', type: 'long_sick', absence: true },
  'theme:2:-0.5': { label: 'COURSE', type: 'course', absence: true },
  'rgb:FFC000': { label: 'long cours', type: 'long_course', absence: true },
  'rgb:FF66FF': { label: 'leave booking (حجز اجازة)', type: 'annual_leave_planned', absence: true },
  'theme:9:0.6': { label: 'go to other shift / off', type: null, absence: false }
};

/** Normalises a SheetJS fill into the key used above: "rgb:RRGGBB" or "theme:N:tint" (tint to 2 decimals). */
export function fillKey(fg: { rgb?: string; theme?: number; tint?: number } | undefined | null): string | null {
  if (!fg) return null;
  if (fg.theme !== undefined) return `theme:${fg.theme}${fg.tint ? `:${Math.round(fg.tint * 100) / 100}` : ''}`;
  if (fg.rgb) return `rgb:${fg.rgb.slice(-6).toUpperCase()}`;
  return null;
}

export function colourMeaning(key: string | null): ColourMeaning | null {
  return key ? KEY[key] ?? null : null;
}

/** The colour most of the given days carry (null when none is readable). */
export function majorityFill(fills: (string | null)[]): string | null {
  const n = new Map<string, number>();
  for (const f of fills) if (f) n.set(f, (n.get(f) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
