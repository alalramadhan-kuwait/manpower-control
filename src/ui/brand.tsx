// ARDS Operations brand: the U12 mark, the wordmark lockup and the loading screen.
// The mark is a vector file (public/brand/mark.svg); its lettering is outlined so it looks the same everywhere.
// Rule: the mark's red, green and blue live only in the artwork. Interface colour is navy (brand-700).
import { Lock } from 'lucide-react';
import { cx } from './components';

const markUrl = `${import.meta.env.BASE_URL}brand/mark.svg`;

/** The U12 mark in full colour, for light backgrounds. */
export function BrandMark({ className }: { className?: string }) {
  return <img src={markUrl} alt="U12" draggable={false} className={cx('select-none', className)} />;
}

/** The mark on a white rounded tile: how the logo sits on navy (the app header) so its navy parts stay visible. */
export function BrandTile({ className }: { className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-black/5', className)}>
      <BrandMark className="h-full w-full" />
    </span>
  );
}

/** Mark + "ARDS Operations" wordmark + "Area 4 · Unit 12". `stacked` centres it (login, loading); inline sits it in a row. */
export function BrandLockup({ stacked, product, className }: { stacked?: boolean; product?: string; className?: string }) {
  return (
    <div className={cx(stacked ? 'flex flex-col items-center text-center' : 'flex items-center gap-3', className)}>
      <BrandMark className={stacked ? 'mb-4 h-24 w-24' : 'h-12 w-12'} />
      <div>
        <div className={cx('font-display font-extrabold leading-none tracking-tight text-brand-700', stacked ? 'text-[1.75rem]' : 'text-xl')}>
          ARDS <span className="text-logo-blue">Operations</span>
        </div>
        <div className={cx('font-display font-semibold uppercase tracking-[0.18em] text-slate-500', stacked ? 'mt-2 text-xs' : 'mt-1 text-[10px]')}>Area 4 · Unit 12</div>
        {product && <div className={cx('font-medium text-slate-600', stacked ? 'mt-3 text-sm' : 'mt-0.5 text-xs')}>{product}</div>}
      </div>
    </div>
  );
}

/** Faint refinery line drawing for the bottom of full-screen brand pages (decorative). */
export function Skyline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 120" preserveAspectRatio="xMidYMax slice" aria-hidden className={cx('pointer-events-none', className)}
      fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
      {/* ground and pipe rack */}
      <path d="M0 116h400M0 104h400M20 104v12M60 104v12M100 104v12M300 104v12M340 104v12M380 104v12" />
      {/* left: tall column with platforms and ladder */}
      <path d="M38 104V30a8 8 0 0 1 16 0v74M34 48h24M34 70h24M34 90h24M56 34v70M54 22v-8h-4v8" />
      {/* left: second column and tank */}
      <path d="M70 104V58a6 6 0 0 1 12 0v46M67 74h18M92 104V82q14-8 28 0v22M92 90h28" />
      {/* centre: low stacks */}
      <path d="M150 104V76h10v28M166 104V66a5 5 0 0 1 10 0v38M182 104V84h8v20M198 104V72a4 4 0 0 1 8 0v32" />
      {/* right: tank and columns */}
      <path d="M232 104V80q16-9 32 0v24M232 90h32M280 104V44a7 7 0 0 1 14 0v60M276 60h22M276 80h22M298 48v56" />
      <path d="M318 104V24a9 9 0 0 1 18 0v80M314 40h26M314 62h26M314 84h26M340 28v76M327 15V8" />
      <path d="M354 104V64a6 6 0 0 1 12 0v40M351 78h18M376 104V86h14v18" />
    </svg>
  );
}

/** Full-screen brand background: soft canvas, faint sweep in the mark's colours top right, skyline at the bottom. */
export function BrandBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-full flex-col overflow-hidden bg-gradient-to-b from-white to-canvas">
      {/* three sweeps in the mark's colours, entering from the top edge and leaving by the right edge */}
      <svg viewBox="0 0 200 200" aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-80 w-80 opacity-[0.09]" fill="none" strokeLinecap="butt">
        <path d="M70 -10C88 70 140 120 215 140" stroke="#e11d2a" strokeWidth="16" />
        <path d="M104 -10C118 52 158 92 215 106" stroke="#12944a" strokeWidth="14" />
        <path d="M138 -10C148 34 176 62 215 72" stroke="#1d5bbf" strokeWidth="12" />
      </svg>
      <Skyline className="pointer-events-none absolute inset-x-0 bottom-10 h-40 w-full text-brand-200/70" />
      <div className="relative flex flex-1 flex-col">{children}</div>
      <footer className="relative flex items-center justify-center gap-3 px-6 pb-6 pt-2 safe-bottom">
        <span className="h-px flex-1 max-w-24 bg-slate-300" />
        <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.12em] text-slate-500"><Lock className="h-3 w-3" /> KNPC · Mina Abdullah Refinery</span>
        <span className="h-px flex-1 max-w-24 bg-slate-300" />
      </footer>
    </div>
  );
}

/** Loading screen: shown while the app starts and checks the sign-in. */
export function SplashScreen({ message = 'Loading operational data…' }: { message?: string }) {
  return (
    <BrandBackdrop>
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24" role="status" aria-live="polite">
        <BrandLockup stacked />
        <span className="mt-10 h-9 w-9 animate-spin rounded-full border-[3px] border-slate-200 border-t-brand-600" aria-hidden />
        <p className="mt-4 text-sm text-slate-500">{message}</p>
      </div>
    </BrandBackdrop>
  );
}
