import { useEffect, useState } from 'react';
import { personRow, sickBand, sickRolling, type StatCode, type StatSnapshot, type StatValue } from '@/core/oracleStats';
import { fetchStatCodes, fetchStats } from '@/data/oracleStats';
import type { SickTotal } from '@/data/types';
import { t } from '@/i18n';
import { Chip, ErrorBox, Spinner, fmtDate } from '@/ui/components';
import { localToday } from '@/ui/leave';

/** One person's Oracle absence figures, report by report (with the period each covers), and the rolling-12-month sick check. */
export function PersonStats({ employeeId, sick }: { employeeId: string; sick: SickTotal[] }) {
  const [data, setData] = useState<{ codes: StatCode[]; snapshots: StatSnapshot[]; values: StatValue[] } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { Promise.all([fetchStatCodes(), fetchStats([employeeId])]).then(([codes, s]) => setData({ codes, ...s })).catch(setErr); }, [employeeId]);
  if (err) return <ErrorBox error={err} />;
  if (!data) return <Spinner />;
  const mine = data.snapshots.filter((s) => s.employees.includes(employeeId));
  const roll = sickRolling(employeeId, localToday(), data.snapshots, data.values, data.codes);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-slate-600">{t('Rolling 12 months (sick)')}:</span>
        {roll.days !== null ? <Chip tone={roll.state === 'verified' ? (sickBand(roll.days) === 'eligible' ? 'green' : sickBand(roll.days) === 'warning' ? 'amber' : 'red') : 'amber'}>{roll.days} {t('days')}</Chip> : null}
        <Chip tone={roll.state === 'verified' ? 'green' : roll.state === 'missing' ? 'neutral' : 'amber'}>{t(roll.state === 'verified' ? 'Verified' : roll.state === 'outdated' ? 'Data outdated — Update required' : roll.state === 'missing' ? 'No figure' : 'Verification needed')}</Chip>
      </div>
      <p className="text-[11px] text-slate-500">{roll.reason}</p>
      {mine.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {mine.map((s) => {
            const row = personRow(s, data.values, employeeId);
            return (
              <li key={s.id} className="py-1.5">
                <div className="text-xs text-slate-500">{s.source} · {fmtDate(s.periodStart)} – {fmtDate(s.periodEnd)} · {t('taken')} {fmtDate(s.extractedOn)}</div>
                <div className="mt-0.5 flex flex-wrap gap-1">{s.codes.map((c) => <span key={c} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs"><b className="font-mono">{c}</b> {row[c] ?? '—'}</span>)}</div>
              </li>
            );
          })}
        </ul>
      )}
      {sick.length > 0 && <div>
        <div className="text-xs font-medium text-slate-600">{t('Sick leave per calendar year (promotion list, as reported)')}</div>
        <ul className="text-xs text-slate-700">{sick.map((s) => <li key={s.id}>{s.year}: {s.days} {t('days')} ({t('as of')} {fmtDate(s.reported_as_of)})</li>)}</ul>
      </div>}
      <p className="text-[11px] text-slate-500">{t('These are Oracle figures: they do not change the crews on any day.')}</p>
    </div>
  );
}
