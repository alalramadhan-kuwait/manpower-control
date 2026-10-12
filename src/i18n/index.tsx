// English / Arabic for the screens. English text is the key: t('Today') gives "اليوم" in Arabic, and any text not in
// the dictionary stays in English (names, codes and numbers are never translated). Arabic switches the whole page to
// right-to-left. Printed documents and Excel exports keep their own (English) templates: they never call t().
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AR } from './ar';

export type Lang = 'en' | 'ar';
const KEY = 'ards.lang';
const read = (): Lang => { try { return localStorage.getItem(KEY) === 'ar' ? 'ar' : 'en'; } catch { return 'en'; } };
let current: Lang = typeof window === 'undefined' ? 'en' : read();

/** The text in the current language (English when there is no translation). `{name}` placeholders are filled from vars. */
export function t(text: string, vars?: Record<string, string | number>): string {
  let s = current === 'ar' ? AR[text] ?? text : text;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
export const lang = () => current;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => {} });

function apply(l: Lang) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
}

/** Holds the language; the app below re-renders on a switch (keyed), so every t() call reads the new one. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [l, setL] = useState<Lang>(current);
  useEffect(() => apply(l), [l]);
  const setLang = (n: Lang) => { current = n; try { localStorage.setItem(KEY, n); } catch { /* private window */ } setL(n); };
  return <Ctx.Provider value={{ lang: l, setLang }}><div key={l} className="contents">{children}</div></Ctx.Provider>;
}
export const useLang = () => useContext(Ctx);

/** English / عربي switch. */
export function LangSwitch({ className }: { className?: string }) {
  const { lang: l, setLang } = useLang();
  return (
    <div role="group" aria-label="Language" className={`inline-flex rounded-xl bg-slate-100 p-1 text-sm ${className ?? ''}`}>
      {(['en', 'ar'] as const).map((x) => (
        <button key={x} type="button" onClick={() => setLang(x)} aria-pressed={l === x}
          className={`min-h-9 rounded-lg px-3 font-medium ${l === x ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600'}`}>{x === 'en' ? 'English' : 'عربي'}</button>
      ))}
    </div>
  );
}
