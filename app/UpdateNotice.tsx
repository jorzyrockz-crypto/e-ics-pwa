/// <reference types="vite-plugin-pwa/react" />
import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Check, X } from 'lucide-react';

const whatsNew = [
  'Touch-friendly tablet controls for faster counter service.',
  'Regular Load and Promo / Bundle tracking, with suggested Globe, Smart, TNT, and DITO offers.',
  'Improved app update prompts and sharing details.',
];

export default function UpdateNotice() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const [dismissed, setDismissed] = useState(false);

  if (!needRefresh || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-md" role="presentation">
      <section
        className="my-auto w-full max-w-xl overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface)] shadow-[0_24px_80px_rgba(0,0,0,.32)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
        aria-describedby="app-update-description"
      >
        <img
          src={`${import.meta.env.BASE_URL}eload-tracker-share.png`}
          alt="E-LOAD Tracker — Loads, Cash, Tracking"
          className="block aspect-[1.91/1] w-full object-cover"
        />
        <div className="p-5 sm:p-7">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black uppercase tracking-[.14em] text-[var(--green)]">A new version is ready</p>
              <h2 id="app-update-title" className="mt-1 font-display text-2xl font-extrabold">What’s new</h2>
              <p id="app-update-description" className="mt-1 text-sm font-semibold text-[var(--muted)]">Update E-LOAD Tracker to get these improvements.</p>
            </div>
            <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss update notice" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface2)]">
              <X size={21} />
            </button>
          </div>
          <ul className="mt-5 space-y-3">
            {whatsNew.map(note => (
              <li key={note} className="flex items-start gap-3 text-sm font-bold leading-relaxed">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--green-soft)] text-[var(--green)]" aria-hidden="true"><Check size={15} strokeWidth={3} /></span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setDismissed(true)} className="min-h-12 rounded-xl border border-[var(--line)] px-5 font-extrabold text-[var(--ink)] hover:bg-[var(--surface2)]">Later</button>
            <button type="button" onClick={() => updateServiceWorker(true)} className="min-h-12 rounded-xl bg-[var(--green)] px-6 font-extrabold text-white shadow-sm hover:brightness-95">Update now</button>
          </div>
        </div>
      </section>
    </div>
  );
}
