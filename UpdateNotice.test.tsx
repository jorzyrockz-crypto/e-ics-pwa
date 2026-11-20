// @vitest-environment happy-dom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegisterSWOptions } from 'virtual:pwa-register/react';

const pwa = vi.hoisted(() => ({
  registration: undefined as ServiceWorkerRegistration | undefined,
  options: undefined as RegisterSWOptions | undefined,
  updateServiceWorker: vi.fn(), reload: vi.fn(), fetch: vi.fn(),
}));
vi.mock('virtual:pwa-register/react', async () => {
  const { useEffect } = await import('react');
  return {
    useRegisterSW: (options: RegisterSWOptions) => {
      pwa.options = options;
      useEffect(() => { options.onRegisteredSW?.('/e-ics-pwa/sw.js', pwa.registration); }, []);
      return { needRefresh: [false, vi.fn()], offlineReady: [false, vi.fn()], updateServiceWorker: pwa.updateServiceWorker };
    },
  };
});
import UpdateNotice from './app/UpdateNotice';
import { UPDATE_CHECK_INTERVAL_MS } from './app/pwaUpdates';

class Worker extends EventTarget {
  state: ServiceWorkerState = 'installed';
  change(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}
class Registration extends EventTarget {
  active = new Worker();
  waiting: Worker | null = null;
  installing: Worker | null = null;
  update = vi.fn(async () => this);
  get native() { return this as unknown as ServiceWorkerRegistration; }
}
let registration: Registration;
async function announce(worker = new Worker()) {
  await act(async () => {
    registration.waiting = worker; registration.dispatchEvent(new Event('updatefound'));
  });
  return worker;
}

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(window.location, 'reload').mockImplementation(pwa.reload);
  pwa.fetch.mockResolvedValue({ ok: true, json: async () => ({ version: 'release-b', notes: ['An improvement deployed while the app stayed open.'] }) });
  vi.stubGlobal('fetch', pwa.fetch);
  registration = new Registration(); pwa.registration = registration.native;
  pwa.updateServiceWorker.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.style.overflow = ''; });

describe('update notice while the existing app remains open', () => {
  it('shows the banner after a background check even when the plugin needRefresh flag stays false', async () => {
    const view = render(<UpdateNotice />);
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    registration.update.mockImplementationOnce(async () => {
      registration.waiting = new Worker(); registration.dispatchEvent(new Event('updatefound')); return registration;
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS); });
    expect(within(view.container).getByRole('dialog').textContent).toContain('An improvement deployed while the app stayed open.');
    expect(pwa.fetch).toHaveBeenCalledWith(expect.stringMatching(/whats-new\.json\?build=/), expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
    expect(pwa.reload).not.toHaveBeenCalled(); expect(pwa.updateServiceWorker).not.toHaveBeenCalled();
  });

  it('recognizes an already-waiting update without an extra refresh', async () => {
    registration.waiting = new Worker();
    const view = render(<StrictMode><UpdateNotice /></StrictMode>);
    await act(async () => {});
    expect(within(view.container).getByRole('dialog')).not.toBeNull();
    expect(pwa.reload).not.toHaveBeenCalled();
  });

  it('does not re-prompt the same dismissed version but does show the next deployment', async () => {
    const view = render(<UpdateNotice />); await announce();
    fireEvent.click(within(view.container).getByRole('button', { name: 'Later' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS); });
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    pwa.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ version: 'release-c', notes: ['A newer deployment is ready.'] }) });
    await announce();
    expect(within(view.container).getByRole('dialog').textContent).toContain('A newer deployment is ready.');
    expect(pwa.reload).not.toHaveBeenCalled();
  });

  it('does not let update-dialog keys submit an underlying transaction form, and restores the original input after Later', async () => {
    const shortcuts = vi.fn(); window.addEventListener('keydown', shortcuts);
    try {
      const view = render(<><input aria-label="Unfinished sale" defaultValue="Private draft" /><UpdateNotice /></>);
      const input = within(view.container).getByLabelText('Unfinished sale'); input.focus();
      await announce();
      const later = within(view.container).getByRole('button', { name: 'Later' });
      expect(document.activeElement).toBe(later);
      fireEvent.keyDown(later, { key: 'Enter' }); expect(shortcuts).not.toHaveBeenCalled();
      fireEvent.keyDown(later, { key: 'Escape' });
      expect(within(view.container).queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(input);
      expect((input as HTMLInputElement).value).toBe('Private draft');
      expect(pwa.reload).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', shortcuts); }
  });

  it('traps Tab within the update dialog instead of moving into the dashboard behind it', async () => {
    const view = render(<UpdateNotice />); await announce();
    const close = within(view.container).getByRole('button', { name: 'Dismiss update notice' });
    const update = within(view.container).getByRole('button', { name: 'Update now' });
    update.focus(); fireEvent.keyDown(update, { key: 'Tab' }); expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(update);
  });

  it('does not reload an unfinished session when another tab activates a worker', async () => {
    render(<UpdateNotice />); await announce();
    pwa.options?.onNeedReload?.();
    expect(pwa.reload).not.toHaveBeenCalled();
  });

  it('activates and reloads only after Update now, without duplicate submissions', async () => {
    const view = render(<UpdateNotice />), worker = await announce();
    const update = within(view.container).getByRole('button', { name: 'Update now' });
    await act(async () => { fireEvent.click(update); fireEvent.click(update); });
    expect(pwa.updateServiceWorker).toHaveBeenCalledTimes(1); expect(pwa.updateServiceWorker).toHaveBeenCalledWith(true);
    expect(pwa.reload).not.toHaveBeenCalled();
    expect(within(view.container).getByRole('button', { name: 'Updating…' }).hasAttribute('disabled')).toBe(true);
    await act(async () => { worker.change('activated'); });
    expect(pwa.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the prompt and enables retry when applying an update fails', async () => {
    pwa.updateServiceWorker.mockRejectedValueOnce(new Error('Reconnect and try again.'));
    const view = render(<UpdateNotice />); await announce();
    await act(async () => { fireEvent.click(within(view.container).getByRole('button', { name: 'Update now' })); });
    expect(within(view.container).getByRole('alert').textContent).toContain('Reconnect and try again.');
    expect(within(view.container).getByRole('button', { name: 'Update now' }).hasAttribute('disabled')).toBe(false);
    expect(pwa.reload).not.toHaveBeenCalled();
  });

  it('still offers the ready update if release notes are unavailable or malformed', async () => {
    pwa.fetch.mockRejectedValueOnce(new Error('Offline release notes'));
    const view = render(<UpdateNotice />); await announce();
    expect(view.container.textContent).toContain('General improvements and fixes.');
    pwa.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ notes: [null, {}, 'Useful change.', 42] }) });
    await announce();
    expect(view.container.textContent).toContain('Useful change.');
    expect(view.container.textContent).not.toContain('[object Object]');
  });

  it('ignores late release notes from a superseded worker', async () => {
    let release!: (value: unknown) => void;
    pwa.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const view = render(<UpdateNotice />); await announce();
    pwa.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ notes: ['Latest release notes.'] }) });
    await announce();
    await act(async () => { release({ ok: true, json: async () => ({ notes: ['Old release notes.'] }) }); });
    expect(view.container.textContent).toContain('Latest release notes.');
    expect(view.container.textContent).not.toContain('Old release notes.');
  });

  it('cleans up checks and restores scrolling on unmount', async () => {
    const view = render(<UpdateNotice />); await announce();
    expect(document.body.style.overflow).toBe('hidden');
    const checks = registration.update.mock.calls.length;
    view.unmount();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
    expect(registration.update).toHaveBeenCalledTimes(checks);
    expect(document.body.style.overflow).toBe('');
  });
});
