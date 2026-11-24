// @vitest-environment happy-dom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveRecord, LiveRecordCallbacks, RecordCollection } from './liveRecords';
import type { User } from './firebase';

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
const meta = (cash = 10000, maribank = 5000, profit?: number): LiveRecord => ({
  id: 'meta', updatedAt: 1,
  value: {
    kind: 'meta', businessName: 'Test Store', eloadPct: 3, cashInPct: 2, cashOutPct: 2, palawanFee: 10,
    wallets: { cash, maribank, ...(profit && profit > 0 ? { profit } : {}) },
    lastClosed: '', lowThreshold: 1000,
  },
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

const balances = () => cloud.rows['owner-a'].meta![0].value.wallets;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-24T08:00:00Z'));
  localStorage.clear(); vi.clearAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  cloud.user = { uid: 'owner-a', displayName: 'Owner A' } as User;
  cloud.authObservers.clear(); cloud.subscriptions = []; cloud.version = 10;
  cloud.rows = {
    'owner-a': { meta: [meta(10000, 5000)], customers: [], transactions: [], wallet_adjustments: [] },
  };
  cloud.syncUserRecords.mockResolvedValue(undefined);
  cloud.firestoreRecords.mockImplementation(async (action, args, user: User) => {
    const name = args.collection as RecordCollection;
    const rows = cloud.rows[user.uid][name] || [];
    if (action === 'records.list') return { records: clone(rows) };
    const existing = rows.find(row => row.id === args.id);
    if (action === 'records.create' && existing) return { ...clone(existing), skipped: true };
    if (action === 'records.replace') {
      const updated = { id: args.id, value: clone(args.value), updatedAt: ++cloud.version };
      const next = rows.map(r => r.id === args.id ? updated : r);
      emit(name, next, user.uid);
      return clone(updated);
    }
    if (action === 'records.delete') {
      emit(name, rows.filter(row => row.id !== args.id), user.uid);
      return { id: args.id };
    }
    const row = { id: args.id || `created-${++cloud.version}`, value: clone(args.value), updatedAt: ++cloud.version };
    emit(name, [row, ...rows.filter(item => item.id !== row.id)], user.uid);
    return clone(row);
  });
  cloud.subscribeToUserRecords.mockImplementation((user: User, callbacks: LiveRecordCallbacks) => {
    const subscription = { uid: user.uid, callbacks, active: true, stop: vi.fn() };
    subscription.stop.mockImplementation(() => { subscription.active = false; });
    cloud.subscriptions.push(subscription);
    for (const name of ['transactions', 'meta', 'customers', 'daily_reports', 'favorites', 'wallet_adjustments', 'sync_conflicts'] as RecordCollection[]) {
      callbacks.onRecords(name, clone(cloud.rows[user.uid][name] || []));
    }
    callbacks.onStatus({ connected: true, hasPendingWrites: false });
    return subscription.stop;
  });
});

afterEach(() => {
  cleanup(); vi.clearAllTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  localStorage.clear();
});

describe('Profit Wallet and Internal Wallet Transfers', () => {
  it('renders all 3 wallet cards including Cash on Hand, Main Wallet, and Profit Wallet', async () => {
    const view = await mount();
    nav(view.container, 'Wallets');

    const main = view.container.querySelector('main')!;
    expect(within(main).getByText('Cash on Hand')).toBeTruthy();
    expect(within(main).getByText('Main Wallet')).toBeTruthy();
    expect(within(main).getByText('Profit Wallet')).toBeTruthy();
    expect(within(main).getByText('Dedicated Profit Stash')).toBeTruthy();
  });

  it('allows depositing Cash on Hand directly to Main Wallet via Cash In button', async () => {
    const view = await mount();
    nav(view.container, 'Wallets');

    // Click "Cash In to Main Wallet" button on Cash card
    const cashInBtn = within(view.container).getByRole('button', { name: /Cash In to Main Wallet/i });
    fireEvent.click(cashInBtn);

    // Verify Transfer sheet opened
    const sheet = within(view.container).getByRole('dialog', { name: 'Cash In to Main Wallet' });
    expect(sheet).toBeTruthy();

    // Verify From: Cash on Hand, To: Main Wallet
    const fromSelect = within(sheet).getByLabelText('From Wallet') as HTMLSelectElement;
    const toSelect = within(sheet).getByLabelText('To Wallet') as HTMLSelectElement;
    expect(fromSelect.value).toBe('cash');
    expect(toSelect.value).toBe('maribank');

    // Set transfer amount to 1000
    const amtInput = within(sheet).getByLabelText('Transfer Amount') as HTMLInputElement;
    fireEvent.change(amtInput, { target: { value: '1000' } });

    // Confirm transfer
    const confirmBtn = within(sheet).getByRole('button', { name: /Confirm Transfer of ₱1,000/i });
    await act(async () => { fireEvent.click(confirmBtn); });

    // Verify balances updated: Cash 10000 -> 9000, Main Wallet 5000 -> 6000
    expect(balances()).toEqual({ cash: 9000, maribank: 6000 });

    // Verify 2 wallet adjustments created (deduct cash, add maribank)
    const adjustments = cloud.rows['owner-a'].wallet_adjustments || [];
    expect(adjustments.length).toBe(2);
    expect(adjustments.some(a => a.value.wallet === 'cash' && a.value.mode === 'deduct' && a.value.amount === 1000)).toBe(true);
    expect(adjustments.some(a => a.value.wallet === 'maribank' && a.value.mode === 'add' && a.value.amount === 1000)).toBe(true);
  });

  it('allows stashing cash into Profit Wallet, then reinvesting it into Main Wallet', async () => {
    const view = await mount();
    nav(view.container, 'Wallets');

    // Open transfer modal via Stash Profit on Profit Wallet card
    const stashProfitBtn = within(view.container).getByRole('button', { name: /Stash Profit/i });
    fireEvent.click(stashProfitBtn);

    const sheet = within(view.container).getByRole('dialog', { name: 'Stash Profit' });
    const toSelect = within(sheet).getByLabelText('To Wallet') as HTMLSelectElement;
    expect(toSelect.value).toBe('profit');

    // Transfer 500 from Cash into Profit Wallet
    const amtInput = within(sheet).getByLabelText('Transfer Amount') as HTMLInputElement;
    fireEvent.change(amtInput, { target: { value: '500' } });

    const confirmBtn = within(sheet).getByRole('button', { name: /Confirm Transfer of ₱500/i });
    await act(async () => { fireEvent.click(confirmBtn); });

    // Balances: Cash 9500, Main 5000, Profit 500
    expect(balances()).toEqual({ cash: 9500, maribank: 5000, profit: 500 });

    // Now test "Add to Main Wallet (Reinvest)"
    const reinvestBtn = within(view.container).getByRole('button', { name: /Add to Main Wallet \(Reinvest\)/i });
    fireEvent.click(reinvestBtn);

    const reinvestSheet = within(view.container).getByRole('dialog', { name: 'Reinvest Profit to Main Wallet' });
    const reinvestFrom = within(reinvestSheet).getByLabelText('From Wallet') as HTMLSelectElement;
    const reinvestTo = within(reinvestSheet).getByLabelText('To Wallet') as HTMLSelectElement;
    expect(reinvestFrom.value).toBe('profit');
    expect(reinvestTo.value).toBe('maribank');

    // Transfer all 500 from Profit into Main Wallet
    const reinvestAmt = within(reinvestSheet).getByLabelText('Transfer Amount') as HTMLInputElement;
    fireEvent.change(reinvestAmt, { target: { value: '500' } });

    const confirmReinvest = within(reinvestSheet).getByRole('button', { name: /Confirm Transfer of ₱500/i });
    await act(async () => { fireEvent.click(confirmReinvest); });

    // Profit is now 0, so profit key is omitted!
    expect(balances()).toEqual({ cash: 9500, maribank: 5500 });
  });

  it('rejects transfer exceeding available source balance', async () => {
    const view = await mount();
    nav(view.container, 'Wallets');

    fireEvent.click(within(view.container).getByRole('button', { name: /Cash In to Main Wallet/i }));
    const sheet = within(view.container).getByRole('dialog', { name: 'Cash In to Main Wallet' });

    // Cash has 10000; enter 15000
    const amtInput = within(sheet).getByLabelText('Transfer Amount') as HTMLInputElement;
    fireEvent.change(amtInput, { target: { value: '15000' } });

    const confirmBtn = within(sheet).getByRole('button', { name: /Confirm Transfer of ₱15,000/i });
    await act(async () => { fireEvent.click(confirmBtn); });

    // Alert error displayed
    expect(within(sheet).getByRole('alert').textContent).toContain('Insufficient funds in Cash on Hand');

    // Balances remain untouched
    expect(balances()).toEqual({ cash: 10000, maribank: 5000 });
  });
});
