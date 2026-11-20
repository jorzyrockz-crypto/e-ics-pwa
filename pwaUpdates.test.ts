// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPwaUpdate, UPDATE_CHECK_INTERVAL_MS, watchForPwaUpdates } from './app/pwaUpdates';

class Worker extends EventTarget {
  state: ServiceWorkerState;
  constructor(state: ServiceWorkerState = 'installed') { super(); this.state = state; }
  change(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}
class Registration extends EventTarget {
  active: Worker | null = new Worker('activated');
  waiting: Worker | null = null;
  installing: Worker | null = null;
  update = vi.fn(async () => this);
  get native() { return this as unknown as ServiceWorkerRegistration; }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('checking deployed PWA updates without a page refresh', () => {
  it('checks immediately and every 30 seconds while the app stays open', async () => {
    const registration = new Registration(), ready = vi.fn();
    const stop = watchForPwaUpdates(registration.native, ready);
    expect(registration.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 1);
    expect(registration.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(registration.update).toHaveBeenCalledTimes(2);
    expect(ready).not.toHaveBeenCalled();
    stop();
  });

  it('coalesces focus, resume, and visibility events into one immediate check', async () => {
    const registration = new Registration();
    const stop = watchForPwaUpdates(registration.native, vi.fn());
    await Promise.resolve();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(100);
    expect(registration.update).toHaveBeenCalledTimes(2);
    stop();
  });

  it('pauses checks offline and checks on reconnect without waiting for the interval', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const registration = new Registration();
    const stop = watchForPwaUpdates(registration.native, vi.fn());
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(registration.update).not.toHaveBeenCalled();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(100);
    expect(registration.update).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not poll hidden/background tabs and checks when the owner returns', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const registration = new Registration();
    const stop = watchForPwaUpdates(registration.native, vi.fn());
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(registration.update).not.toHaveBeenCalled();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(100);
    expect(registration.update).toHaveBeenCalledTimes(1);
    stop();
  });

  it('never overlaps slow update requests and ignores their results after cleanup', async () => {
    const registration = new Registration(), ready = vi.fn();
    let release!: () => void;
    registration.update.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(registration); }));
    const stop = watchForPwaUpdates(registration.native, ready);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(registration.update).toHaveBeenCalledTimes(1);
    stop();
    registration.waiting = new Worker(); release(); await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
  });

  it('quietly retries a failed network/CDN check on the next interval', async () => {
    const registration = new Registration(); registration.update.mockRejectedValueOnce(new Error('Network unavailable'));
    const stop = watchForPwaUpdates(registration.native, vi.fn());
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(registration.update).toHaveBeenCalledTimes(2);
    stop();
  });

  it('announces a ready worker after installation, not merely when downloading starts', async () => {
    const registration = new Registration(), ready = vi.fn();
    const stop = watchForPwaUpdates(registration.native, ready);
    const worker = new Worker('installing');
    registration.installing = worker; registration.dispatchEvent(new Event('updatefound'));
    expect(ready).not.toHaveBeenCalled();
    registration.waiting = worker; registration.installing = null; worker.change('installed');
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toHaveBeenCalledTimes(1); expect(ready).toHaveBeenCalledWith(worker);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(ready).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not mistake first installation for a new release', async () => {
    const registration = new Registration(), ready = vi.fn(), first = new Worker('installing');
    registration.active = null; registration.installing = first;
    const stop = watchForPwaUpdates(registration.native, ready);
    expect(registration.update).not.toHaveBeenCalled();
    registration.waiting = first; first.change('installed'); await vi.advanceTimersByTimeAsync(0);
    expect(ready).not.toHaveBeenCalled();
    registration.waiting = null; registration.installing = null; registration.active = first; first.change('activated');
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(ready).not.toHaveBeenCalled();
    expect(registration.update).toHaveBeenCalledTimes(1);
    stop();
  });

  it('announces an already-waiting update and a later replacement once each', async () => {
    const registration = new Registration(), ready = vi.fn(), first = new Worker(), second = new Worker('installing');
    registration.waiting = first;
    const stop = watchForPwaUpdates(registration.native, ready);
    expect(ready).toHaveBeenCalledTimes(1); expect(ready).toHaveBeenCalledWith(first);
    registration.installing = second; registration.dispatchEvent(new Event('updatefound'));
    registration.installing = null; registration.waiting = second; first.change('redundant'); second.change('installed');
    await vi.advanceTimersByTimeAsync(0);
    expect(ready.mock.calls.map(([worker]) => worker)).toEqual([first, second]);
    stop();
  });

  it('removes timers, browser events, and worker listeners on cleanup', async () => {
    const registration = new Registration(), ready = vi.fn(), worker = new Worker('installing');
    registration.installing = worker;
    const stop = watchForPwaUpdates(registration.native, ready);
    window.dispatchEvent(new Event('focus')); stop();
    registration.installing = null; registration.waiting = worker; worker.change('installed');
    registration.dispatchEvent(new Event('updatefound')); window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
    expect(ready).not.toHaveBeenCalled(); expect(registration.update).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('applying an update only after explicit owner consent', () => {
  it('waits for activation before reloading, exactly once', async () => {
    const registration = new Registration(), worker = new Worker(), activate = vi.fn(async () => {}), reload = vi.fn();
    registration.waiting = worker;
    const applied = applyPwaUpdate(registration.native, activate, reload);
    await Promise.resolve();
    expect(activate).toHaveBeenCalledTimes(1); expect(reload).not.toHaveBeenCalled();
    worker.change('activating'); expect(reload).not.toHaveBeenCalled();
    worker.change('activated'); await applied; worker.change('activated');
    expect(reload).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('reloads explicitly when another tab already activated the announced update', async () => {
    const registration = new Registration(), activate = vi.fn(), reload = vi.fn();
    await applyPwaUpdate(registration.native, activate, reload);
    expect(reload).toHaveBeenCalledTimes(1); expect(activate).not.toHaveBeenCalled();
  });

  it('allows a failed activation request to be retried without an automatic reload', async () => {
    const registration = new Registration(), worker = new Worker(), reload = vi.fn(); registration.waiting = worker;
    await expect(applyPwaUpdate(registration.native, async () => { throw new Error('Try again online'); }, reload)).rejects.toThrow('Try again online');
    worker.change('activated'); expect(reload).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('stops waiting on timeout instead of leaving Update now stuck indefinitely', async () => {
    const registration = new Registration(), worker = new Worker(), reload = vi.fn(); registration.waiting = worker;
    const applied = applyPwaUpdate(registration.native, async () => {}, reload);
    const failure = expect(applied).rejects.toThrow('taking longer than expected');
    await vi.advanceTimersByTimeAsync(15_000); await failure;
    worker.change('activated'); expect(reload).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reload if a still-newer worker supersedes the requested one', async () => {
    const registration = new Registration(), worker = new Worker(), reload = vi.fn(); registration.waiting = worker;
    const applied = applyPwaUpdate(registration.native, async () => {}, reload);
    const failure = expect(applied).rejects.toThrow('newer update replaced');
    worker.change('redundant'); await failure;
    expect(reload).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
