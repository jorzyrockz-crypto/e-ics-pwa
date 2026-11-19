/// <reference types="vite-plugin-pwa/react" />
import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export default function UpdateNotice() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const [dismissed, setDismissed] = useState(false);

  if (!needRefresh || dismissed) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex justify-center px-3 pb-[calc(var(--safe-area-inset-bottom)+12px)]" role="status" aria-live="polite">
      <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_12px_36px_rgba(0,0,0,.2)]">
        <img src="/eload-tracker-share.png" alt="E-LOAD Tracker — Loads, Cash, Tracking" className="block max-h-40 w-full object-cover" />
        <div className="flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="font-extrabold">App update available</p>
            <p className="text-sm font-semibold text-[var(--muted)]">Refresh to get the latest version.</p>
          </div>
          <button type="button" onClick={() => updateServiceWorker(true)} className="min-h-10 shrink-0 rounded-xl bg-[var(--green)] px-4 text-sm font-extrabold text-white">Update</button>
          <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss update notice" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl font-bold text-[var(--muted)] hover:bg-[var(--surface2)]">×</button>
        </div>
      </section>
    </div>
  );
}
