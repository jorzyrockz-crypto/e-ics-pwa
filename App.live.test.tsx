// @vitest-environment happy-dom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveRecord, LiveRecordCallbacks, RecordCollection } from './liveRecords';
import type { User } from './firebase';
import { appearanceStorageKey } from './app/appearance';

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


function fillCustomer(form: HTMLElement) {
  fireEvent.change(form.querySelector('[data-customer-input]')!, { target: { value: 'Ada Test 09171234567' } });
}
async function confirmPayment(container: HTMLElement) {
  const receipt = within(container).getByRole('dialog', { name: 'Confirm payment received' });
  await act(async () => { fireEvent.click(within(receipt).getByRole('button', { name: 'Confirm payment received' })); });
}
async function confirmRelease(container: HTMLElement, mode: 'entry' | 'deduct' | 'already-recorded' = 'entry') {
  const dialog = within(container).getByRole('dialog', { name: 'Confirm sent / released' });
  const acknowledgment = mode === 'entry' ? within(dialog).getByRole('checkbox') : within(dialog).getByRole('radio', { name: mode === 'deduct' ? /missing deduction has NOT/ : /already deducted manually/ });
  if (!(acknowledgment as HTMLInputElement).checked) fireEvent.click(acknowledgment);
  await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: /^Confirm release/ })); });
}
async function recordTip(container: HTMLElement, amount: string, wallet?: 'cash' | 'maribank') {
  const tip = within(container).getByRole('dialog', { name: 'Extra / Tip' });
  fireEvent.change(within(tip).getByLabelText(/Extra \/ Tip/), { target: { value: amount } });
  if (wallet) fireEvent.change(within(tip).getByLabelText('Extra received in'), { target: { value: wallet } });
  await act(async () => { fireEvent.submit(tip.querySelector('form')!); });
}
async function startUpfront(container: HTMLElement, keepOpen = false) {
  const form = openSale(container); fillCustomer(form);
  await act(async () => { fireEvent.click(within(form).getByRole('button', { name: keepOpen ? 'Save & Add Another' : 'Save Transaction' })); });
  return within(container).getByRole('dialog', { name: 'Confirm payment received' });
}
function transactionDetail(container: HTMLElement) {
  nav(container, 'Transactions'); fireEvent.click(container.querySelector('.tx-table tbody tr')!);
  return within(container).getByRole('dialog', { name: 'Transaction detail' });
}
function receiptValue(container: HTMLElement, key: string) {
  return [...container.querySelectorAll('dt')].find(node => node.textContent === key)?.nextElementSibling?.textContent;
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
    if (action === 'records.save_transaction' || action === 'records.delete_transaction') {
      const deleting = action === 'records.delete_transaction';
      const metadata = cloud.rows[user.uid].meta || [], currentMeta = metadata.find(row => row.id === args.meta?.id);
      if ((!deleting && args.create && existing) || (deleting && !existing)) return { record: { ...clone(existing), skipped: true }, meta: currentMeta ? clone(currentMeta) : undefined };
      if ((deleting || !args.create) && (!existing || existing.updatedAt !== args.expectedUpdatedAt)) throw new Error('This record changed or was removed on another device. Reload records and review the latest version before saving.');
      if (args.meta && (!currentMeta || currentMeta.updatedAt !== args.meta.expectedUpdatedAt)) throw new Error('Wallet balances changed on another device. No transaction or wallet changes were saved. Review the latest balances and try again.');
      const record = { id: args.id, value: clone(args.value), updatedAt: ++cloud.version };
      const savedMeta = args.meta ? { id: args.meta.id, value: clone(args.meta.value), updatedAt: ++cloud.version } : undefined;
      const remaining = rows.filter(item => item.id !== record.id);
      emit(name, deleting ? remaining : [record, ...remaining], user.uid);
      if (savedMeta) emit('meta', [savedMeta, ...metadata.filter(item => item.id !== savedMeta.id)], user.uid);
      return { record: clone(record), meta: savedMeta ? clone(savedMeta) : undefined };
    }
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
  cleanup(); vi.clearAllTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  Reflect.deleteProperty(document.documentElement, 'scrollHeight');
  localStorage.clear();
});

describe('scrolling wallet banner without financial side effects', () => {
  function phoneScrolling() {
    let position = 0, id = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const originalRect = Element.prototype.getBoundingClientRect;
    vi.stubGlobal('innerWidth', 390); vi.stubGlobal('innerHeight', 844); vi.stubGlobal('scrollY', 0);
    // Shadow the inherited DOM getter instead of spying on it: happy-dom's
    // prototype accessor restoration can otherwise leak into the next test.
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 8000 });
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('max-width'), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true })));
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++id, callback); return id; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((frame: number) => { frames.delete(frame); }));
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.nextElementSibling?.matches('.scroll-wallet-banner')) return { x: 0, y: 48 - position, top: 48 - position, bottom: 48 - position, left: 0, right: 0, width: 0, height: 0, toJSON() {} };
      if (!this.matches('.scroll-wallet-banner,.mobile-header-wallet')) return originalRect.call(this);
      const height = this.matches('.mobile-header-wallet') ? 120 : 300;
      return { x: 0, y: 0, top: 0, bottom: height, left: 0, right: 390, width: 390, height, toJSON() {} };
    });
    return (top: number) => act(() => {
      position = top; vi.stubGlobal('scrollY', top); fireEvent.scroll(window);
      const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0);
    });
  }

  it('keeps the same live wallet and actions while collapsing/restoring, with no writes and no state carried to another account', async () => {
    const scroll = phoneScrolling(), view = await mount();
    const header = view.container.querySelector('header')!, wallet = header.querySelector('.mobile-header-wallet')!;
    const action = within(wallet as HTMLElement).getByRole('button', { name: '+ Quick Sale' });
    scroll(400); expect(header.dataset.compact).toBe('true');
    await act(async () => { const latest = meta('Cloud Store', 12000, 6500); latest.updatedAt = 50; emit('meta', [latest]); });
    expect(wallet.textContent).toContain('₱6,500'); expect(wallet.textContent).toContain('₱12,000');
    expect(header.querySelector('.mobile-header-wallet')).toBe(wallet);
    expect(within(wallet as HTMLElement).getByRole('button', { name: '+ Quick Sale' })).toBe(action);
    scroll(380); expect(header.dataset.compact).toBe('false');
    scroll(420); expect(header.dataset.compact).toBe('true');
    await act(async () => { for (const observer of cloud.authObservers) observer({ uid: 'owner-b', displayName: 'Owner B' } as User); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    const otherHeader = view.container.querySelector('header')!;
    expect(otherHeader.dataset.compact).toBe('false');
    expect(otherHeader.textContent).toContain('Other Store'); expect(otherHeader.querySelector('.mobile-header-wallet')?.textContent).toContain('₱300');
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 12000, maribank: 6500 });
    expect(cloud.firestoreRecords.mock.calls.filter(([action]) => action !== 'records.list')).toHaveLength(0);
  });

  it('preserves settings and sale drafts, keeps modal scrolling separate, and restores the full banner on section changes', async () => {
    const scroll = phoneScrolling(), view = await mount(), before = clone(cloud.rows);
    nav(view.container, 'Settings');
    fireEvent.change(field(view.container, 'Business name'), { target: { value: 'Unfinished store name' } });
    const header = view.container.querySelector('header')!;
    scroll(400); expect(header.dataset.compact).toBe('true');
    scroll(370); expect(header.dataset.compact).toBe('false');
    expect(field(view.container, 'Business name').value).toBe('Unfinished store name');
    nav(view.container, 'Dashboard'); scroll(420); expect(header.dataset.compact).toBe('true');
    fireEvent.click(within(header.querySelector('.mobile-header-wallet') as HTMLElement).getByRole('button', { name: '+ Quick Sale' }));
    const form = within(view.container).getByRole('dialog', { name: 'Add transaction' }); fillCustomer(form);
    fireEvent.change(field(form, 'Notes'), { target: { value: 'Do not discard this sale' } });
    scroll(300); expect(header.dataset.compact).toBe('true');
    expect(field(form, 'Notes').value).toBe('Do not discard this sale');
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    scroll(260); expect(header.dataset.compact).toBe('false');
    nav(view.container, 'Settings');
    expect(field(view.container, 'Business name').value).toBe('Unfinished store name');
    expect(cloud.rows).toEqual(before);
    expect(cloud.firestoreRecords.mock.calls.filter(([action]) => action !== 'records.list')).toHaveLength(0);
  });
});

describe('appearance without financial side effects', () => {
  it('changes the local theme immediately without saving business settings or losing a live settings draft', async () => {
    const view = await mount(); nav(view.container, 'Settings');
    const before = clone(cloud.rows);
    fireEvent.change(field(view.container, 'Business name'), { target: { value: 'Unsaved store name' } });
    const appearance = within(view.container).getByRole('region', { name: 'Appearance' });
    expect(within(view.container).queryByRole('button', { name: 'Add transaction — shortcut 1' })).toBeNull();
    fireEvent.click(within(appearance).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(appearanceStorageKey)).toBe('dark');
    expect(field(view.container, 'Business name').value).toBe('Unsaved store name');
    await act(async () => { const changed = meta('Cloud name', 10100, 5100); changed.updatedAt = 50; emit('meta', [changed]); });
    expect(field(view.container, 'Business name').value).toBe('Unsaved store name');
    expect((within(appearance).getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(appearance).getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(cloud.rows['owner-a'].transactions).toEqual(before['owner-a'].transactions);
    expect(cloud.rows['owner-a'].meta![0].value).toMatchObject({ businessName: 'Cloud name', wallets: { cash: 10100, maribank: 5100 } });
    expect(cloud.firestoreRecords.mock.calls.filter(([action]) => action !== 'records.list')).toHaveLength(0);
  });

  it('keeps an unsaved transaction intact when another tab changes appearance', async () => {
    const view = await mount(), form = openSale(view.container); fillCustomer(form);
    fireEvent.change(field(form, 'Notes'), { target: { value: 'Keep this unfinished sale' } });
    fireEvent.change(within(form).getByLabelText('Custom load amount'), { target: { value: '250' } });
    const before = clone(cloud.rows);
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: appearanceStorageKey, newValue: 'dark' })); });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(within(view.container).getByRole('dialog', { name: 'Add transaction' })).toBe(form);
    expect(field(form, 'Notes').value).toBe('Keep this unfinished sale');
    expect((within(form).getByLabelText('Custom load amount') as HTMLInputElement).value).toBe('250');
    expect(form.querySelector<HTMLInputElement>('[data-customer-input]')!.value).toBe('Ada Test 09171234567');
    expect(cloud.rows).toEqual(before);
    expect(cloud.firestoreRecords.mock.calls.filter(([action]) => action !== 'records.list')).toHaveLength(0);
  });

  it('keeps the browser theme while changing accounts without copying store records or settings', async () => {
    localStorage.setItem(appearanceStorageKey, 'dark');
    const view = await mount(); expect(document.documentElement.dataset.theme).toBe('dark');
    const before = clone(cloud.rows);
    await act(async () => { for (const observer of cloud.authObservers) observer({ uid: 'owner-b', displayName: 'Owner B' } as User); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    nav(view.container, 'Settings');
    expect((within(within(view.container).getByRole('region', { name: 'Appearance' })).getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true);
    expect(field(view.container, 'Business name').value).toBe('Other Store');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(cloud.rows).toEqual(before);
  });
});

describe('promo name suggestions from saved sales', () => {
  function savedSale(id = 'saved-promo', changes: Record<string, unknown> = {}): LiveRecord {
    const row = transaction(129);
    return { ...row, id, value: { ...row.value, eloadKind: 'promo', promoName: 'Go Family', promoDetails: '12GB + calls', promoValidity: '7 days', date: '2026-11-17', createdAt: Date.now() - 86400000, ...changes } };
  }
  function openPromo(container: HTMLElement) {
    const form = openSale(container);
    fireEvent.click(within(form).getByRole('button', { name: 'Promo / Bundle' }));
    return form;
  }
  function promoInput(form: HTMLElement) {
    return within(form).getByRole('combobox', { name: 'Promo or package name' }) as HTMLInputElement;
  }
  function focusPromo(form: HTMLElement, value = '') {
    const input = promoInput(form);
    act(() => { input.focus(); });
    if (value) fireEvent.change(input, { target: { value } });
    return input;
  }

  it('fills the latest saved product, recalculates the current fee, and waits for owner confirmation before writing', async () => {
    const settings = meta(); settings.value.eloadPct = 5;
    cloud.rows['owner-a'].meta = [settings];
    cloud.rows['owner-a'].transactions = [
      savedSale('older', { promoName: ' go   family ', amount: 99, promoDetails: 'Old contents', createdAt: Date.now() - 172800000 }),
      savedSale('latest', { phone: '09185555555', customerName: 'Other customer', fee: 90, discount: 19, tip: 99, notes: 'Private old notes', utang: true, utangStatus: 'unpaid' }),
    ];
    const view = await mount(), form = openPromo(view.container); fillCustomer(form);
    fireEvent.change(field(form, 'Notes'), { target: { value: 'My new sale' } });
    fireEvent.change(within(form).getByLabelText('Custom load amount'), { target: { value: '777' } });
    fireEvent.change(within(form).getByLabelText('Provider discount amount'), { target: { value: '4' } });
    fireEvent.change(within(form).getByLabelText('Customer fee (editable)'), { target: { value: '42' } });
    const calls = cloud.firestoreRecords.mock.calls.length;
    const input = focusPromo(form, 'gO');
    const list = within(form).getByRole('listbox', { name: 'Saved Globe promos' });
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    fireEvent.click(within(list).getByRole('option', { name: /Go Family/ }));
    expect(input.value).toBe('Go Family');
    expect((within(form).getByLabelText('Promo inclusions') as HTMLInputElement).value).toBe('12GB + calls');
    expect((within(form).getByLabelText('Promo validity') as HTMLInputElement).value).toBe('7 days');
    expect((within(form).getByLabelText('Custom load amount') as HTMLInputElement).value).toBe('');
    expect((within(form).getByLabelText('Customer fee (editable)') as HTMLInputElement).value).toBe('6.45');
    expect((within(form).getByLabelText('Provider discount amount') as HTMLInputElement).value).toBe('4');
    expect(field(form, 'Notes').value).toBe('My new sale');
    expect(form.querySelector<HTMLInputElement>('[data-customer-input]')!.value).toBe('Ada Test 09171234567');
    expect(within(form).getByLabelText('Customer total').textContent).toBe('₱135.45');
    expect((within(form).getByRole('radio', { name: /^Upfront payment/ }) as HTMLInputElement).checked).toBe(true);
    expect(cloud.firestoreRecords.mock.calls).toHaveLength(calls);
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    expect(within(view.container).getByRole('dialog', { name: 'Confirm payment received' })).not.toBeNull();
    expect(cloud.rows['owner-a'].transactions).toHaveLength(2);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10000, maribank: 5000 });
    await confirmPayment(view.container);
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({
      network: 'Globe', eloadKind: 'promo', promoName: 'Go Family', promoDetails: '12GB + calls', promoValidity: '7 days',
      amount: 129, fee: 6.45, discount: 4, tip: 0, phone: '09171234567', customerName: 'Ada Test', notes: 'My new sale', utang: false,
    });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10135.45, maribank: 4875 });
  });

  it('consumes autocomplete arrows, Enter, held Enter, and the first Escape before global sheet shortcuts', async () => {
    cloud.rows['owner-a'].transactions = [savedSale()];
    const view = await mount(), form = openPromo(view.container); fillCustomer(form);
    const input = focusPromo(form, 'Go'), calls = cloud.firestoreRecords.mock.calls.length;
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    expect(input.value).toBe('Go Family');
    expect(within(view.container).getByRole('dialog', { name: 'Add transaction' })).toBe(form);
    expect(within(view.container).queryByRole('dialog', { name: 'Confirm payment received' })).toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(within(form).queryByRole('listbox')).toBeNull();
    expect(within(view.container).getByRole('dialog', { name: 'Add transaction' })).toBe(form);
    expect(cloud.firestoreRecords.mock.calls).toHaveLength(calls);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(within(view.container).queryByRole('dialog')).toBeNull();
  });

  it('scopes suggestions to the selected network and keeps the provider examples available', async () => {
    cloud.rows['owner-a'].transactions = [savedSale(), savedSale('smart', { network: 'Smart', promoDetails: 'Smart-only data' })];
    const view = await mount(), form = openPromo(view.container);
    let input = focusPromo(form, 'Go');
    expect(within(form).getAllByRole('listbox')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.click(within(form).getByRole('button', { name: 'Smart' }));
    input = focusPromo(form);
    expect(input.value).toBe('Go');
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    const list = within(form).getByRole('listbox', { name: 'Saved Smart promos' });
    expect(list.textContent).toContain('Smart-only data'); expect(list.textContent).not.toContain('12GB + calls');
    fireEvent.click(within(list).getByRole('option'));
    expect((within(form).getByLabelText('Promo inclusions') as HTMLInputElement).value).toBe('Smart-only data');
    fireEvent.click(within(form).getByRole('button', { name: 'DITO' }));
    focusPromo(form);
    expect(within(form).queryByRole('listbox')).toBeNull();
    fireEvent.change(within(form).getByLabelText('Suggested promo list'), { target: { value: 'dito-socials20' } });
    expect(promoInput(form).value).toBe('Level-Up Socials 20');
    expect((within(form).getByLabelText('Customer fee (editable)') as HTMLInputElement).value).toBe('0.6');
    expect(within(form).getByLabelText('Customer total').textContent).toBe('₱20.60');
  });

  it('updates suggestions live without overwriting manual draft fields or writing anything', async () => {
    cloud.rows['owner-a'].transactions = [savedSale()];
    const view = await mount(), form = openPromo(view.container);
    fireEvent.change(within(form).getByLabelText('Promo inclusions'), { target: { value: 'My draft inclusions' } });
    fireEvent.change(within(form).getByLabelText('Promo validity'), { target: { value: 'My draft validity' } });
    fireEvent.change(within(form).getByLabelText('Custom load amount'), { target: { value: '88' } });
    fireEvent.change(within(form).getByLabelText('Customer fee (editable)'), { target: { value: '8' } });
    const input = focusPromo(form, 'go'), calls = cloud.firestoreRecords.mock.calls.length;
    await act(async () => { emit('transactions', [savedSale('saved-promo', { amount: 159, promoDetails: 'Updated data', promoValidity: '30 days' })]); });
    expect(input.value).toBe('go');
    expect((within(form).getByLabelText('Promo inclusions') as HTMLInputElement).value).toBe('My draft inclusions');
    expect((within(form).getByLabelText('Promo validity') as HTMLInputElement).value).toBe('My draft validity');
    expect(within(form).getByLabelText('Customer total').textContent).toBe('₱96');
    const list = within(form).getByRole('listbox'); expect(list.textContent).toContain('₱159');
    fireEvent.click(within(list).getByRole('option'));
    expect((within(form).getByLabelText('Promo inclusions') as HTMLInputElement).value).toBe('Updated data');
    expect((within(form).getByLabelText('Promo validity') as HTMLInputElement).value).toBe('30 days');
    expect(within(form).getByLabelText('Customer total').textContent).toBe('₱163.77');
    await act(async () => { emit('transactions', []); });
    expect(input.value).toBe('Go Family');
    expect(within(form).queryByRole('listbox')).toBeNull();
    expect(cloud.firestoreRecords.mock.calls).toHaveLength(calls);
  });

  it('allows a new custom promo to be saved and suggested on the next sale', async () => {
    cloud.rows['owner-a'].transactions = [savedSale()];
    const view = await mount(), form = openPromo(view.container); fillCustomer(form);
    focusPromo(form, 'Go Island 59');
    expect(within(form).queryByRole('listbox')?.textContent).toBe('');
    expect(form.textContent).toContain('No saved Globe promos match');
    fireEvent.change(within(form).getByLabelText('Promo inclusions'), { target: { value: 'Island data' } });
    fireEvent.change(within(form).getByLabelText('Promo validity'), { target: { value: '3 days' } });
    fireEvent.change(within(form).getByLabelText('Custom load amount'), { target: { value: '59' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    await confirmPayment(view.container);
    fireEvent.click(within(within(view.container).getByRole('dialog', { name: 'Extra / Tip' })).getByRole('button', { name: 'No tip — finish' }));
    const next = openPromo(view.container); focusPromo(next, 'island');
    const list = within(next).getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(list.textContent).toContain('Go Island 59'); expect(list.textContent).toContain('₱59');
    fireEvent.click(within(list).getByRole('option'));
    expect((within(next).getByLabelText('Promo inclusions') as HTMLInputElement).value).toBe('Island data');
    expect((within(next).getByLabelText('Promo validity') as HTMLInputElement).value).toBe('3 days');
  });

  it('does not overwrite prefilled edit/repeat fields until a suggestion is explicitly chosen', async () => {
    cloud.rows['owner-a'].transactions = [savedSale('original', { date: '2026-11-18', fee: 42, promoDetails: 'Original contents' })];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const edit = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    const input = focusPromo(edit);
    await act(async () => { emit('transactions', [savedSale('original', { date: '2026-11-18', amount: 149, fee: 7, promoDetails: 'Remote contents' })]); });
    expect(input.value).toBe('Go Family');
    expect((within(edit).getByLabelText('Promo inclusions') as HTMLInputElement).value).toBe('Original contents');
    expect((within(edit).getByLabelText('Customer fee (editable)') as HTMLInputElement).value).toBe('42');
    fireEvent.click(within(edit).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(transactionDetail(view.container)).getByRole('button', { name: 'Repeat' }));
    const repeat = within(view.container).getByRole('dialog', { name: 'Add transaction' });
    focusPromo(repeat);
    expect((within(repeat).getByLabelText('Promo inclusions') as HTMLInputElement).value).toBe('Remote contents');
    expect((within(repeat).getByLabelText('Customer fee (editable)') as HTMLInputElement).value).toBe('7');
    expect(within(repeat).getByLabelText('Customer total').textContent).toBe('₱156');
  });

  it('uses the already-loaded offline records with no lookup request or selection writes', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    cloud.rows['owner-a'].transactions = [savedSale()];
    const view = await mount(), form = openPromo(view.container);
    const calls = cloud.firestoreRecords.mock.calls.length;
    focusPromo(form, 'family');
    fireEvent.click(within(within(form).getByRole('listbox')).getByRole('option'));
    expect(promoInput(form).value).toBe('Go Family');
    expect(within(form).getByLabelText('Customer total').textContent).toBe('₱132.87');
    expect(cloud.firestoreRecords.mock.calls).toHaveLength(calls);
    expect(cloud.syncUserRecords).not.toHaveBeenCalled();
  });

  it('clears promo history and open drafts when switching accounts', async () => {
    cloud.rows['owner-a'].transactions = [savedSale()];
    cloud.rows['owner-b'].transactions = [savedSale('other', { promoName: 'Other Owner Bundle', promoDetails: 'Other owner data' })];
    const view = await mount(), oldSubscription = cloud.subscriptions[0];
    focusPromo(openPromo(view.container), 'go');
    await act(async () => { for (const observer of cloud.authObservers) observer({ uid: 'owner-b', displayName: 'Owner B' } as User); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    await act(async () => { oldSubscription.callbacks.onRecords('transactions', [savedSale()]); });
    const form = openPromo(view.container), input = focusPromo(form);
    expect(input.value).toBe('');
    const list = within(form).getByRole('listbox');
    expect(list.textContent).toContain('Other Owner Bundle'); expect(list.textContent).not.toContain('Go Family');
  });
});

describe('clay customer avatars across the dashboard', () => {
  const portrait = (root: ParentNode) => {
    const image = root.querySelector<HTMLImageElement>('.customer-avatar img');
    expect(image).not.toBeNull();
    return image!.getAttribute('src');
  };

  it('keeps the same portrait in Top Suki, the customer list/profile, reports, and transaction details', async () => {
    cloud.rows['owner-a'].transactions = [transaction()];
    const view = await mount();
    const src = portrait(view.container.querySelector('.top-suki-card')!);
    nav(view.container, 'Customers');
    expect(portrait(view.container)).toBe(src);
    fireEvent.click(within(view.container).getByText('Ada Test'));
    const profile = within(view.container).getByRole('dialog', { name: 'Customer detail' });
    expect(portrait(profile)).toBe(src);
    expect(profile.querySelector('.customer-avatar')?.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(within(profile).getByRole('button', { name: /^Close$/ }));
    nav(view.container, 'Report');
    expect(portrait(view.container)).toBe(src);
    expect(portrait(transactionDetail(view.container))).toBe(src);
  });

  it('uses clay portraits in Recent, Frequent, and name/number matches without affecting customer selection', async () => {
    cloud.rows['owner-a'].transactions = [transaction()];
    const view = await mount();
    const src = portrait(view.container.querySelector('.top-suki-card')!);
    const form = openSale(view.container), input = form.querySelector<HTMLInputElement>('[data-customer-input]')!;
    fireEvent.focus(input);
    expect(within(form).getByText('Recent')).not.toBeNull();
    expect(within(form).getByText('Frequent')).not.toBeNull();
    const suggestions = form.querySelectorAll<HTMLImageElement>('.customer-avatar img');
    expect(suggestions).toHaveLength(2);
    expect([...suggestions].every(image => image.getAttribute('src') === src)).toBe(true);
    fireEvent.change(input, { target: { value: 'Ada' } });
    expect(within(form).getByText('Matches')).not.toBeNull();
    expect(portrait(form)).toBe(src);
    fireEvent.mouseDown(within(form).getByRole('button', { name: /Ada Test • 0917 123 4567/ }));
    expect(input.value).toBe('Ada Test • 0917 123 4567');
    expect(within(form).queryByText('Matches')).toBeNull();
  });

  it('preserves a phone-only customer avatar after a live name correction without writing any records', async () => {
    cloud.rows['owner-a'].customers = [{ ...clone(customer), value: { ...customer.value, name: '' } }];
    const view = await mount(); nav(view.container, 'Customers');
    const src = portrait(view.container);
    const writes = cloud.firestoreRecords.mock.calls.filter(([action]) => action !== 'records.list').length;
    await act(async () => { emit('customers', [{ ...clone(customer), updatedAt: 50, value: { ...customer.value, name: 'Ada Corrected' } }]); });
    expect(portrait(view.container)).toBe(src);
    expect(view.container.textContent).toContain('Ada Corrected');
    expect(cloud.firestoreRecords.mock.calls.filter(([action]) => action !== 'records.list')).toHaveLength(writes);
  });

  it('keeps Utang and deleted-customer transaction portraits consistent without bringing back initials', async () => {
    const sale = transaction(); sale.value = { ...sale.value, utang: true, utangStatus: 'unpaid', tip: 0 };
    cloud.rows['owner-a'].transactions = [sale];
    const view = await mount();
    const src = portrait(view.container.querySelector('.top-suki-card')!);
    await act(async () => { emit('customers', []); });
    nav(view.container, 'Utang'); expect(portrait(view.container)).toBe(src);
    fireEvent.click(within(view.container).getByRole('button', { name: 'View / Partial' }));
    const detail = within(view.container).getByRole('dialog', { name: 'Transaction detail' });
    expect(within(detail).getByText('Deleted Customer')).not.toBeNull();
    expect(portrait(detail)).toBe(src);
    expect(detail.querySelector('.customer-avatar')?.textContent).toBe('');
  });
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
    expect(within(form).queryByLabelText(/Extra \/ Tip/)).toBeNull();
    fireEvent.change(field(form, 'Notes'), { target: { value: 'Device A sale' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    await confirmPayment(a.container);
    await recordTip(a.container, '17');
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
    expect(within(form).queryByLabelText(/Extra \/ Tip/)).toBeNull();
    await act(async () => {
      emit('transactions', [transaction(200)]);
      const latest = meta('Test Store', 10223, 4800); latest.updatedAt = 2; latest.value.eloadPct = 5; emit('meta', [latest]);
    });
    expect(field(form, 'Notes').value).toBe('My unfinished draft');
    expect(within(form).queryByLabelText(/Extra \/ Tip/)).toBeNull();
    expect((within(form).getByLabelText('Customer fee (editable)') as HTMLInputElement).value).toBe('3');
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    await confirmPayment(view.container);
    await recordTip(view.container, '7');
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


describe('owner-confirmed payment followed by an optional tip', () => {
  it('has no entry tip field and makes no financial writes until the owner confirms; Back preserves the draft', async () => {
    const view = await mount();
    const form = openSale(view.container); fillCustomer(form);
    fireEvent.change(field(form, 'Notes'), { target: { value: 'Keep this payment draft' } });
    expect(within(form).queryByLabelText(/Extra \/ Tip/)).toBeNull();
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    const receipt = within(view.container).getByRole('dialog', { name: 'Confirm payment received' });
    expect(receiptValue(receipt, 'Payment to confirm (no tip)')).toBe('₱103');
    expect(within(view.container).queryByRole('dialog', { name: 'Extra / Tip' })).toBeNull();
    expect(cloud.rows['owner-a'].transactions).toHaveLength(0);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10000, maribank: 5000 });
    fireEvent.click(within(receipt).getByRole('button', { name: 'Back — not confirmed' }));
    const restored = within(view.container).getByRole('dialog', { name: 'Add transaction' });
    expect(field(restored, 'Notes').value).toBe('Keep this payment draft');
    await act(async () => { fireEvent.click(within(restored).getByRole('button', { name: 'Save Transaction' })); });
    await confirmPayment(view.container);
    const paid = cloud.rows['owner-a'].transactions![0].value;
    expect(paid).toMatchObject({ amount: 100, fee: 3, tip: 0, paymentConfirmedAt: Date.now() });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4900 });
    fireEvent.click(within(within(view.container).getByRole('dialog', { name: 'Extra / Tip' })).getByRole('button', { name: 'No tip — finish' }));
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(cloud.rows['owner-a'].transactions![0].value.tip).toBe(0);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4900 });
  });

  it.each(['', '0'])('accepts an optional %j tip without another financial write', async amount => {
    const view = await mount(); await startUpfront(view.container); await confirmPayment(view.container);
    const writes = cloud.firestoreRecords.mock.calls.filter(([action]) => action !== 'records.list').length;
    await recordTip(view.container, amount);
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    expect(cloud.firestoreRecords.mock.calls.filter(([action]) => action !== 'records.list')).toHaveLength(writes);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4900 });
  });

  it.each([
    { type: 'E-Load', wallet: 'cash', cash: 10120, maribank: 4900 },
    { type: 'Cash In', wallet: 'cash', cash: 10119, maribank: 4900 },
    { type: 'Cash Out', wallet: 'maribank', cash: 9900, maribank: 5119 },
  ])('records $type first, then adds only the tip to its receiving wallet', async ({ type, wallet, cash, maribank }) => {
    const view = await mount(), form = openSale(view.container); fillCustomer(form);
    if (type !== 'E-Load') fireEvent.click(within(form).getByRole('button', { name: type }));
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    await confirmPayment(view.container);
    const tip = within(view.container).getByRole('dialog', { name: 'Extra / Tip' });
    expect((within(tip).getByLabelText('Extra received in') as HTMLSelectElement).value).toBe(wallet);
    const principal = clone(cloud.rows['owner-a'].transactions![0].value);
    await recordTip(view.container, '17');
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ ...principal, tip: 17, tipWallet: wallet, tipRecordedAt: Date.now() });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash, maribank });
  });

  it('records a cash tip on a digitally paid Cash Out separately from its original payment', async () => {
    const view = await mount(), form = openSale(view.container); fillCustomer(form);
    fireEvent.click(within(form).getByRole('button', { name: 'Cash Out' }));
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    const receipt = within(view.container).getByRole('dialog');
    expect(receiptValue(receipt, 'Received in')).toBe('Main Wallet');
    await confirmPayment(view.container); await recordTip(view.container, '17', 'cash');
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 9917, maribank: 5102 });
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ amount: 100, fee: 2, tip: 17, tipWallet: 'cash', payment: 'Main Wallet' });
  });

  it('saves unpaid Utang with no tip prompt and prompts only after a confirmed Mark Paid collection', async () => {
    const view = await mount(), form = openSale(view.container); fillCustomer(form);
    fireEvent.click(within(form).getByRole('radio', { name: /^Utang \/ Pay Later/ }));
    fireEvent.click(within(form).getByRole('button', { name: 'Tomorrow' }));
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    expect(within(view.container).queryByRole('dialog', { name: 'Extra / Tip' })).toBeNull();
    await confirmRelease(view.container);
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ utang: true, utangStatus: 'unpaid', paidAmount: 0, tip: 0, promiseDate: '2026-11-19', utangReleased: true });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10000, maribank: 4900 });
    const detail = transactionDetail(view.container);
    expect(within(detail).queryByRole('button', { name: /Record extra/ })).toBeNull();
    fireEvent.click(within(detail).getByRole('button', { name: 'Mark Paid' }));
    expect(cloud.rows['owner-a'].transactions![0].value.utangStatus).toBe('unpaid');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(view.container).getByRole('dialog', { name: 'Transaction detail' })).not.toBeNull();
    fireEvent.click(within(within(view.container).getByRole('dialog')).getByRole('button', { name: 'Mark Paid' }));
    await confirmPayment(view.container);
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ utangStatus: 'paid', paidAmount: 100, tip: 0, paymentConfirmedAt: Date.now() });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4900 });
    await recordTip(view.container, '17', 'maribank');
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ amount: 100, fee: 3, utangStatus: 'paid', paidAmount: 100, tip: 17 });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4917 });
  });

  it('never prompts on partial Utang, then prompts when the partial-payment screen settles the full remaining principal', async () => {
    const debt = transaction(); debt.value = { ...debt.value, utang: true, utangStatus: 'unpaid', paidAmount: 0, tip: 0 };
    cloud.rows['owner-a'].transactions = [debt];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Partial Payment' }));
    fireEvent.change(within(detail).getByLabelText('Amount paid now'), { target: { value: '40' } });
    fireEvent.click(within(detail).getByRole('button', { name: 'Save Partial Payment' }));
    let receipt = within(view.container).getByRole('dialog', { name: 'Confirm payment received' });
    expect(receiptValue(receipt, 'Payment to confirm (no tip)')).toBe('₱41.20');
    expect(receipt.textContent).toContain('tip modal will appear only after the Utang is fully paid');
    await confirmPayment(view.container);
    expect(within(view.container).queryByRole('dialog', { name: 'Extra / Tip' })).toBeNull();
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ utangStatus: 'unpaid', paidAmount: 40, tip: 0 });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10041.2, maribank: 4960 });
    const remainingDetail = within(view.container).getByRole('dialog', { name: 'Transaction detail' });
    fireEvent.click(within(remainingDetail).getByRole('button', { name: 'Partial Payment' }));
    expect((within(remainingDetail).getByLabelText('Amount paid now') as HTMLInputElement).value).toBe('60');
    fireEvent.click(within(remainingDetail).getByRole('button', { name: 'Save Partial Payment' }));
    receipt = within(view.container).getByRole('dialog', { name: 'Confirm payment received' });
    expect(receiptValue(receipt, 'Payment to confirm (no tip)')).toBe('₱61.80');
    await confirmPayment(view.container);
    expect(within(view.container).getByRole('dialog', { name: 'Extra / Tip' })).not.toBeNull();
    await recordTip(view.container, '17');
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ utangStatus: 'paid', paidAmount: 100, tip: 17 });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10120, maribank: 4900 });
  });

  it('validates a tip without undoing a confirmed payment, and a failed tip write can be retried without collecting principal again', async () => {
    const view = await mount(); await startUpfront(view.container); await confirmPayment(view.container);
    let tip = within(view.container).getByRole('dialog', { name: 'Extra / Tip' });
    await recordTip(view.container, '-1');
    expect(within(tip).getByRole('alert').textContent).toContain('zero or a positive amount');
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4900 });
    cloud.firestoreRecords.mockRejectedValueOnce(new Error('Tip could not be saved. Try again.'));
    await recordTip(view.container, '17');
    tip = within(view.container).getByRole('dialog', { name: 'Extra / Tip' });
    expect((within(tip).getByLabelText(/Extra \/ Tip/) as HTMLInputElement).value).toBe('17');
    expect(tip.textContent).toContain('confirmed base payment is kept');
    expect(cloud.rows['owner-a'].transactions![0].value.tip).toBe(0);
    await recordTip(view.container, '17');
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10120, maribank: 4900 });
  });

  it('does not let keyboard shortcuts submit background forms while either modal is open', async () => {
    const view = await mount(); await startUpfront(view.container, true);
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: '1' });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(0);
    expect(within(view.container).getAllByRole('dialog')).toHaveLength(1);
    await confirmPayment(view.container);
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'h' });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(within(view.container).getAllByRole('dialog')).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    const next = within(view.container).getByRole('dialog', { name: 'Add transaction' });
    expect((next.querySelector('[data-customer-input]') as HTMLInputElement).value).toContain('Ada Test');
    expect(within(next).queryByLabelText(/Extra \/ Tip/)).toBeNull();
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4900 });
  });

  it('pins a tip draft to the paid record revision and refuses to overwrite a remote edit', async () => {
    const view = await mount(); await startUpfront(view.container); await confirmPayment(view.container);
    const tip = within(view.container).getByRole('dialog', { name: 'Extra / Tip' });
    fireEvent.change(within(tip).getByLabelText(/Extra \/ Tip/), { target: { value: '17' } });
    const paid = cloud.rows['owner-a'].transactions![0];
    await act(async () => {
      emit('transactions', [{ ...paid, updatedAt: 100, value: { ...paid.value, notes: 'Edited on device B' } }]);
      const latest = meta('Test Store', 10603, 4400); latest.updatedAt = 100; emit('meta', [latest]);
    });
    await act(async () => { fireEvent.submit(tip.querySelector('form')!); });
    expect(tip.textContent).toContain('changed or was removed on another device');
    expect((within(tip).getByLabelText(/Extra \/ Tip/) as HTMLInputElement).value).toBe('17');
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ notes: 'Edited on device B', tip: 0 });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10603, maribank: 4400 });
  });

  it('rejects stale Utang confirmation if another device already collected it', async () => {
    const debt = transaction(); debt.value = { ...debt.value, utang: true, utangStatus: 'unpaid', paidAmount: 0, tip: 0 };
    cloud.rows['owner-a'].transactions = [debt];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Mark Paid' }));
    await act(async () => { emit('transactions', [{ ...debt, updatedAt: 100, value: { ...debt.value, utangStatus: 'paid', paidAmount: 100 } }]); });
    await confirmPayment(view.container);
    expect(within(view.container).queryByRole('dialog', { name: 'Extra / Tip' })).toBeNull();
    expect(within(view.container).getByRole('alert').textContent).toContain('changed or was removed on another device');
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10000, maribank: 5000 });
  });

  it('keeps a historical tip on ordinary edits and manages or removes it only in its own modal', async () => {
    cloud.rows['owner-a'].transactions = [transaction()]; cloud.rows['owner-a'].meta = [meta('Test Store', 10120, 4900)];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const edit = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    expect(within(edit).queryByLabelText(/Extra \/ Tip/)).toBeNull();
    fireEvent.change(field(edit, 'Notes'), { target: { value: 'Only change this note' } });
    await act(async () => { fireEvent.click(within(edit).getByRole('button', { name: 'Save Changes' })); });
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ notes: 'Only change this note', tip: 17 });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10120, maribank: 4900 });
    fireEvent.click(view.container.querySelector('.tx-table tbody tr')!);
    fireEvent.click(within(within(view.container).getByRole('dialog')).getByRole('button', { name: 'Edit recorded tip' }));
    await recordTip(view.container, '17', 'maribank');
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4917 });
    fireEvent.click(within(within(view.container).getByRole('dialog')).getByRole('button', { name: 'Edit recorded tip' }));
    await recordTip(view.container, '0');
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ tip: 0, amount: 100, fee: 3 });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4900 });
  });

  it('reverses and restores the separately recorded tip on delete and Undo', async () => {
    const view = await mount(); await startUpfront(view.container); await confirmPayment(view.container); await recordTip(view.container, '17');
    const detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    await act(async () => { fireEvent.click(within(detail).getByRole('button', { name: 'Yes, delete' })); });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(0);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10000, maribank: 5000 });
    await act(async () => { fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-toast]')!).getByRole('button', { name: 'Undo' })); });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(cloud.rows['owner-a'].transactions![0].value.tip).toBe(17);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10120, maribank: 4900 });
  });

  it('clears the paid-tip prompt when the account changes', async () => {
    const view = await mount(); await startUpfront(view.container); await confirmPayment(view.container);
    fireEvent.change(within(within(view.container).getByRole('dialog')).getByLabelText(/Extra \/ Tip/), { target: { value: '17' } });
    await act(async () => { for (const observer of cloud.authObservers) observer({ uid: 'owner-b', displayName: 'Owner B' } as User); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    expect(cloud.rows['owner-b'].transactions).toHaveLength(0);
    expect(cloud.rows['owner-a'].transactions![0].value.tip).toBe(0);
  });

  it('keeps payment and tip unsaved together if the balances change during a save, then retries against the latest wallets', async () => {
    const view = await mount(); await startUpfront(view.container);
    const original = cloud.firestoreRecords.getMockImplementation()!;
    cloud.firestoreRecords.mockImplementationOnce(async (...args) => {
      const newer = meta('Test Store', 10500, 4500); newer.updatedAt = 5; emit('meta', [newer]);
      return original(...args);
    });
    await confirmPayment(view.container);
    expect(within(view.container).getByRole('alert').textContent).toContain('Wallet balances changed');
    expect(cloud.rows['owner-a'].transactions).toHaveLength(0);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10500, maribank: 4500 });
    await confirmPayment(view.container);
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10603, maribank: 4400 });
    cloud.firestoreRecords.mockImplementationOnce(async (...args) => {
      const newer = meta('Test Store', 10803, 4200); newer.updatedAt = 99; emit('meta', [newer]);
      return original(...args);
    });
    await recordTip(view.container, '17');
    expect(within(view.container).getByRole('alert').textContent).toContain('Wallet balances changed');
    expect(cloud.rows['owner-a'].transactions![0].value.tip).toBe(0);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10803, maribank: 4200 });
    await recordTip(view.container, '17');
    expect(cloud.rows['owner-a'].transactions![0].value.tip).toBe(17);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10820, maribank: 4200 });
  });

  it('reuses the same upfront transaction ID if a response fails after the confirmed payment was committed', async () => {
    const view = await mount(); await startUpfront(view.container);
    const original = cloud.firestoreRecords.getMockImplementation()!;
    cloud.firestoreRecords.mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error('The response was interrupted. Review and try again.');
    });
    await confirmPayment(view.container);
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4900 });
    await confirmPayment(view.container);
    expect(within(view.container).getByRole('dialog', { name: 'Extra / Tip' })).not.toBeNull();
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4900 });
    const creates = cloud.firestoreRecords.mock.calls.filter(([action, args]) => action === 'records.save_transaction' && args.create);
    expect(creates).toHaveLength(2);
    expect(creates[0][1].id).toBe(creates[1][1].id);
    await recordTip(view.container, '17');
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10120, maribank: 4900 });
  });

  it('prevents duplicate confirmation and tip writes even before disabled buttons are rendered', async () => {
    const view = await mount(); await startUpfront(view.container);
    const original = cloud.firestoreRecords.getMockImplementation()!;
    let release!: () => void;
    let gate = new Promise<void>(resolve => { release = resolve; });
    let holdCreate = true;
    cloud.firestoreRecords.mockImplementation(async (...args) => {
      if (args[0] === 'records.save_transaction' && args[1].create === holdCreate) await gate;
      return original(...args);
    });
    const receipt = within(view.container).getByRole('dialog');
    const confirm = within(receipt).getByRole('button', { name: 'Confirm payment received' });
    await act(async () => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(within(receipt).getByRole('button', { name: 'Confirming…' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(within(receipt).getByRole('button', { name: 'Close' }));
    expect(within(view.container).getByRole('dialog', { name: 'Confirm payment received' })).not.toBeNull();
    await act(async () => { release(); });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    holdCreate = false; gate = new Promise<void>(resolve => { release = resolve; });
    const tip = within(view.container).getByRole('dialog', { name: 'Extra / Tip' });
    fireEvent.change(within(tip).getByLabelText(/Extra \/ Tip/), { target: { value: '17' } });
    await act(async () => { fireEvent.submit(tip.querySelector('form')!); fireEvent.submit(tip.querySelector('form')!); });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(within(view.container).getByRole('dialog', { name: 'Extra / Tip' })).not.toBeNull();
    await act(async () => { release(); });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(cloud.firestoreRecords.mock.calls.filter(([action, args]) => action === 'records.save_transaction' && !args.create)).toHaveLength(1);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10120, maribank: 4900 });
  });

  it('repeats a tipped transaction as a fresh unconfirmed sale without inheriting its tip', async () => {
    cloud.rows['owner-a'].transactions = [transaction()]; cloud.rows['owner-a'].meta = [meta('Test Store', 10120, 4900)];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Repeat' }));
    const form = within(view.container).getByRole('dialog', { name: 'Add transaction' });
    expect(within(form).queryByLabelText(/Extra \/ Tip/)).toBeNull();
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    await confirmPayment(view.container);
    const tip = within(view.container).getByRole('dialog', { name: 'Extra / Tip' });
    expect((within(tip).getByLabelText(/Extra \/ Tip/) as HTMLInputElement).value).toBe('');
    fireEvent.click(within(tip).getByRole('button', { name: 'No tip — finish' }));
    expect(cloud.rows['owner-a'].transactions).toHaveLength(2);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10223, maribank: 4800 });
  });

  it('preserves a legacy fully paid Utang and its tip when paidAmount was not stored', async () => {
    const paid = transaction(); paid.value = { ...paid.value, utang: true, utangStatus: 'paid' };
    cloud.rows['owner-a'].transactions = [paid]; cloud.rows['owner-a'].meta = [meta('Test Store', 10120, 4900)];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    fireEvent.change(field(form, 'Notes'), { target: { value: 'Only a historical note edit' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ utang: true, utangStatus: 'paid', paidAmount: 100, tip: 17 });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10120, maribank: 4900 });
  });

  it('confirms only the outstanding amount when a partial Utang is edited to upfront payment', async () => {
    const partial = transaction(); partial.value = { ...partial.value, utang: true, utangStatus: 'unpaid', paidAmount: 40, tip: 0 };
    cloud.rows['owner-a'].transactions = [partial]; cloud.rows['owner-a'].meta = [meta('Test Store', 10041.2, 4960)];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    fireEvent.click(within(form).getByRole('radio', { name: /^Upfront payment/ }));
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(receiptValue(within(view.container).getByRole('dialog'), 'Payment to confirm (no tip)')).toBe('₱61.80');
    await confirmPayment(view.container);
    await recordTip(view.container, '17');
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10120, maribank: 4900 });
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ utang: false, amount: 100, tip: 17 });
  });

  it('can confirm a legacy fully collected Utang before offering its tip without collecting it twice', async () => {
    const collected = transaction(); collected.value = { ...collected.value, utang: true, utangStatus: 'unpaid', paidAmount: 100, tip: 0 };
    cloud.rows['owner-a'].transactions = [collected]; cloud.rows['owner-a'].meta = [meta('Test Store', 10103, 4900)];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Mark Paid' }));
    expect(receiptValue(within(view.container).getByRole('dialog'), 'Payment to confirm (no tip)')).toBe('₱0');
    await confirmPayment(view.container);
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10103, maribank: 4900 });
    expect(cloud.rows['owner-a'].transactions![0].value.utangStatus).toBe('paid');
    await recordTip(view.container, '17');
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10120, maribank: 4900 });
  });

  it('requires removing a recorded tip explicitly before changing the sale to a top-up or unpaid Utang', async () => {
    cloud.rows['owner-a'].transactions = [transaction()]; cloud.rows['owner-a'].meta = [meta('Test Store', 10120, 4900)];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    fireEvent.click(within(form).getByRole('button', { name: 'Top-Up via External Provider' }));
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(view.container.textContent).toContain('Remove the recorded tip');
    fireEvent.click(within(form).getByRole('button', { name: 'E-Load' }));
    fireEvent.click(within(form).getByRole('radio', { name: /^Utang \/ Pay Later/ }));
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(view.container.textContent).toContain('before reopening this payment as unpaid Utang');
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ type: 'E-Load', tip: 17 });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10120, maribank: 4900 });
  });

  it('never offers a tip for an External Provider top-up', async () => {
    const view = await mount(), form = openSale(view.container);
    fireEvent.click(within(form).getByRole('button', { name: 'Top-Up via External Provider' }));
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Top-Up via External Provider' })); });
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ type: 'Top-Up', tip: 0, amount: 1000 });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 8990, maribank: 6000 });
  });
});

describe('sent / released Utang and independently confirmed receipts', () => {
  const balances = () => cloud.rows['owner-a'].meta![0].value.wallets;
  function debt(changes: Record<string, unknown> = {}) {
    const row = transaction(1000);
    return { ...row, value: { ...row.value, type: 'Cash In', network: 'Main Wallet', selling: 0, fee: 15, tip: 0, utang: true, utangStatus: 'unpaid', paidAmount: 0, ...changes } };
  }
  async function startDebt(container: HTMLElement, type: 'Cash In' | 'Cash Out' | 'E-Load' = 'Cash In', amount = 1000, fee = 15) {
    const form = openSale(container); fillCustomer(form);
    if (type !== 'E-Load') fireEvent.click(within(form).getByRole('button', { name: type }));
    if (type === 'E-Load') fireEvent.change(within(form).getByLabelText('Custom load amount'), { target: { value: String(amount) } });
    else fireEvent.change(field(form, 'Amount'), { target: { value: String(amount) } });
    fireEvent.change(within(form).getByLabelText(type === 'E-Load' ? 'Customer fee (editable)' : 'Service fee (editable)'), { target: { value: String(fee) } });
    fireEvent.click(within(form).getByRole('radio', { name: /^Utang \/ Pay Later/ }));
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    return within(container).getByRole('dialog', { name: 'Confirm sent / released' });
  }
  function review(container: HTMLElement) {
    const detail = transactionDetail(container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Review sent / released' }));
    return within(container).getByRole('dialog', { name: 'Confirm sent / released' });
  }

  it('deducts the sent ₱1,000 Cash In, receives no cash yet, then collects partial/full receipts without sending twice', async () => {
    const view = await mount(), release = await startDebt(view.container);
    expect(receiptValue(release, 'Cash on Hand change')).toBe('+₱0');
    expect(receiptValue(release, 'Main Wallet change')).toBe('−₱1,000');
    expect(within(release).getByRole('button', { name: /^Confirm release/ }).hasAttribute('disabled')).toBe(true);
    expect(cloud.rows['owner-a'].transactions).toHaveLength(0);
    expect(balances()).toEqual({ cash: 10000, maribank: 5000 });
    await confirmRelease(view.container);
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ type: 'Cash In', amount: 1000, fee: 15, utang: true, utangStatus: 'unpaid', paidAmount: 0, utangReleased: true, utangReleaseMode: 'deduct', utangReleaseRecordedAt: Date.now(), tip: 0 });
    expect(balances()).toEqual({ cash: 10000, maribank: 4000 });
    expect(within(view.container).queryByRole('dialog', { name: 'Extra / Tip' })).toBeNull();
    let detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Partial Payment' }));
    fireEvent.change(within(detail).getByLabelText('Amount paid now'), { target: { value: '400' } });
    fireEvent.click(within(detail).getByRole('button', { name: 'Save Partial Payment' }));
    let receipt = within(view.container).getByRole('dialog', { name: 'Confirm payment received' });
    expect(receiptValue(receipt, 'Payment to confirm (no tip)')).toBe('₱406');
    expect(receipt.textContent).toContain('does not deduct the sent/released amount again');
    await confirmPayment(view.container);
    expect(balances()).toEqual({ cash: 10406, maribank: 4000 });
    expect(within(view.container).queryByRole('dialog', { name: 'Extra / Tip' })).toBeNull();
    detail = within(view.container).getByRole('dialog', { name: 'Transaction detail' });
    fireEvent.click(within(detail).getByRole('button', { name: 'Mark Paid' }));
    receipt = within(view.container).getByRole('dialog', { name: 'Confirm payment received' });
    expect(receiptValue(receipt, 'Payment to confirm (no tip)')).toBe('₱609');
    await confirmPayment(view.container);
    expect(balances()).toEqual({ cash: 11015, maribank: 4000 });
    await recordTip(view.container, '17');
    expect(balances()).toEqual({ cash: 11032, maribank: 4000 });
  });

  it.each([
    { type: 'E-Load' as const, amount: 100, fee: 3, releasedCash: 10000, releasedMain: 4900, paidCash: 10103, paidMain: 4900 },
    { type: 'Cash Out' as const, amount: 500, fee: 10, releasedCash: 9500, releasedMain: 5000, paidCash: 10010, paidMain: 5000 },
  ])('also separates the $type release from its later customer payment', async row => {
    const view = await mount(); await startDebt(view.container, row.type, row.amount, row.fee); await confirmRelease(view.container);
    expect(balances()).toEqual({ cash: row.releasedCash, maribank: row.releasedMain });
    fireEvent.click(within(transactionDetail(view.container)).getByRole('button', { name: 'Mark Paid' }));
    await confirmPayment(view.container);
    expect(balances()).toEqual({ cash: row.paidCash, maribank: row.paidMain });
  });

  it('keeps a release unrecorded until acknowledged, blocks background shortcuts, and preserves the draft on Back/Escape', async () => {
    const view = await mount(), release = await startDebt(view.container);
    const calls = cloud.firestoreRecords.mock.calls.length;
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true }); fireEvent.keyDown(window, { key: '1' });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(0);
    expect(cloud.firestoreRecords.mock.calls).toHaveLength(calls);
    expect(within(view.container).getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(within(release).getByRole('button', { name: 'Back — do not change records' }));
    let form = within(view.container).getByRole('dialog', { name: 'Add transaction' });
    expect(field(form, 'Amount').value).toBe('1000');
    expect((within(form).getByLabelText('Service fee (editable)') as HTMLInputElement).value).toBe('15');
    expect((within(form).getByRole('radio', { name: /^Utang \/ Pay Later/ }) as HTMLInputElement).checked).toBe(true);
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    fireEvent.keyDown(window, { key: 'Escape' });
    form = within(view.container).getByRole('dialog', { name: 'Add transaction' });
    expect(field(form, 'Amount').value).toBe('1000');
    expect(balances()).toEqual({ cash: 10000, maribank: 5000 });
  });

  it('rejects a concurrent wallet change atomically and lets the same release retry against latest balances', async () => {
    const view = await mount(); await startDebt(view.container);
    const original = cloud.firestoreRecords.getMockImplementation()!;
    cloud.firestoreRecords.mockImplementationOnce(async (...args) => {
      const latest = meta('Test Store', 10500, 4500); latest.updatedAt = 50; emit('meta', [latest]);
      return original(...args);
    });
    await confirmRelease(view.container);
    expect(cloud.rows['owner-a'].transactions).toHaveLength(0);
    expect(balances()).toEqual({ cash: 10500, maribank: 4500 });
    expect(within(view.container).getByRole('alert').textContent).toContain('Wallet balances changed');
    await confirmRelease(view.container);
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(balances()).toEqual({ cash: 10500, maribank: 3500 });
  });

  it('reuses the release entry ID when a response fails after committing, without deducting twice', async () => {
    const view = await mount(); await startDebt(view.container);
    const original = cloud.firestoreRecords.getMockImplementation()!;
    cloud.firestoreRecords.mockImplementationOnce(async (...args) => { await original(...args); throw new Error('Response interrupted after recording.'); });
    await confirmRelease(view.container);
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(balances()).toEqual({ cash: 10000, maribank: 4000 });
    await confirmRelease(view.container);
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(balances()).toEqual({ cash: 10000, maribank: 4000 });
    const saves = cloud.firestoreRecords.mock.calls.filter(([action, args]) => action === 'records.save_transaction' && args.create);
    expect(saves[0][1].id).toBe(saves[1][1].id);
  });

  it('does not migrate old records or balances merely on load, live updates, or opening/canceling a review', async () => {
    const old = debt(); cloud.rows['owner-a'].transactions = [old];
    const view = await mount(), calls = cloud.firestoreRecords.mock.calls.length;
    const release = review(view.container);
    expect(within(release).getByRole('button', { name: /^Confirm release/ }).hasAttribute('disabled')).toBe(true);
    await act(async () => { emit('transactions', [old]); });
    fireEvent.click(within(release).getByRole('button', { name: 'Back — do not change records' }));
    expect(cloud.rows['owner-a'].transactions![0]).toEqual(old);
    expect(cloud.firestoreRecords.mock.calls).toHaveLength(calls);
    expect(balances()).toEqual({ cash: 10000, maribank: 5000 });
  });

  it('applies an older missing Cash In deduction once, preserves its debt, and never repeats it on edit or reload', async () => {
    cloud.rows['owner-a'].transactions = [debt()];
    let view = await mount(); review(view.container); await confirmRelease(view.container, 'deduct');
    expect(balances()).toEqual({ cash: 10000, maribank: 4000 });
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ utangReleased: true, utangReleaseMode: 'deduct', utangStatus: 'unpaid', paidAmount: 0, tip: 0 });
    let detail = within(view.container).getByRole('dialog', { name: 'Transaction detail' });
    expect(within(detail).queryByRole('button', { name: 'Review sent / released' })).toBeNull();
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    fireEvent.change(field(form, 'Notes'), { target: { value: 'A note after release' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(balances()).toEqual({ cash: 10000, maribank: 4000 });
    view.unmount(); view = await mount();
    expect(balances()).toEqual({ cash: 10000, maribank: 4000 });
    detail = transactionDetail(view.container); fireEvent.click(within(detail).getByRole('button', { name: 'Mark Paid' }));
    await confirmPayment(view.container);
    expect(balances()).toEqual({ cash: 11015, maribank: 4000 });
  });

  it('records an already-manually-deducted release without another wallet change, including on later payment', async () => {
    cloud.rows['owner-a'].transactions = [debt()]; cloud.rows['owner-a'].meta = [meta('Test Store', 10000, 4000)];
    const view = await mount(), release = review(view.container);
    fireEvent.click(within(release).getByRole('radio', { name: /already deducted manually/ }));
    expect(receiptValue(release, 'Main Wallet change')).toBe('+₱0');
    await confirmRelease(view.container, 'already-recorded');
    expect(balances()).toEqual({ cash: 10000, maribank: 4000 });
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ utangReleased: true, utangReleaseMode: 'already-recorded', utangStatus: 'unpaid', paidAmount: 0 });
    const save = cloud.firestoreRecords.mock.calls.find(([action]) => action === 'records.save_transaction')!;
    expect(save[1].meta).toBeUndefined();
    const detail = within(view.container).getByRole('dialog', { name: 'Transaction detail' });
    fireEvent.click(within(detail).getByRole('button', { name: 'Mark Paid' })); await confirmPayment(view.container);
    expect(balances()).toEqual({ cash: 11015, maribank: 4000 });
  });

  it('uses the adopted manual-deduction baseline for later edits, delete, and Undo without removing the manual record', async () => {
    cloud.rows['owner-a'].transactions = [debt()]; cloud.rows['owner-a'].meta = [meta('Test Store', 10000, 4000)];
    const adjustment: LiveRecord = { id: 'manual-release', updatedAt: 1, value: { wallet: 'maribank', mode: 'deduct', amount: 1000, category: 'Other', note: 'Cash In already sent', date: '2026-11-17', time: '8:00 AM', createdAt: 1 } };
    cloud.rows['owner-a'].wallet_adjustments = [clone(adjustment)];
    const view = await mount(), release = review(view.container);
    fireEvent.click(within(release).getByRole('radio', { name: /already deducted manually/ }));
    expect(release.textContent).toContain('Existing manual adjustment records stay unchanged');
    await confirmRelease(view.container, 'already-recorded');
    expect(balances()).toEqual({ cash: 10000, maribank: 4000 });
    fireEvent.click(within(within(view.container).getByRole('dialog', { name: 'Transaction detail' })).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    fireEvent.change(field(form, 'Amount'), { target: { value: '1200' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(balances()).toEqual({ cash: 10000, maribank: 3800 });
    const detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    expect(detail.textContent).toContain('Deleting refunds its outgoing amount; do not also reverse that manual deduction.');
    await act(async () => { fireEvent.click(within(detail).getByRole('button', { name: 'Yes, delete' })); });
    expect(balances()).toEqual({ cash: 10000, maribank: 5000 });
    await act(async () => { fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-toast]')!).getByRole('button', { name: 'Undo' })); });
    expect(balances()).toEqual({ cash: 10000, maribank: 3800 });
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ amount: 1200, utangReleased: true, utangReleaseMode: 'already-recorded' });
    expect(cloud.rows['owner-a'].wallet_adjustments).toEqual([adjustment]);
  });

  it('deducts only the unbooked remainder when reviewing an older partially paid Utang', async () => {
    cloud.rows['owner-a'].transactions = [debt({ paidAmount: 400 })]; cloud.rows['owner-a'].meta = [meta('Test Store', 10406, 4600)];
    const view = await mount(), release = review(view.container);
    expect(receiptValue(release, 'Main Wallet change')).toBe('−₱600');
    expect(receiptValue(release, 'Cash on Hand change')).toBe('+₱0');
    await confirmRelease(view.container, 'deduct');
    expect(balances()).toEqual({ cash: 10406, maribank: 4000 });
    fireEvent.click(within(within(view.container).getByRole('dialog')).getByRole('button', { name: 'Mark Paid' }));
    await confirmPayment(view.container); expect(balances()).toEqual({ cash: 11015, maribank: 4000 });
  });

  it('rejects a stale review when another device already recorded the release', async () => {
    const old = debt(); cloud.rows['owner-a'].transactions = [old];
    const view = await mount(); review(view.container);
    await act(async () => {
      emit('transactions', [{ ...old, updatedAt: 50, value: { ...old.value, utangReleased: true } }]);
      const latest = meta('Test Store', 10000, 4000); latest.updatedAt = 50; emit('meta', [latest]);
    });
    await confirmRelease(view.container, 'deduct');
    expect(within(view.container).getByRole('alert').textContent).toContain('changed or was removed');
    expect(balances()).toEqual({ cash: 10000, maribank: 4000 });
  });

  it('requires internet for an older-record correction instead of splitting it into offline proposals', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    cloud.rows['owner-a'].transactions = [debt()];
    const view = await mount(); review(view.container);
    const calls = cloud.firestoreRecords.mock.calls.length;
    await confirmRelease(view.container, 'deduct');
    expect(within(view.container).getByRole('alert').textContent).toContain('Reconnect before reviewing');
    expect(cloud.firestoreRecords.mock.calls).toHaveLength(calls);
    expect(balances()).toEqual({ cash: 10000, maribank: 5000 });
  });

  it('preserves the release through amount edits, deletion, and Undo without erasing later wallet activity', async () => {
    cloud.rows['owner-a'].transactions = [debt({ utangReleased: true, utangReleaseRecordedAt: 1 })]; cloud.rows['owner-a'].meta = [meta('Test Store', 10000, 4000)];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    fireEvent.change(field(form, 'Amount'), { target: { value: '1200' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(balances()).toEqual({ cash: 10000, maribank: 3800 });
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ amount: 1200, utangReleased: true, utangReleaseRecordedAt: 1 });
    const editedDetail = transactionDetail(view.container);
    fireEvent.click(within(editedDetail).getByRole('button', { name: 'Delete' }));
    await act(async () => { fireEvent.click(within(editedDetail).getByRole('button', { name: 'Yes, delete' })); });
    expect(balances()).toEqual({ cash: 10000, maribank: 5000 });
    await act(async () => { const latest = meta('Test Store', 9900, 5102); latest.updatedAt = 100; emit('meta', [latest]); });
    await act(async () => { fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-toast]')!).getByRole('button', { name: 'Undo' })); });
    expect(balances()).toEqual({ cash: 9900, maribank: 3902 });
    expect(cloud.rows['owner-a'].transactions![0].value.utangReleased).toBe(true);
  });

  it('uses the actual ledger cash balance for End Day after collecting yesterday’s released Utang', async () => {
    cloud.rows['owner-a'].transactions = [debt({ date: '2026-11-17', utangReleased: true })];
    const settings = meta('Test Store', 10000, 4000); settings.value.startingFloat = 10000; settings.value.startingFloatDate = '2026-11-18';
    cloud.rows['owner-a'].meta = [settings];
    const view = await mount(); fireEvent.click(within(transactionDetail(view.container)).getByRole('button', { name: 'Mark Paid' }));
    await confirmPayment(view.container);
    fireEvent.click(within(within(view.container).getByRole('dialog', { name: 'Extra / Tip' })).getByRole('button', { name: 'No tip — finish' }));
    fireEvent.click(within(view.container).getAllByRole('button', { name: /^End Day$/ })[0]);
    const endDay = within(view.container).getByRole('dialog', { name: 'End of Day — Close Day' });
    expect([...endDay.querySelectorAll('p')].find(node => node.textContent === 'Expected Cash on Hand')?.nextElementSibling?.textContent).toBe('₱11,015');
    expect(field(endDay, 'Cash Count — Actual Cash Counted').value).toBe('11015');
    expect(endDay.textContent).toContain('Expected: ₱11,015 • Counted: ₱11,015');
  });

  it('does not infer an opening float from sale-dated history or older Utang receipts, including in the saved report', async () => {
    cloud.rows['owner-a'].transactions = [debt({ date: '2026-11-17', utangReleased: true })];
    cloud.rows['owner-a'].meta = [meta('Test Store', 10000, 4000)];
    const view = await mount();
    expect(view.container.textContent).toContain('Starting float today: Not recorded');
    fireEvent.click(within(transactionDetail(view.container)).getByRole('button', { name: 'Mark Paid' }));
    await confirmPayment(view.container);
    fireEvent.click(within(within(view.container).getByRole('dialog', { name: 'Extra / Tip' })).getByRole('button', { name: 'No tip — finish' }));
    fireEvent.click(within(view.container).getAllByRole('button', { name: /^End Day$/ })[0]);
    const endDay = within(view.container).getByRole('dialog', { name: 'End of Day — Close Day' });
    expect([...endDay.querySelectorAll('p')].find(node => node.textContent === 'Starting Float')?.nextElementSibling?.textContent).toBe('Not recorded');
    expect(endDay.textContent).toContain('Opening float was not recorded for today; it is not estimated from sale-dated records.');
    expect(field(endDay, 'Cash Count — Actual Cash Counted').value).toBe('11015');
    await act(async () => { fireEvent.click(within(endDay).getByRole('button', { name: 'Close Day & Save Report' })); });
    expect(cloud.rows['owner-a'].daily_reports![0].value).toMatchObject({ date: '2026-11-18', cash: 11015, actualCash: 11015, difference: 0, tomorrowFloat: 11015 });
    expect(cloud.rows['owner-a'].daily_reports![0].value.startingFloat).toBeUndefined();
    expect(balances()).toEqual({ cash: 11015, maribank: 4000 });
    nav(view.container, 'Dashboard');
    expect(view.container.textContent).toContain('Starting float today: Not recorded');
    nav(view.container, 'Report');
    expect(view.container.textContent).toContain('Float not recorded • Counted ₱11,015');
  });

  it.each([
    ['2026-11-17', 0, '₱0'],
    ['2026-11-17', 9000, '₱9,000'],
    ['2026-11-16', 9000, 'Not recorded'],
  ])('uses only an immediately previous close as an opening float (%s, %s)', async (date, tomorrowFloat, expected) => {
    cloud.rows['owner-a'].daily_reports = [{ id: 'previous-close', value: { date, tomorrowFloat }, updatedAt: 1 }];
    const settings = meta(); settings.value.startingFloat = 8000; settings.value.startingFloatDate = '2026-11-16';
    cloud.rows['owner-a'].meta = [settings];
    const view = await mount();
    expect(view.container.textContent).toContain(`Starting float today: ${expected}`);
    expect(cloud.firestoreRecords.mock.calls.filter(([action]) => action !== 'records.list')).toHaveLength(0);
  });

  it('confirms only the outstanding receipt when a released partial Utang is edited to upfront payment', async () => {
    cloud.rows['owner-a'].transactions = [debt({ paidAmount: 400, utangReleased: true })]; cloud.rows['owner-a'].meta = [meta('Test Store', 10406, 4000)];
    const view = await mount(), detail = transactionDetail(view.container);
    expect(receiptValue(detail, 'Customer payments recorded')).toBe('₱406 cash');
    expect(receiptValue(detail, 'Still due (principal + unpaid fee)')).toBe('₱609');
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    fireEvent.click(within(form).getByRole('radio', { name: /^Upfront payment/ }));
    expect(form.textContent).toContain('On this save: Cash on Hand +₱609 • Main Wallet +₱0');
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(receiptValue(within(view.container).getByRole('dialog'), 'Payment to confirm (no tip)')).toBe('₱609');
    await confirmPayment(view.container);
    expect(balances()).toEqual({ cash: 11015, maribank: 4000 });
  });

  it('asks for release confirmation when increasing an already-settled legacy Utang instead of deferring the added payout', async () => {
    cloud.rows['owner-a'].transactions = [debt({ utangStatus: 'paid' })]; cloud.rows['owner-a'].meta = [meta('Test Store', 11015, 4000)];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    fireEvent.change(field(form, 'Amount'), { target: { value: '1200' } });
    fireEvent.change(within(form).getByLabelText('Service fee (editable)'), { target: { value: '18' } });
    expect(form.textContent).toContain('On this save: Cash on Hand +₱0 • Main Wallet −₱200');
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(receiptValue(within(view.container).getByRole('dialog'), 'Main Wallet change')).toBe('−₱200');
    await confirmRelease(view.container);
    expect(balances()).toEqual({ cash: 11015, maribank: 3800 });
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ amount: 1200, paidAmount: 1000, utangStatus: 'unpaid', utangReleased: true });
  });

  it('keeps the record and its outgoing deduction together if a concurrent balance change rejects deletion', async () => {
    cloud.rows['owner-a'].transactions = [debt({ utangReleased: true })]; cloud.rows['owner-a'].meta = [meta('Test Store', 10000, 4000)];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    const original = cloud.firestoreRecords.getMockImplementation()!;
    cloud.firestoreRecords.mockImplementationOnce(async (...args) => {
      const latest = meta('Test Store', 10100, 3900); latest.updatedAt = 50; emit('meta', [latest]);
      return original(...args);
    });
    await act(async () => { fireEvent.click(within(detail).getByRole('button', { name: 'Yes, delete' })); });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(balances()).toEqual({ cash: 10100, maribank: 3900 });
    expect(view.container.textContent).toContain('Wallet balances changed');
    await act(async () => { fireEvent.click(within(detail).getByRole('button', { name: 'Yes, delete' })); });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(0);
    expect(balances()).toEqual({ cash: 10100, maribank: 4900 });
  });

  it('makes Undo retry-safe if the restored record committed before its response was interrupted', async () => {
    cloud.rows['owner-a'].transactions = [debt({ utangReleased: true })]; cloud.rows['owner-a'].meta = [meta('Test Store', 10000, 4000)];
    const view = await mount(), detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    await act(async () => { fireEvent.click(within(detail).getByRole('button', { name: 'Yes, delete' })); });
    const original = cloud.firestoreRecords.getMockImplementation()!;
    cloud.firestoreRecords.mockImplementationOnce(async (...args) => { await original(...args); throw new Error('Response interrupted after restore.'); });
    await act(async () => { fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-toast]')!).getByRole('button', { name: 'Undo' })); });
    expect(balances()).toEqual({ cash: 10000, maribank: 4000 });
    await act(async () => { fireEvent.click(within(view.container).getByRole('button', { name: /^Undo$/ })); });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(1);
    expect(balances()).toEqual({ cash: 10000, maribank: 4000 });
    const restores = cloud.firestoreRecords.mock.calls.filter(([action, args]) => action === 'records.save_transaction' && args.create);
    expect(restores).toHaveLength(2);
    expect(restores[0][1].id).toBe(restores[1][1].id);
  });

  it('separates recorded Cash In/Out fees from cash and counts unpaid outgoing funds in wallet summaries', async () => {
    const sent = debt({ utangReleased: true });
    const paid = { ...debt({ utang: false }), id: 'paid-in' };
    const cashOut = { ...debt({ type: 'Cash Out', amount: 500, fee: 10, utang: false }), id: 'paid-out' };
    cloud.rows['owner-a'].transactions = [sent, paid, cashOut]; cloud.rows['owner-a'].meta = [meta('Test Store', 10515, 3510)];
    const view = await mount();
    expect(view.container.textContent).toContain('Recorded sales, fees, and profit include unpaid Utang');
    nav(view.container, 'Wallets');
    const walletCards = [...view.container.querySelectorAll('article')];
    expect(walletCards.find(node => node.textContent?.includes('Main Wallet'))?.textContent).toContain('Records dated today: −₱1,490');
    expect(walletCards.find(node => node.textContent?.includes('Cash on Hand'))?.textContent).toContain('Records dated today: +₱515');
    nav(view.container, 'Utang'); expect(view.container.textContent).toContain('Outstanding ₱1,015');
  });

  it('isolates pending release reviews and balances when the signed-in account changes', async () => {
    const view = await mount(); await startDebt(view.container);
    await act(async () => { for (const observer of cloud.authObservers) observer({ uid: 'owner-b', displayName: 'Owner B' } as User); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    expect(cloud.rows['owner-a'].transactions).toHaveLength(0);
    expect(cloud.rows['owner-b'].transactions).toHaveLength(0);
    expect(balances()).toEqual({ cash: 10000, maribank: 5000 });
  });
});

// Synthetic fixtures only: no uploaded customer records or production writes.
describe('actual receiving wallet and explicit payment-wallet corrections', () => {
  const balances = () => cloud.rows['owner-a'].meta![0].value.wallets;
  const financialCalls = () => cloud.firestoreRecords.mock.calls.filter(([action]) => action === 'records.save_transaction');
  function cashOutPayment(changes: Record<string, unknown> = {}): LiveRecord {
    const row = transaction();
    return { ...row, value: { ...row.value, type: 'Cash Out', network: 'Main Wallet', selling: 0, amount: 100, fee: 1.5, tip: 18.5, tipWallet: 'maribank', payment: 'Main Wallet', utang: true, utangStatus: 'paid', paidAmount: 100, utangReleased: true, utangReleaseMode: 'deduct', utangReleaseRecordedAt: 1, paymentConfirmedAt: 2, tipRecordedAt: 3, ...changes } };
  }
  function seedPayment(row = cashOutPayment()) {
    cloud.rows['owner-a'].transactions = [row];
    cloud.rows['owner-a'].meta = [meta('Test Store', 20, 5000)];
    return row;
  }
  function correction(container: HTMLElement) {
    fireEvent.click(within(transactionDetail(container)).getByRole('button', { name: 'Correct receiving wallet' }));
    return within(container).getByRole('dialog', { name: 'Correct receiving wallet' });
  }
  async function applyCorrection(container: HTMLElement) {
    const dialog = within(container).getByRole('dialog', { name: 'Correct receiving wallet' });
    const acknowledged = within(dialog).getByRole('checkbox') as HTMLInputElement;
    if (!acknowledged.checked) fireEvent.click(acknowledged);
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm wallet correction' })); });
  }

  it.each([
    { type: 'E-Load', wallet: 'cash' },
    { type: 'Cash In', wallet: 'cash' },
    { type: 'Cash Out', wallet: 'maribank' },
  ])('shows the $type upfront default and allows a receiving-wallet choice before any save', async ({ type, wallet }) => {
    const view = await mount(), form = openSale(view.container); fillCustomer(form);
    if (type !== 'E-Load') fireEvent.click(within(form).getByRole('button', { name: type }));
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Transaction' })); });
    const receipt = within(view.container).getByRole('dialog', { name: 'Confirm payment received' });
    const select = within(receipt).getByLabelText('Payment received in') as HTMLSelectElement;
    expect(select.value).toBe(wallet);
    fireEvent.change(select, { target: { value: wallet === 'cash' ? 'maribank' : 'cash' } });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(0);
    expect(balances()).toEqual({ cash: 10000, maribank: 5000 });
    fireEvent.click(within(receipt).getByRole('button', { name: 'Back — not confirmed' }));
    expect(within(view.container).getByRole('dialog', { name: 'Add transaction' })).not.toBeNull();
    expect(financialCalls()).toHaveLength(0);
  });

  it('honors an upfront digital load payment and defaults its optional tip to that receiving wallet', async () => {
    const view = await mount();
    const receipt = await startUpfront(view.container);
    fireEvent.change(within(receipt).getByLabelText('Payment received in'), { target: { value: 'maribank' } });
    expect(receiptValue(receipt, 'Received in')).toBe('Main Wallet');
    await confirmPayment(view.container);
    expect(balances()).toEqual({ cash: 10000, maribank: 5003 });
    const tip = within(view.container).getByRole('dialog', { name: 'Extra / Tip' });
    expect((within(tip).getByLabelText('Extra received in') as HTMLSelectElement).value).toBe('maribank');
    await recordTip(view.container, '17');
    expect(balances()).toEqual({ cash: 10000, maribank: 5020 });
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ paymentAllocation: { cash: 0, maribank: 103 }, tipWallet: 'maribank', payment: 'Main Wallet' });
  });

  it('credits two cash-paid Utang collections to cash, including Cash Out, without paying either service again', async () => {
    const first = cashOutPayment({ utangStatus: 'unpaid', paidAmount: 0, tip: 0, paymentConfirmedAt: undefined, tipRecordedAt: undefined, customerName: 'Cash Out buyer', phone: '09170000001' });
    const second = { ...clone(first), id: 'second-debt', value: { ...clone(first.value), type: 'E-Load', network: 'Globe', selling: 100, customerName: 'Load buyer', phone: '09170000002', tipWallet: 'cash', createdAt: 2 } };
    cloud.rows['owner-a'].transactions = [first, second];
    cloud.rows['owner-a'].customers = [first, second].map(row => ({ ...clone(customer), id: `customer-${row.id}`, value: { ...clone(customer.value), name: row.value.customerName, phone: row.value.phone } }));
    cloud.rows['owner-a'].meta = [meta('Test Store', -100, 4880)];
    const view = await mount();
    for (const name of ['Cash Out buyer', 'Load buyer']) {
      nav(view.container, 'Transactions');
      const row = [...view.container.querySelectorAll('.tx-table tbody tr')].find(tr => tr.textContent?.includes(name))!;
      fireEvent.click(row);
      fireEvent.click(within(within(view.container).getByRole('dialog')).getByRole('button', { name: 'Mark Paid' }));
      const receipt = within(view.container).getByRole('dialog', { name: 'Confirm payment received' });
      expect((within(receipt).getByLabelText('Payment received in') as HTMLSelectElement).value).toBe('cash');
      expect(receiptValue(receipt, 'Payment to confirm (no tip)')).toBe('₱101.50');
      await confirmPayment(view.container);
      const tip = within(view.container).getByRole('dialog', { name: 'Extra / Tip' });
      expect((within(tip).getByLabelText('Extra received in') as HTMLSelectElement).value).toBe('cash');
      await recordTip(view.container, '18.5');
    }
    expect(balances()).toEqual({ cash: 140, maribank: 4880 });
    expect(cloud.rows['owner-a'].transactions).toHaveLength(2);
    expect(cloud.rows['owner-a'].transactions!.every(row => row.value.utangStatus === 'paid' && row.value.paidAmount === 100)).toBe(true);
  });

  it('preserves earlier partial destinations when a later collection is received elsewhere', async () => {
    const partial = cashOutPayment({ utangStatus: 'unpaid', paidAmount: 40, fee: 3, tip: 0, paymentConfirmedAt: undefined });
    cloud.rows['owner-a'].transactions = [partial];
    cloud.rows['owner-a'].meta = [meta('Test Store', 9900, 5041.2)];
    const view = await mount();
    fireEvent.click(within(transactionDetail(view.container)).getByRole('button', { name: 'Mark Paid' }));
    await confirmPayment(view.container);
    expect(balances()).toEqual({ cash: 9961.8, maribank: 5041.2 });
    expect(cloud.rows['owner-a'].transactions![0].value.paymentAllocation).toEqual({ cash: 61.8, maribank: 41.2 });
    await recordTip(view.container, '17');
    expect(balances()).toEqual({ cash: 9978.8, maribank: 5041.2 });
    const detail = transactionDetail(view.container);
    expect(receiptValue(detail, 'Regular payment')).toBe('Cash + Main Wallet');
    expect(receiptValue(detail, 'Customer payments recorded')).toBe('₱78.80 cash + ₱41.20 via Main Wallet');
  });

  it.each([
    { oldType: 'Cash Out', newType: 'E-Load', oldFee: 1.5, expectedReceipt: '₱62.40', expectedAllocation: { cash: 62.4, maribank: 40.6 } },
    { oldType: 'E-Load', newType: 'Cash Out', oldFee: 3, expectedReceipt: '₱60.80', expectedAllocation: { cash: 102, maribank: 0 } },
  ])('previews only the remaining collection when a partial $oldType is edited to upfront $newType', async row => {
    seedPayment(cashOutPayment({ type: row.oldType, network: row.oldType === 'E-Load' ? 'Globe' : 'Main Wallet', selling: row.oldType === 'E-Load' ? 100 : 0, fee: row.oldFee, utangStatus: 'unpaid', paidAmount: 40, tip: 0 }));
    const view = await mount();
    fireEvent.click(within(transactionDetail(view.container)).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    fireEvent.click(within(form).getByRole('button', { name: new RegExp(`^${row.newType}$`) }));
    fireEvent.click(within(form).getByRole('radio', { name: /^Upfront payment/ }));
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    const receipt = within(view.container).getByRole('dialog', { name: 'Confirm payment received' });
    expect(receiptValue(receipt, 'Principal paid now')).toBe('₱60');
    expect(receiptValue(receipt, 'Payment to confirm (no tip)')).toBe(row.expectedReceipt);
    expect((within(receipt).getByLabelText('Payment received in') as HTMLSelectElement).value).toBe('cash');
    await confirmPayment(view.container);
    expect(cloud.rows['owner-a'].transactions![0].value.paymentAllocation).toEqual(row.expectedAllocation);
  });

  it('does not reroute a fully collected legacy Utang when closing its zero remaining principal', async () => {
    const legacy = cashOutPayment({ utangStatus: 'unpaid', paidAmount: 100, tip: 0, paymentConfirmedAt: undefined });
    seedPayment(legacy);
    const view = await mount();
    fireEvent.click(within(transactionDetail(view.container)).getByRole('button', { name: 'Mark Paid' }));
    const receipt = within(view.container).getByRole('dialog', { name: 'Confirm payment received' });
    expect((within(receipt).getByLabelText('Payment received in') as HTMLSelectElement).disabled).toBe(true);
    await confirmPayment(view.container);
    expect(balances()).toEqual({ cash: 20, maribank: 5000 });
    expect(cloud.rows['owner-a'].transactions![0].value.paymentAllocation).toEqual({ cash: 0, maribank: 101.5 });
  });

  it.each(['Cancel', 'Escape', 'Close'])('keeps legacy wallets and records unchanged when a correction is abandoned with %s', async method => {
    seedPayment(); const view = await mount(), before = clone(cloud.rows['owner-a']);
    const dialog = correction(view.container);
    expect(receiptValue(dialog, 'Cash on Hand change')).toBe('+₱120');
    expect(receiptValue(dialog, 'Main Wallet change')).toBe('−₱120');
    expect(within(dialog).getByRole('button', { name: 'Confirm wallet correction' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true }); fireEvent.keyDown(window, { key: '1' }); fireEvent.keyDown(window, { key: 'h' });
    expect(within(view.container).getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    if (method === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else fireEvent.click(within(dialog).getByRole('button', { name: method === 'Cancel' ? 'Cancel — keep recorded wallets' : 'Close' }));
    expect(within(view.container).getByRole('dialog', { name: 'Transaction detail' })).not.toBeNull();
    expect(cloud.rows['owner-a']).toEqual(before);
    expect(financialCalls()).toHaveLength(0);
  });

  it('requires explicit acknowledgment and moves exactly the recorded 120 including its tip, with an audit entry', async () => {
    const old = seedPayment(); const view = await mount(), dialog = correction(view.container);
    expect(receiptValue(dialog, 'Currently recorded receipts')).toBe('₱120 via Main Wallet');
    expect(receiptValue(dialog, 'Total already collected (including tip)')).toBe('₱120');
    expect(receiptValue(dialog, 'Cash after correction')).toBe('₱140');
    expect(receiptValue(dialog, 'Main after correction')).toBe('₱4,880');
    expect(cloud.rows['owner-a'].transactions![0]).toEqual(old);
    await applyCorrection(view.container);
    expect(balances()).toEqual({ cash: 140, maribank: 4880 });
    const row = cloud.rows['owner-a'].transactions![0];
    expect(row.id).toBe(old.id);
    expect(row.value).toMatchObject({ ...old.value, tipWallet: 'cash', payment: 'Cash', paymentAllocation: { cash: 101.5, maribank: 0 } });
    expect(row.value.paymentWalletCorrections).toEqual([{ from: { cash: 0, maribank: 120 }, to: { cash: 120, maribank: 0 }, recordedAt: Date.now() }]);
    expect(financialCalls()).toHaveLength(1);
    expect(financialCalls()[0][1]).toMatchObject({ id: old.id, create: false, expectedUpdatedAt: 1, requireOnline: true, meta: { expectedUpdatedAt: 1 } });
    const detail = within(view.container).getByRole('dialog', { name: 'Transaction detail' });
    expect(receiptValue(detail, 'Customer payments recorded')).toBe('₱120 cash');
    expect(within(detail).queryByRole('button', { name: 'Mark Paid' })).toBeNull();
    fireEvent.click(within(detail).getByRole('button', { name: 'Correct receiving wallet' }));
    const repeat = within(view.container).getByRole('dialog', { name: 'Correct receiving wallet' });
    expect(within(repeat).getByRole('button', { name: 'Confirm wallet correction' }).hasAttribute('disabled')).toBe(true);
    expect(receiptValue(repeat, 'Cash on Hand change')).toBe('+₱0');
    expect(financialCalls()).toHaveLength(1);
  });

  it('requires a fresh acknowledgment when the destination changes and can reverse a correction', async () => {
    seedPayment(); const view = await mount(); correction(view.container); await applyCorrection(view.container);
    fireEvent.click(within(within(view.container).getByRole('dialog')).getByRole('button', { name: 'Correct receiving wallet' }));
    const dialog = within(view.container).getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Actual receiving wallet'), { target: { value: 'maribank' } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.change(within(dialog).getByLabelText('Actual receiving wallet'), { target: { value: 'cash' } });
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    fireEvent.change(within(dialog).getByLabelText('Actual receiving wallet'), { target: { value: 'maribank' } });
    expect(receiptValue(dialog, 'Cash on Hand change')).toBe('−₱120');
    await applyCorrection(view.container);
    expect(balances()).toEqual({ cash: 20, maribank: 5000 });
    expect(cloud.rows['owner-a'].transactions![0].value.paymentWalletCorrections).toHaveLength(2);
  });

  it('moves only the wrong leg if the recorded tip was already received in cash', async () => {
    seedPayment(cashOutPayment({ tipWallet: 'cash' }));
    const view = await mount(), dialog = correction(view.container);
    expect(receiptValue(dialog, 'Cash on Hand change')).toBe('+₱101.50');
    expect(receiptValue(dialog, 'Main Wallet change')).toBe('−₱101.50');
    await applyCorrection(view.container);
    expect(balances()).toEqual({ cash: 121.5, maribank: 4898.5 });
  });

  it('preserves a corrected receipt through ordinary note edits, delete, and Undo', async () => {
    seedPayment(); const view = await mount(); correction(view.container); await applyCorrection(view.container);
    fireEvent.click(within(within(view.container).getByRole('dialog')).getByRole('button', { name: 'Edit' }));
    const form = within(view.container).getByRole('dialog', { name: 'Edit transaction' });
    fireEvent.change(field(form, 'Notes'), { target: { value: 'Only a note after correcting the wallet' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save Changes' })); });
    expect(balances()).toEqual({ cash: 140, maribank: 4880 });
    expect(cloud.rows['owner-a'].transactions![0].value.paymentAllocation).toEqual({ cash: 101.5, maribank: 0 });
    expect(cloud.rows['owner-a'].transactions![0].value.paymentWalletCorrections).toHaveLength(1);
    const detail = transactionDetail(view.container);
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    await act(async () => { fireEvent.click(within(detail).getByRole('button', { name: 'Yes, delete' })); });
    expect(balances()).toEqual({ cash: 120, maribank: 4880 });
    await act(async () => { fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-toast]')!).getByRole('button', { name: 'Undo' })); });
    expect(balances()).toEqual({ cash: 140, maribank: 4880 });
    expect(cloud.rows['owner-a'].transactions![0].value.paymentAllocation).toEqual({ cash: 101.5, maribank: 0 });
    expect(cloud.rows['owner-a'].transactions![0].value.paymentWalletCorrections).toHaveLength(1);
  });

  it('keeps both wallets unchanged if the reviewed payment changes on another device', async () => {
    const old = seedPayment(); const view = await mount(), dialog = correction(view.container);
    await act(async () => { emit('transactions', [{ ...old, updatedAt: 50, value: { ...old.value, notes: 'Changed elsewhere' } }]); });
    await applyCorrection(view.container);
    expect(within(dialog).getByRole('alert').textContent).toContain('changed or was removed');
    expect(balances()).toEqual({ cash: 20, maribank: 5000 });
    expect(cloud.rows['owner-a'].transactions![0].value.paymentWalletCorrections).toBeUndefined();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Reload latest records' })); });
    const detail = within(view.container).getByRole('dialog', { name: 'Transaction detail' });
    expect(receiptValue(detail, 'Notes')).toBe('Changed elsewhere');
    fireEvent.click(within(detail).getByRole('button', { name: 'Correct receiving wallet' }));
    await applyCorrection(view.container);
    expect(balances()).toEqual({ cash: 140, maribank: 4880 });
  });

  it('rejects a concurrent wallet change atomically and retries the correction using latest balances', async () => {
    seedPayment(); const view = await mount(); correction(view.container);
    const original = cloud.firestoreRecords.getMockImplementation()!;
    cloud.firestoreRecords.mockImplementationOnce(async (...args) => {
      const latest = meta('Test Store', 5000, 7000); latest.updatedAt = 50; emit('meta', [latest]);
      return original(...args);
    });
    await applyCorrection(view.container);
    expect(within(view.container).getByRole('alert').textContent).toContain('Wallet balances changed');
    expect(balances()).toEqual({ cash: 5000, maribank: 7000 });
    expect(cloud.rows['owner-a'].transactions![0].value.paymentAllocation).toBeUndefined();
    await applyCorrection(view.container);
    expect(balances()).toEqual({ cash: 5120, maribank: 6880 });
    expect(cloud.rows['owner-a'].transactions![0].value.paymentWalletCorrections).toHaveLength(1);
  });

  it('does not repeat a completed correction if its response was interrupted', async () => {
    seedPayment(); const view = await mount(); correction(view.container);
    const original = cloud.firestoreRecords.getMockImplementation()!;
    cloud.firestoreRecords.mockImplementationOnce(async (...args) => { await original(...args); throw new Error('Interrupted response'); });
    await applyCorrection(view.container);
    expect(balances()).toEqual({ cash: 140, maribank: 4880 });
    await applyCorrection(view.container);
    expect(within(view.container).getByRole('alert').textContent).toContain('changed or was removed');
    expect(balances()).toEqual({ cash: 140, maribank: 4880 });
    expect(cloud.rows['owner-a'].transactions![0].value.paymentWalletCorrections).toHaveLength(1);
  });

  it('requires internet for a correction and never queues half of the wallet movement offline', async () => {
    seedPayment(); const view = await mount(), dialog = correction(view.container);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const calls = financialCalls().length;
    await applyCorrection(view.container);
    expect(within(dialog).getByRole('alert').textContent).toContain('Reconnect before correcting');
    expect(financialCalls()).toHaveLength(calls);
    expect(balances()).toEqual({ cash: 20, maribank: 5000 });
  });

  it('prevents double clicks and dismissal while the correction write is in flight', async () => {
    seedPayment(); const view = await mount(), dialog = correction(view.container);
    const original = cloud.firestoreRecords.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    cloud.firestoreRecords.mockImplementationOnce(async (...args) => { await gate; return original(...args); });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    const button = within(dialog).getByRole('button', { name: 'Confirm wallet correction' });
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    expect(within(dialog).getByRole('button', { name: 'Correcting…' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' }); fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(within(view.container).getByRole('dialog', { name: 'Correct receiving wallet' })).not.toBeNull();
    await act(async () => { release(); });
    expect(financialCalls()).toHaveLength(1);
    expect(balances()).toEqual({ cash: 140, maribank: 4880 });
  });

  it('clears a correction draft when switching accounts without applying it to either account', async () => {
    seedPayment(); const view = await mount(), dialog = correction(view.container);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await act(async () => { for (const observer of cloud.authObservers) observer({ uid: 'owner-b', displayName: 'Owner B' } as User); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    expect(financialCalls()).toHaveLength(0);
    expect(balances()).toEqual({ cash: 20, maribank: 5000 });
    expect(cloud.rows['owner-b'].meta![0].value.wallets).toEqual({ cash: 200, maribank: 300 });
  });

  it.each([
    { type: 'Cash Out', utangStatus: 'unpaid', paidAmount: 0, tip: 0 },
    { type: 'Top-Up', utang: false, tip: 0 },
  ])('does not offer a receipt correction for $type with no collected customer payment', async changes => {
    seedPayment(cashOutPayment(changes));
    const view = await mount(), detail = transactionDetail(view.container);
    expect(within(detail).queryByRole('button', { name: 'Correct receiving wallet' })).toBeNull();
  });

  it.each([
    'invalid history',
    [null, {}, { from: { cash: 0, maribank: 120 }, to: { cash: 120, maribank: 0 }, recordedAt: Infinity }, { from: { cash: 0, maribank: 120 }, to: { cash: 20, maribank: 0 }, recordedAt: 1 }],
  ])('ignores malformed imported correction history without changing stored records or balances: %j', async history => {
    const old = seedPayment(cashOutPayment({ paymentWalletCorrections: history }));
    const view = await mount(), dialog = correction(view.container);
    expect(receiptValue(dialog, 'Cash on Hand change')).toBe('+₱120');
    expect(financialCalls()).toHaveLength(0);
    expect(cloud.rows['owner-a'].transactions![0]).toEqual(old);
    expect(balances()).toEqual({ cash: 20, maribank: 5000 });
    await applyCorrection(view.container);
    expect(cloud.rows['owner-a'].transactions![0].value.paymentWalletCorrections).toHaveLength(1);
    expect(balances()).toEqual({ cash: 140, maribank: 4880 });
  });

  it('exports actual wallet allocations and correction timestamps in CSV and the full backup', async () => {
    seedPayment();
    cloud.rows['owner-a'].wallet_adjustments = [{ id: 'old-adjustment', value: { wallet: 'cash', mode: 'add', amount: 10, category: 'Balance correction', note: '', date: '2026-11-17', time: '8:00 AM', createdAt: 1 } }];
    const view = await mount(); correction(view.container); await applyCorrection(view.container);
    fireEvent.click(within(within(view.container).getByRole('dialog')).getByRole('button', { name: 'Close' }));
    const downloads: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { if (blob instanceof Blob) downloads.push(blob); return 'blob:test-export'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    nav(view.container, 'Settings');
    fireEvent.click(within(view.container).getByRole('button', { name: 'Export CSV — All Transactions' }));
    const csv = await downloads[0].text();
    const lines = csv.split('\n').map(line => line.slice(1, -1).split('","'));
    const headers = lines[0], row = lines[1];
    expect(row).toHaveLength(headers.length);
    expect(lines[2]).toHaveLength(headers.length);
    expect(lines[2][1]).toBe('Wallet Addition');
    expect(row[headers.indexOf('Cash receipts recorded')]).toBe('120');
    expect(row[headers.indexOf('Main Wallet receipts recorded')]).toBe('0');
    expect(row[headers.indexOf('Payment wallet corrected at')]).toBe(new Date().toISOString());
    fireEvent.click(within(view.container).getByRole('button', { name: 'Download full backup' }));
    const backup = JSON.parse(await downloads[1].text());
    expect(backup.collections.transactions[0].value.paymentAllocation).toEqual({ cash: 101.5, maribank: 0 });
    expect(backup.collections.transactions[0].value.paymentWalletCorrections).toHaveLength(1);
    expect(backup.settings.wallets).toEqual({ cash: 140, maribank: 4880 });
  });
});
