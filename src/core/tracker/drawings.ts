// Loop diagrams: verified drawing excerpts attached to a neutralization loop and its equipment. Reference only: a
// drawing never stands for an isolation, line-up or chemical-work authorization. Nothing is drawn by the app; when
// no verified drawing is attached the loop says so.
export interface TrkDrawing {
  id: string; trackerId: string; pointId: string | null; items: string[];
  sheet: string; rev: string; source: string; title: string | null; path: string; mime: string; note: string | null;
  status: 'current' | 'superseded' | 'withdrawn';
  uploadedBy: string | null; uploadedAt: string; closedAt: string | null; closedBy: string | null; closedReason: string | null;
}

export const DRAWING_SOURCES = ['Approved P&ID', 'Approved isometric', 'Approved vendor drawing', 'Approved marked-up excerpt'] as const;
export const DRAWING_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export const DRAWING_MAX_MB = 15;
export const REFERENCE_NOTE = 'Reference only — not an authorization for isolation, line-up or chemical work.';

const norm = (t: string) => t.trim().toUpperCase().replace(/^([A-Z]{1,3})-(\d)/, '$1-12-$2').replace(/-12-12-/, '-12-');

/** The drawings for one loop: its own (current), equipment drawings of its items that are not tied to a loop, and
 *  the earlier revisions (superseded or withdrawn) of its own drawings, newest first. */
export function loopDrawings(all: TrkDrawing[], loop: { id: string; items: string[] }) {
  const items = new Set(loop.items.map(norm));
  const newest = (a: TrkDrawing, b: TrkDrawing) => b.uploadedAt.localeCompare(a.uploadedAt);
  const own = all.filter((d) => d.pointId === loop.id);
  return {
    current: own.filter((d) => d.status === 'current').sort(newest),
    equipment: all.filter((d) => d.pointId === null && d.status === 'current' && d.items.some((t) => items.has(norm(t)))).sort(newest),
    history: own.filter((d) => d.status !== 'current').sort(newest),
  };
}

/** What a new upload needs before it is sent; the first problem, or null. */
export function drawingProblem(v: { sheet: string; rev: string; source: string; type: string; sizeBytes: number }): string | null {
  if (!v.sheet.trim()) return 'Give the drawing / P&ID sheet number.';
  if (!v.rev.trim()) return 'Give the drawing revision.';
  if (!v.source.trim()) return 'Say which approved source it comes from.';
  if (!(DRAWING_TYPES as readonly string[]).includes(v.type)) return 'Use a PNG, JPG, WEBP or PDF file.';
  if (v.sizeBytes > DRAWING_MAX_MB * 1024 * 1024) return `The file is larger than ${DRAWING_MAX_MB} MB.`;
  return null;
}

export const isPdf = (d: Pick<TrkDrawing, 'mime'>) => d.mime === 'application/pdf';
export const drawingLabel = (d: Pick<TrkDrawing, 'sheet' | 'rev'>) => `${d.sheet} · Rev ${d.rev}`;
