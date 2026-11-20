/// <reference types="vite-plugin-pwa/react" />
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Check, X } from 'lucide-react';
import { applyPwaUpdate, watchForPwaUpdates } from './pwaUpdates';

type ReleaseNotes = { version?: string; notes?: string[] };

export default function UpdateNotice() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [readyWorker, setReadyWorker] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const applyingRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const laterRef = useRef<HTMLButtonElement | null>(null);
  const { updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_url, current) => setRegistration(current || null),
    // A different tab can activate a waiting worker too. Never let that
    // silently reload this tab and erase an unfinished transaction form.
    onNeedReload: () => {},
  });

  useEffect(() => {
    if (!registration) return;
    return watchForPwaUpdates(registration, worker => {
      setReadyWorker(worker);
      setDismissed(false); // Later defers this update, not all future releases.
      setNotes([]);
      setApplyError('');
    });
  }, [registration]);

  useEffect(() => {
    if (!readyWorker) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const url = `${import.meta.env.BASE_URL}whats-new.json?build=${Date.now()}`;
    fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Release notes unavailable');
        return response.json() as Promise<ReleaseNotes>;
      })
      .then(data => {
        const entries = Array.isArray(data.notes) ? data.notes.filter((note): note is string => typeof note === 'string' && Boolean(note.trim())).slice(0, 5) : [];
        if (!cancelled) setNotes(entries.length ? entries : ['General improvements and fixes.']);
      })
      .catch(() => {
        if (!cancelled) setNotes(['General improvements and fixes.']);
      })
      .finally(() => clearTimeout(timeout));
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [readyWorker]);

  useLayoutEffect(() => {
    if (!readyWorker || dismissed) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Default to Later before the next keypress, never to a destructive reload
    // on an accidental Enter. Restore the owner's original field on dismissal.
    laterRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [readyWorker, dismissed]);

  const updateNow = async () => {
    if (!registration || applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true); setApplyError('');
    try { await applyPwaUpdate(registration, () => updateServiceWorker(true)); }
    catch (error) { setApplyError(error instanceof Error ? error.message : 'Could not apply the update. Please try again.'); }
    finally { applyingRef.current = false; setApplying(false); }
  };

  if (!readyWorker || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-[var(--scrim)] p-4 backdrop-blur-md" role="presentation">
      <section
        ref={dialogRef}
        onKeyDownCapture={event => {
          // Pause dashboard/form shortcuts while the update dialog has focus.
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!applying) setDismissed(true);
          } else if (event.key === 'Tab') {
            const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || []);
            const first = buttons[0], last = buttons[buttons.length - 1], active = document.activeElement;
            if (!first) event.preventDefault();
            else if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) { event.preventDefault(); first.focus(); }
          }
        }}
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
            <button type="button" disabled={applying} onClick={() => setDismissed(true)} aria-label="Dismiss update notice" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface2)]">
              <X size={21} />
            </button>
          </div>
          <ul className="mt-5 space-y-3" aria-live="polite">
            {(notes.length ? notes : ['Loading release notes…']).map((note, index) => (
              <li key={`${index}-${note}`} className="flex items-start gap-3 text-sm font-bold leading-relaxed">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--green-soft)] text-[var(--green)]" aria-hidden="true"><Check size={15} strokeWidth={3} /></span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs font-semibold text-[var(--muted)]">Finish and save any open transaction before updating. The app reloads only when you choose Update now.</p>
          {applyError && <p role="alert" className="mt-3 text-sm font-bold text-[var(--red)]">{applyError}</p>}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button ref={laterRef} type="button" disabled={applying} onClick={() => setDismissed(true)} className="min-h-12 rounded-xl border border-[var(--line)] px-5 font-extrabold text-[var(--ink)] hover:bg-[var(--surface2)]">Later</button>
            <button type="button" disabled={applying} onClick={() => void updateNow()} className="min-h-12 rounded-xl bg-[var(--green-solid)] px-6 font-extrabold text-white shadow-sm hover:brightness-95">{applying ? 'Updating…' : 'Update now'}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
