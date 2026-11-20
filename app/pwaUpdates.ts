// Static hosting cannot push a deployment notification into an already-open
// PWA. Ask the browser to check its own registration, without reloading the app.
export const UPDATE_CHECK_INTERVAL_MS = 30_000;
const RESUME_CHECK_DELAY_MS = 100;

export function watchForPwaUpdates(
  registration: ServiceWorkerRegistration,
  onReady: (worker: ServiceWorker) => void,
): () => void {
  let stopped = false;
  let checking = false;
  let reported: ServiceWorker | null = null;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  let stateTimer: ReturnType<typeof setTimeout> | undefined;
  const workers = new Map<ServiceWorker, () => void>();

  const reportWaiting = () => {
    if (stopped) return;
    const worker = registration.waiting;
    // A first installation is not an app update. Only announce a replacement
    // that has finished installing alongside an existing active worker.
    if (registration.active && worker?.state === 'installed' && worker !== reported) {
      reported = worker;
      onReady(worker);
    }
  };
  const trackInstalling = () => {
    const worker = registration.installing;
    if (!worker || workers.has(worker)) return;
    const changed = () => {
      // The registration's waiting pointer can change just after statechange.
      if (stateTimer !== undefined) clearTimeout(stateTimer);
      stateTimer = setTimeout(() => { stateTimer = undefined; reportWaiting(); }, 0);
      if (worker.state === 'activated' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', changed);
        workers.delete(worker);
      }
    };
    workers.set(worker, changed);
    worker.addEventListener('statechange', changed);
  };
  const updateFound = () => { trackInstalling(); reportWaiting(); };
  const check = async () => {
    if (stopped || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    reportWaiting();
    if (checking || registration.installing || !registration.active) return;
    checking = true;
    try {
      // update() revalidates the SW script through the browser's SW update
      // algorithm. Do not fetch/reload the cached application shell instead.
      await registration.update();
    } catch {
      // A temporary network/CDN failure must not break offline operation.
      // The next interval or resume/reconnect event will try again.
    } finally {
      checking = false;
      if (!stopped) { trackInstalling(); reportWaiting(); }
    }
  };
  const resume = () => {
    if (stopped || resumeTimer !== undefined) return;
    resumeTimer = setTimeout(() => { resumeTimer = undefined; void check(); }, RESUME_CHECK_DELAY_MS);
  };

  registration.addEventListener('updatefound', updateFound);
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  trackInstalling();
  reportWaiting();
  void check();
  const interval = setInterval(() => { void check(); }, UPDATE_CHECK_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(interval);
    if (resumeTimer !== undefined) clearTimeout(resumeTimer);
    if (stateTimer !== undefined) clearTimeout(stateTimer);
    registration.removeEventListener('updatefound', updateFound);
    window.removeEventListener('focus', resume);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('online', resume);
    document.removeEventListener('visibilitychange', resume);
    for (const [worker, changed] of workers) worker.removeEventListener('statechange', changed);
    workers.clear();
  };
}

// Only the explicit Update now action may reload. Watching the worker directly
// also handles the first browsing session and updates installed by another tab,
// which Workbox's registration-time isUpdate heuristic can otherwise miss.
export function applyPwaUpdate(
  registration: ServiceWorkerRegistration,
  activate: () => Promise<void>,
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  const worker = registration.waiting;
  if (!worker || worker.state === 'activated') {
    reload(); // Another tab may already have activated the announced update.
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      worker.removeEventListener('statechange', changed);
      if (error) reject(error);
      else { reload(); resolve(); }
    };
    const changed = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('A newer update replaced this one. Please try Update now again.'));
    };
    const timer = setTimeout(() => finish(new Error('The update is taking longer than expected. Please try again when connected.')), 15_000);
    worker.addEventListener('statechange', changed);
    void Promise.resolve().then(activate).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
    changed();
  });
}
