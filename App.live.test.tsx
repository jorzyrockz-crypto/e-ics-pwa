// @vitest-environment happy-dom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveRecord, LiveRecordCallbacks, RecordCollection } from './liveRecords';
import type { User } from './firebase';

// Keep the UI tests local: these streams represent another device, never a real
// Google account or the production database. The SDK adapter is tested separately.
const cloud = vi.hoisted(() => ({
  user: { uid: 'owner-a', displayName: 'Owner A' } as User | null,
  authObservers: new Set<(user: User | null) => void>(),
  rows: {} as Record<string, Partial<Record<RecordCollection, LiveRecord[]>>>,
  subscriptions: [] as { uid: string; callbacks: LiveRecordCallbacks; active: boolean; stop: ReturnType<typeof vi.fn> }[],
  firestoreRecords: vi.fn(), syncUserRecords: vi.fn(), subscribeToUserRecords: vi.fn(),
  version: 10,
}));
vi.mock('./firebase', () => ({
  auth: {},
  observeAuth: (_auth: unknown, callback: (user: User | null) => void) => {
    cloud.authObservers.add(callback); callback(cloud.user);
    return () => { cloud.authObservers.delete(callback); };
  },
  signInWithGoogle: vi.fn(), logOut: vi.fn(), clearSyncError: vi.fn(),
  subscribePendingWrites: (callback: (count: number, error: string) => void) => { callback(0, ''); return () => {}; },
  firestoreRecords: cloud.firestoreRecords, syncUserRecords: cloud.syncUserRecords,
  subscribeToUserRecords: cloud.subscribeToUserRecords,
}));
import App from './App';

const clone = <T,>(value: T): T => structuredClone(value);
const meta = (businessName = 'Test Store', cash = 10000, maribank = 5000): LiveRecord => ({
  id: 'meta', updatedAt: 1,
  value: { kind: 'meta', businessName, eloadPct: 3, cashInPct: 2, cashOutPct: 2, palawanFee: 10, wallets: { cash, maribank }, lastClosed: '', lowThreshold: 1000 },
});
const customer: LiveRecord = { id: 'customer-1', updatedAt: 1, value: { name: 'Ada Test', phone: '09171234567', notes: '', createdAt: 1, totalAmount: 0, totalTransactions: 0 } };
const transaction = (amount = 100, version = 1): LiveRecord => ({
  id: 'tx-1', updatedAt: version,
  value: { type: 'E-Load', network: 'Globe', provider: 'Main Wallet', amount, fee: 3, tip: 17, tipWallet: 'cash', selling: amount, phone: '09171234567', customerName: 'Ada Test', payment: 'Cash', notes: 'Device A sale', date: '2026-11-18', time: '8:00 AM', createdAt: 1 },
});
function emit(name: RecordCollection, rows: LiveRecord[], uid = 'owner-a') {
  cloud.rows[uid][name] = clone(rows);
  for (const subscription of cloud.subscriptions) if (subscription.active && subscription.uid === uid) subscription.callbacks.onRecords(name, clone(rows));
}
async function mount() {
  const view = render(<StrictMode><App /></StrictMode>);
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  return view;
}
function nav(container: HTMLElement, name: string) {
  const navigation = within(container).getByRole('navigation', { name: 'Main navigation' });
  fireEvent.click(within(navigation).getByRole('button', { name: new RegExp(`^${name}`) }));
}
function field(container: HTMLElement, text: string): HTMLInputElement {
  const label = [...container.querySelectorAll('label')].find(node => node.textContent === text);
  if (!label?.nextElementSibling) throw new Error(`Missing field: ${text}`);
  return label.nextElementSibling as HTMLInputElement;
}
function openSale(container: HTMLElement) {
  fireEvent.click(within(container).getByRole('button', { name: /^E-Load Sale/ }));
  return within(container).getByRole('dialog', { name: 'Add transaction' });
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-18T08:00:00Z'));
  localStorage.clear(); vi.clearAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  cloud.user = { uid: 'owner-a', displayName: 'Owner A' } as User;
  cloud.authObservers.clear(); cloud.subscriptions = []; cloud.version = 10;
  cloud.rows = {
    'owner-a': { meta: [meta()], customers: [clone(customer)], transactions: [] },
    'owner-b': { meta: [meta('Other Store', 200, 300)], customers: [{ ...clone(customer), id: 'other-customer', value: { ...customer.value, name: 'Other Buyer' } }], transactions: [] },
  };
  cloud.syncUserRecords.mockResolvedValue(undefined);
  cloud.firestoreRecords.mockImplementation(async (action, args, user: User) => {
    const name = args.collection as RecordCollection;
    const rows = cloud.rows[user.uid][name] || [];
    if (action === 'records.list') return { records: clone(rows) };
    const existing = rows.find(row => row.id === args.id);
    if (action === 'records.create' && existing) return { ...clone(existing), skipped: true };
    if (args.expectedUpdatedAt !== undefined && (!existing || existing.updatedAt !== args.expectedUpdatedAt)) throw new Error('This record changed or was removed on another device. Reload records and review the latest version before saving.');
    if (action === 'records.delete') { emit(name, rows.filter(row => row.id !== args.id), user.uid); return { id: args.id }; }
    const row = { id: args.id || `created-${++cloud.version}`, value: clone(args.value), updatedAt: ++cloud.version };
    emit(name, [row, ...rows.filter(item => item.id !== row.id)], user.uid);
    return clone(row);
  });
  cloud.subscribeToUserRecords.mockImplementation((user: User, callbacks: LiveRecordCallbacks) => {
    const subscription = { uid: user.uid, callbacks, active: true, stop: vi.fn() };
    subscription.stop.mockImplementation(() => { subscription.active = false; });
    cloud.subscriptions.push(subscription);
    for (const name of ['transactions', 'meta', 'customers', 'daily_reports', 'favorites', 'wallet_adjustments', 'sync_conflicts'] as RecordCollection[]) callbacks.onRecords(name, clone(cloud.rows[user.uid][name] || []));
    callbacks.onStatus({ connected: true, hasPendingWrites: false });
    return subscription.stop;
  });
});
afterEach(() => {
  cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  localStorage.clear();
});

describe('dashboard cross-device updates', () => {
  it('uses one shared metadata seed when two devices open a new workspace together', async () => {
    cloud.rows['owner-a'].meta = [];
    const a = render(<StrictMode><App /></StrictMode>), b = render(<StrictMode><App /></StrictMode>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(cloud.rows['owner-a'].meta).toHaveLength(1);
    expect(cloud.rows['owner-a'].meta![0].id).toBe('settings');
    const latest = { ...clone(cloud.rows['owner-a'].meta![0]), updatedAt: 50 };
    latest.value.wallets = { cash: 10120, maribank: 4900 };
    await act(async () => { emit('meta', [latest]); });
    nav(a.container, 'Wallets'); nav(b.container, 'Wallets');
    expect(a.container.textContent).toContain('₱10,120');
    expect(b.container.textContent).toContain('₱10,120');
  });

  it('reflects a sale, wallet movement, edit, and deletion on a second open device without refetching', async () => {
    const a = await mount(), b = await mount();
    nav(b.container, 'Transactions');
    const reads = cloud.firestoreRecords.mock.calls.filter(([action]) => action === 'records.list').length;
    const form = openSale(a.container);
    fireEvent.change(form.querySelector('[data-customer-input]')!, { target: { value: 'Ada Test 09171234567' } });
    fireEvent.change(within(form).getByLabelText(/Extra \/ Tip/), { target: { value: '17' } });
    fireEvent.change(field(form, 'Notes'), { target: { value: 'Device A sale' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    const row = b.container.querySelector('.tx-table tbody tr')!;
    expect(row?.textContent).toContain('Device A sale');
    expect(row.textContent).toContain('₱100');
    expect(row.textContent).toContain('₱17');
    nav(b.container, 'Wallets');
    expect(b.container.textContent).toContain('₱10,120');
    expect(b.container.textContent).toContain('₱4,900');
    const sale = cloud.rows['owner-a'].transactions![0];
    await act(async () => {
      emit('transactions', [{ ...sale, updatedAt: 50, value: { ...sale.value, amount: 200, fee: 6 } }]);
      const latest = meta(); latest.updatedAt = 50; latest.value.wallets = { cash: 10223, maribank: 4800 }; emit('meta', [latest]);
    });
    expect(b.container.textContent).toContain('₱10,223');
    nav(b.container, 'Transactions');
    expect(b.container.querySelector('.tx-table tbody tr')?.textContent).toContain('₱200');
    await act(async () => { emit('transactions', []); emit('meta', [meta()]); });
    expect(b.container.querySelector('.tx-table tbody tr')).toBeNull();
    expect(cloud.firestoreRecords.mock.calls.filter(([action]) => action === 'records.list')).toHaveLength(reads);
  });

  it('keeps an unfinished sale intact and uses the latest wallets when it is eventually saved', async () => {
    const view = await mount();
    const form = openSale(view.container);
    fireEvent.change(form.querySelector('[data-customer-input]')!, { target: { value: 'Ada Test 09171234567' } });
    fireEvent.change(field(form, 'Notes'), { target: { value: 'My unfinished draft' } });
    fireEvent.change(within(form).getByLabelText(/Extra \/ Tip/), { target: { value: '7' } });
    await act(async () => {
      emit('transactions', [transaction(200)]);
      const latest = meta('Test Store', 10223, 4800); latest.updatedAt = 2; latest.value.eloadPct = 5; emit('meta', [latest]);
    });
    expect(field(form, 'Notes').value).toBe('My unfinished draft');
    expect((within(form).getByLabelText(/Extra \/ Tip/) as HTMLInputElement).value).toBe('7');
    expect((within(form).getByLabelText('Customer fee (editable)') as HTMLInputElement).value).toBe('3');
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10333, maribank: 4700 });
    expect(cloud.rows['owner-a'].meta![0].value.eloadPct).toBe(5);
  });

  it('keeps a transaction edit draft pinned to its original revision when another device changes that sale', async () => {
    cloud.rows['owner-a'].transactions = [transaction()];
    const view = await mount(); nav(view.container, 'Transactions');
    fireEvent.click(view.container.querySelector('.tx-table tbody tr')!);
    fireEvent.click(within(within(view.container).getByRole('dialog')).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    fireEvent.change(field(form, 'Notes'), { target: { value: 'My edited note' } });
    await act(async () => { emit('transactions', [transaction(200, 2)]); });
    expect(field(form, 'Notes').value).toBe('My edited note');
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(within(view.container).queryByRole('dialog', { name: 'Edit transaction' })).not.toBeNull();
    expect(view.container.textContent).toContain('changed or was removed on another device');
    expect(cloud.rows['owner-a'].transactions![0].value.amount).toBe(200);
    expect(cloud.firestoreRecords.mock.calls.some(([action, args]) => action === 'records.replace' && args.collection === 'meta')).toBe(false);
  });

  it('keeps a customer edit draft and rejects a stale save after a remote edit', async () => {
    const view = await mount(); nav(view.container, 'Customers');
    fireEvent.click(within(view.container).getByRole('button', { name: /Ada Test.*0917/ }));
    fireEvent.click(within(within(view.container).getByRole('dialog')).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit customer' });
    fireEvent.change(field(form, 'Name *'), { target: { value: 'My draft name' } });
    await act(async () => { emit('customers', [{ ...customer, updatedAt: 2, value: { ...customer.value, name: 'Remote name' } }]); });
    expect(field(form, 'Name *').value).toBe('My draft name');
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(form.textContent).toContain('changed or was removed on another device');
    expect(field(form, 'Name *').value).toBe('My draft name');
  });

  it('preserves unsaved settings without writing old balances or untouched settings back to the cloud', async () => {
    const view = await mount(); nav(view.container, 'Settings');
    fireEvent.change(field(view.container, 'Business name'), { target: { value: 'My draft store' } });
    await act(async () => {
      const latest = meta('Test Store', 10120, 4900); latest.updatedAt = 2; latest.value.lowThreshold = 500; emit('meta', [latest]);
    });
    expect(field(view.container, 'Business name').value).toBe('My draft store');
    await act(async () => { fireEvent.click(within(view.container).getByRole('button', { name: 'Save Settings' })); });
    expect(cloud.rows['owner-a'].meta![0].value).toMatchObject({ businessName: 'My draft store', lowThreshold: 500, wallets: { cash: 10120, maribank: 4900 } });
  });

  it('keeps conflicting settings for review and lets the user explicitly discard the draft', async () => {
    const view = await mount(); nav(view.container, 'Settings');
    fireEvent.change(field(view.container, 'Business name'), { target: { value: 'My draft store' } });
    await act(async () => { const latest = meta('Remote store'); latest.updatedAt = 2; emit('meta', [latest]); });
    await act(async () => { fireEvent.click(within(view.container).getByRole('button', { name: 'Save Settings' })); });
    expect(field(view.container, 'Business name').value).toBe('My draft store');
    expect(view.container.textContent).toContain('Business settings changed on another device');
    expect(cloud.rows['owner-a'].meta![0].value.businessName).toBe('Remote store');
    fireEvent.click(within(view.container).getByRole('button', { name: 'Discard draft / use latest settings' }));
    expect(field(view.container, 'Business name').value).toBe('Remote store');
  });

  it('coalesces resume/reconnect events, replaces listeners, and preserves the open draft', async () => {
    const view = await mount(); const old = cloud.subscriptions[0];
    const form = openSale(view.container);
    fireEvent.change(field(form, 'Notes'), { target: { value: 'Keep me after resume' } });
    await act(async () => {
      window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow'));
      document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(old.stop).toHaveBeenCalledTimes(1);
    expect(cloud.subscriptions.filter(subscription => subscription.active)).toHaveLength(1);
    expect(cloud.subscribeToUserRecords).toHaveBeenCalledTimes(2);
    expect(cloud.syncUserRecords).toHaveBeenCalledTimes(2);
    expect(field(form, 'Notes').value).toBe('Keep me after resume');
    view.unmount();
    expect(cloud.subscriptions.every(subscription => subscription.stop.mock.calls.length === 1)).toBe(true);
  });

  it('cleans up listeners and clears the old account drafts before showing another account', async () => {
    const view = await mount(); const old = cloud.subscriptions[0];
    const form = openSale(view.container);
    fireEvent.change(field(form, 'Notes'), { target: { value: 'Private first-account draft' } });
    await act(async () => { for (const observer of cloud.authObservers) observer({ uid: 'owner-b', displayName: 'Owner B' } as User); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(old.stop).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('Other Store');
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    await act(async () => { old.callbacks.onRecords('meta', [meta('Old private store')]); });
    expect(view.container.textContent).not.toContain('Old private store');
    expect(cloud.subscriptions.filter(subscription => subscription.active).map(subscription => subscription.uid)).toEqual(['owner-b']);
  });

  it('retains records on listener failure and retries without a page refresh', async () => {
    cloud.rows['owner-a'].transactions = [transaction()];
    const view = await mount(); const old = cloud.subscriptions[0];
    await act(async () => { old.callbacks.onError(new Error('Permission denied')); });
    expect(view.container.textContent).toContain('Live updates are paused');
    expect(view.container.querySelector('.dashboard-tx-row')?.textContent).toContain('Device A sale');
    fireEvent.click(within(view.container).getByRole('button', { name: 'Retry live sync' }));
    expect(old.stop).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).not.toContain('Live updates are paused');
    expect(view.container.textContent).toContain('Live sync');
  });

  it('never starts cloud reads, sync jobs, or record subscriptions in local preview mode', async () => {
    cloud.user = null;
    const view = render(<StrictMode><App /></StrictMode>);
    fireEvent.click(within(view.container).getByRole('button', { name: 'Preview without signing in' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(view.container.textContent).toContain('Local preview');
    expect(cloud.firestoreRecords).not.toHaveBeenCalled();
    expect(cloud.subscribeToUserRecords).not.toHaveBeenCalled();
    expect(cloud.syncUserRecords).not.toHaveBeenCalled();
    expect(localStorage.getItem('eics.preview.meta')).not.toBeNull();
    fireEvent.click(within(view.container).getByRole('button', { name: 'Exit preview' }));
  });
});
