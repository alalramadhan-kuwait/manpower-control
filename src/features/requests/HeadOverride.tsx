// The Section Head going below a crew minimum (owner, 22 Nov 2026: "I am section head, I should be able to approve
// anything"). Shown only to the Section Head, only when the server check blocks a change because a crew falls below its
// minimum (never for a hard stop). A reason is required; the server checks the role again, keeps the reason with the
// check and the request, and the crew stays short (a critical alert) until it is covered.
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/i18n';
import { Button, Field } from '@/ui/components';

export const OVERRIDE_MIN = 3;

export function HeadOverride({ action, busy, onConfirm }: { /** what the button does: "Record", "Approve", "Save" */ action: string; busy: boolean; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  const ok = reason.trim().length >= OVERRIDE_MIN;
  return (
    <div className="space-y-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-300">
      <p className="flex items-start gap-2 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t('As Section Head you can still go ahead. The crew stays short and shows as a critical alert until it is covered.')}</span>
      </p>
      <Field label="Reason (kept with the record)">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. Cover arranged, to be entered later')} />
      </Field>
      <Button variant="danger" className="min-h-12 w-full" disabled={busy || !ok} onClick={() => onConfirm(reason.trim())}>
        {busy ? t('Saving…') : `${t(action)} · ${t('below the minimum')}`}
      </Button>
    </div>
  );
}
