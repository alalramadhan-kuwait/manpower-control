// A workspace: one entry in More (or one bottom tab) with its own tabs, kept in the address (?tab=) so a link or the
// back button returns to the same tab. Pages shown inside a workspace render their own title as a section heading.
import { createContext, useContext, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { t } from '@/i18n';
import { cx } from './components';

export const InWorkspace = createContext(false);
export const useInWorkspace = () => useContext(InWorkspace);

export interface WorkspaceTab { key: string; label: string; el: ReactNode; badge?: number; hidden?: boolean }

export function Workspace({ title, tabs, param = 'tab', subtitle }: { title: string; tabs: WorkspaceTab[]; param?: string; subtitle?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const shown = tabs.filter((x) => !x.hidden);
  const active = shown.find((x) => x.key === params.get(param)) ?? shown[0];
  return (
    <div>
      <h1 className="text-xl font-semibold text-brand-800">{t(title)}</h1>
      {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
      <div role="tablist" className="no-scrollbar mb-4 mt-2 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 text-sm lg:max-w-3xl">
        {shown.map((x) => (
          <button key={x.key} role="tab" type="button" aria-selected={active.key === x.key}
            onClick={() => { const n = new URLSearchParams(params); n.set(param, x.key); for (const k of [...n.keys()]) if (k !== param && k !== 'tab') n.delete(k); setParams(n, { replace: true }); }}
            className={cx('min-h-10 flex-1 whitespace-nowrap rounded-lg px-3 font-medium', active.key === x.key ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600')}>
            {t(x.label)}{x.badge ? <span className="ms-1.5 rounded-full bg-brand-700 px-1.5 text-[11px] font-bold text-white">{x.badge}</span> : null}
          </button>
        ))}
      </div>
      <InWorkspace.Provider value>{active.el}</InWorkspace.Provider>
    </div>
  );
}
