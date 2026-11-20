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


function fillCustomer(form: HTMLElement) {
  fireEvent.change(form.querySelector('[data-customer-input]')!, { target: { value: 'Ada Test 09171234567' } });
}
async function confirmPayment(container: HTMLElement) {
  const receipt = within(container).getByRole('dialog', { name: 'Confirm payment received' });
  await act(async () => { fireEvent.click(within(receipt).getByRole('button', { name: 'Confirm payment received' })); });
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
    if (action === 'records.save_transaction') {
      const metadata = cloud.rows[user.uid].meta || [], currentMeta = metadata.find(row => row.id === args.meta?.id);
      if (args.create && existing) return { record: { ...clone(existing), skipped: true }, meta: currentMeta ? clone(currentMeta) : undefined };
      if (!args.create && (!existing || existing.updatedAt !== args.expectedUpdatedAt)) throw new Error('This record changed or was removed on another device. Reload records and review the latest version before saving.');
      if (args.meta && (!currentMeta || currentMeta.updatedAt !== args.meta.expectedUpdatedAt)) throw new Error('Wallet balances changed on another device. No payment or tip changes were saved. Review the latest balances and try again.');
      const record = { id: args.id, value: clone(args.value), updatedAt: ++cloud.version };
      const savedMeta = args.meta ? { id: args.meta.id, value: clone(args.meta.value), updatedAt: ++cloud.version } : undefined;
      emit(name, [record, ...rows.filter(item => item.id !== record.id)], user.uid);
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
  cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  localStorage.clear();
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
    expect(within(view.container).queryByRole('dialog')).toBeNull();
    expect(cloud.rows['owner-a'].transactions![0].value).toMatchObject({ utang: true, utangStatus: 'unpaid', paidAmount: 0, tip: 0, promiseDate: '2026-11-19' });
    expect(cloud.rows['owner-a'].meta![0].value.wallets).toEqual({ cash: 10000, maribank: 5000 });
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
