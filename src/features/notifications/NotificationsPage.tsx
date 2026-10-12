import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, ClipboardList, Info, OctagonAlert, RefreshCw, ShieldAlert, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ISSUE_LABEL, issueLevel, type IssueLevel, type Notice } from '@/core/notifications';
import { fetchResolvedIssues, type Issue } from '@/data/issues';
import { NOTICE_HORIZON_DAYS, loadNotices } from '@/data/notifications';
import type { UserProfile } from '@/data/types';
import { t } from '@/i18n';
import { Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';
import { ShiftAlertsCard } from './ShiftAlertsCard';

const LEVELS: { level: IssueLevel; empty?: string }[] = [
  { level: 'critical', empty: 'No staffing gap: every duty in the coming weeks is staffed and covered.' },
  { level: 'warning' },
  { level: 'info' }
];
const ICON = { shortage: AlertTriangle, controller: UserCheck, request: ClipboardList, data: ShieldAlert, leave: CalendarClock, mode: Info };
const TONE: Record<IssueLevel, string> = { critical: 'bg-red-50 text-status-red', warning: 'bg-amber-50 text-status-amber', info: 'bg-brand-50 text-brand-700' };
const MARK: Record<IssueLevel, string> = { critical: '!!', warning: '!', info: 'i' };

/** Notifications: one list of open issues (Critical / Warning / Information) and the history of resolved ones. */
export default function NotificationsPage({ profile }: { profile: UserProfile }) {
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [history, setHistory] = useState<Issue[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback((force = false) => { setBusy(true); loadNotices(profile.role_code === 'section_head', force).then(setNotices).catch(setError).finally(() => setBusy(false)); }, [profile.role_code]);
  useEffect(() => load(true), [load]);
  useEffect(() => { if (tab === 'history' && !history) fetchResolvedIssues().then(setHistory).catch(setError); }, [tab, history]);
  const groups = useMemo(() => LEVELS.map((g) => ({ ...g, items: (notices ?? []).filter((n) => issueLevel(n) === g.level) })), [notices]);

  return (
    <div className="lg:max-w-3xl">
      <PageHeader title="Notifications" info={t('Open issues in the next {n} days: one alert per issue, updated in place, and moved to History once resolved.', { n: NOTICE_HORIZON_DAYS })}
        action={<button type="button" aria-label={t('Refresh')} onClick={() => load(true)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200"><RefreshCw className={cx('h-4 w-4 text-slate-600', busy && 'animate-spin')} /></button>} />
      <div role="tablist" className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        {(['open', 'history'] as const).map((x) => <button key={x} role="tab" aria-selected={tab === x} type="button" onClick={() => setTab(x)} className={cx('min-h-10 rounded-lg font-medium', tab === x ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>{t(x === 'open' ? 'Open' : 'History')}{x === 'open' && notices ? ` (${notices.length})` : ''}</button>)}
      </div>
      {tab === 'open' && <ShiftAlertsCard canEdit={profile.role_code === 'section_head'} />}
      {error ? <ErrorBox error={error} /> : tab === 'history' ? (!history ? <Spinner /> : history.length === 0 ? <Card className="text-sm text-slate-500">{t('Nothing resolved yet.')}</Card> : (
        <Card className="divide-y divide-slate-100 p-0">
          {history.map((h) => (
            <div key={h.key} className="flex items-start gap-3 px-3 py-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-green" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-800">{h.title}</span><span className="block text-xs text-slate-600">{h.detail}</span>
                <span className="block text-[11px] text-slate-400">{t(ISSUE_LABEL[h.level])} · {t('opened')} {h.openedAt.slice(0, 10)} · {t('resolved')} {h.resolvedAt?.slice(0, 10)}</span></span>
            </div>
          ))}
        </Card>
      )) : !notices ? <Spinner /> : (
        <div className="space-y-4">
          {groups.map((g) => (g.items.length > 0 || g.empty) && (
            <section key={g.level}>
              <h2 className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {g.level === 'critical' && <OctagonAlert className="h-3.5 w-3.5 text-status-red" />}{t(ISSUE_LABEL[g.level])} ({g.items.length})
              </h2>
              {g.items.length === 0 ? <Card className="text-sm text-slate-500">{t(g.empty!)}</Card> : (
                <Card className="divide-y divide-slate-100 p-0">
                  {g.items.map((n) => {
                    const Icon = ICON[n.area];
                    return (
                      <Link key={n.id} to={n.to} className="flex min-h-14 items-start gap-3 px-3 py-2.5 active:bg-slate-50">
                        <span className={cx('relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE[g.level])}><Icon className="h-4 w-4" /><span className="sr-only">{t(ISSUE_LABEL[g.level])}</span><span aria-hidden className="absolute -end-1 -top-1 rounded bg-white px-0.5 text-[9px] font-bold leading-none">{MARK[g.level]}</span></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-900">{n.title}</span>
                          <span className="block text-xs text-slate-600">{n.detail}</span>
                        </span>
                        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-400 rtl:rotate-180" />
                      </Link>
                    );
                  })}
                </Card>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
