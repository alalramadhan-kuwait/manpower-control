// No connection: a bar on every screen. Saving is refused while it shows (src/data/busy.ts); what is on screen is
// the last data loaded.
import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [off, setOff] = useState(typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOff(false), out = () => setOff(true);
    window.addEventListener('online', on); window.addEventListener('offline', out);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', out); };
  }, []);
  if (!off) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[100] bg-status-red px-3 py-1.5 text-center text-[13px] font-bold text-white shadow print:hidden" style={{ paddingTop: 'max(6px, env(safe-area-inset-top))' }}>
      No connection · saving is off · showing the last data loaded
    </div>
  );
}
