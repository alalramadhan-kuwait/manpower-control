// The Field Operator's level (Experienced, Good, New, Below), changed in one tap where the person is shown: the
// profile and the shutdown team. The shutdown minimum and the planner read it.
import { useState } from 'react';
import type { FoLevel } from '@/core/shutdown';
import { setFoLevel } from '@/data/shutdown';
import { cx } from '@/ui/components';

const LEVELS: [FoLevel, string][] = [['senior', 'Experienced'], ['good', 'Good'], ['new', 'New'], ['below', 'Below']];

export function FoLevelPicker({ employeeId, level, onChanged }: { employeeId: string; level: FoLevel | null; onChanged: (level: FoLevel) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function pick(v: FoLevel) {
    if (v === level) return;
    setBusy(true); setErr(null);
    try { await setFoLevel(employeeId, v); onChanged(v); } catch (e) { setErr(e instanceof Error ? e.message : 'Not saved.'); } finally { setBusy(false); }
  }
  return (
    <div>
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Field Operator level">
        {LEVELS.map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={level === v} disabled={busy} onClick={() => pick(v)}
            className={cx('min-h-9 rounded-lg text-xs font-semibold ring-1 disabled:opacity-60', level === v ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-700 ring-slate-300')}>{label}</button>
        ))}
      </div>
      {err && <p className="mt-1 text-xs text-status-red">{err}</p>}
    </div>
  );
}
