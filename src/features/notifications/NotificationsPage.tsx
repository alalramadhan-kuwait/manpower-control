import { AlertTriangle, CalendarClock, ChevronRight, ClipboardList, Eye, Info, RefreshCw, ShieldAlert, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Notice, NoticeLevel } from '@/core/notifications';
import { NOTICE_HORIZON_DAYS, loadNotices } from '@/data/notifications';
import type { UserProfile } from '@/data/types';
import { Card, ErrorBox, PageHeader, Spinner, cx } from '@/ui/components';

const GROUPS: { level: NoticeLevel; title: string; empty?: string }[] = [
  { level: 'action', title: 'Needs action', empty: 'Nothing needs action. Every duty in the coming weeks is staffed and covered.' },
  { level: 'watch', title: 'Keep an eye on' },
  { level: 'info', title: 'Good to know' }
];
const ICON = { shortage: AlertTriangle, controller: UserCheck, request: ClipboardList, data: ShieldAlert, leave: CalendarClock, mode: Info };
const TONE: Record<NoticeLevel, string> = { action: 'bg-red-50 text-status-red', watch: 'bg-amber-50 text-status-amber', info: 'bg-brand-50 text-brand-700' };

/** Notification Center: everything that needs attention in the next weeks, in one list. Items clear themselves once resolved. */
export default function NotificationsPage({ profile }: { profile: UserProfile }) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback((force = false) => { setBusy(true); loadNotices(profile.role_code === 'section_head', force).then(setNotices).catch(setError).finally(() => setBusy(false)); }, [profile.role_code]);
  useEffect(() => load(true), [load]);
  const groups = useMemo(() => GROUPS.map((g) => ({ ...g, items: (notices ?? []).filter((n) => n.level === g.level) })), [notices]);

  return (
    <div>
      <PageHeader title="Notifications" info={`What needs attention in the next ${NOTICE_HORIZON_DAYS} days. Items clear themselves once resolved; tap one to fix it.`}
        action={<button type="button" aria-label="Refresh" onClick={() => load(true)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200"><RefreshCw className={cx('h-4 w-4 text-slate-600', busy && 'animate-spin')} /></button>} />
      {error ? <ErrorBox error={error} /> : !notices ? <Spinner /> : (
        <div className="space-y-4">
          {groups.map((g) => (g.items.length || g.empty) && (
            <section key={g.level}>
              <h2 className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {g.level === 'watch' ? <Eye className="h-3.5 w-3.5" /> : null}{g.title} ({g.items.length})
              </h2>
              {g.items.length === 0 ? <Card className="text-sm text-slate-500">{g.empty}</Card> : (
                <Card className="divide-y divide-slate-100 p-0">
                  {g.items.map((n) => {
                    const Icon = ICON[n.area];
                    return (
                      <Link key={n.id} to={n.to} className="flex items-start gap-3 px-3 py-2.5 active:bg-slate-50">
                        <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE[n.level])}><Icon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-900">{n.title}</span>
                          <span className="block text-xs text-slate-600">{n.detail}</span>
                        </span>
                        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-slate-400" />
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
