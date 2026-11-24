import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  onSnapshot: vi.fn(), getDocs: vi.fn(), waitForPendingWrites: vi.fn(), runTransaction: vi.fn(),
  doc: vi.fn(), getDocFromCache: vi.fn(), getDocsFromCache: vi.fn(), setDoc: vi.fn(), deleteDoc: vi.fn(),
}));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}), GoogleAuthProvider: class {}, signInWithPopup: vi.fn(), onAuthStateChanged: vi.fn(), signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  initializeFirestore: () => ({}), getFirestore: () => ({}),
  persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  doc: sdk.doc, getDoc: vi.fn(), getDocFromCache: sdk.getDocFromCache, getDocs: sdk.getDocs, getDocsFromCache: sdk.getDocsFromCache,
  setDoc: sdk.setDoc, deleteDoc: sdk.deleteDoc, onSnapshot: sdk.onSnapshot,
  waitForPendingWrites: sdk.waitForPendingWrites, runTransaction: sdk.runTransaction,
}));

import { firestoreRecords, subscribeToUserRecords, syncUserRecords, type User } from './firebase';
import { overlayOfflineMutations, type OfflineMutation } from './offlineSync';
import { liveSources, type LiveRecordCallbacks } from './liveRecords';

const owner = { uid: 'test-owner-a' } as User;
const callbacks = (): LiveRecordCallbacks => ({ onRecords: vi.fn(), onStatus: vi.fn(), onError: vi.fn() });
const snapshot = (rows: { id: string; data: unknown }[] = [], fromCache = false, hasPendingWrites = false) => ({
  docs: rows.map(row => ({ id: row.id, data: () => row.data })), metadata: { fromCache, hasPendingWrites },
});

describe('Firestore live subscription adapter', () => {
  let listeners: { path: string; next: (value: ReturnType<typeof snapshot>) => void; error: (error: Error) => void; stop: ReturnType<typeof vi.fn> }[];
  afterEach(() => { vi.unstubAllGlobals(); });
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
    vi.clearAllMocks();
    listeners = [];
    sdk.getDocs.mockResolvedValue({ docs: [] });
    sdk.waitForPendingWrites.mockResolvedValue(undefined);
    sdk.onSnapshot.mockImplementation((ref, options, next, error) => {
      expect(options).toEqual({ includeMetadataChanges: true });
      const stop = vi.fn(); listeners.push({ path: ref.path, next, error, stop }); return stop;
    });
  });

  it('scopes every listener to the signed-in account and never watches shared/global records', () => {
    const stop = subscribeToUserRecords(owner, callbacks());
    expect(listeners.map(row => row.path)).toEqual(liveSources.map(name => name === 'offline_mutations'
      ? 'users/test-owner-a/offline_mutations' : `users/test-owner-a/data/${name}/records`));
    expect(sdk.onSnapshot).toHaveBeenCalledTimes(7);
    stop();
    expect(listeners.every(row => row.stop.mock.calls.length === 1)).toBe(true);
    expect(sdk.getDocs).not.toHaveBeenCalled();
  });

  it('delivers SDK record changes and metadata directly, without requiring a records.list call', () => {
    const cb = callbacks();
    const stop = subscribeToUserRecords(owner, cb);
    const queue = listeners.find(row => row.path.endsWith('offline_mutations'))!;
    const transactions = listeners.find(row => row.path.endsWith('transactions/records'))!;
    queue.next(snapshot());
    transactions.next(snapshot([{ id: 'tx-1', data: { value: { amount: 100, fee: 3, tip: 17 }, updatedAt: 2 } }]));
    expect(cb.onRecords).toHaveBeenLastCalledWith('transactions', [{ id: 'tx-1', value: { amount: 100, fee: 3, tip: 17 }, updatedAt: 2 }]);
    transactions.next(snapshot());
    expect(cb.onRecords).toHaveBeenLastCalledWith('transactions', []);
    expect(sdk.getDocs).not.toHaveBeenCalled();
    stop();
  });

  it('does not deliver late snapshots from a signed-out account to a new session', () => {
    const first = callbacks();
    const stop = subscribeToUserRecords(owner, first);
    const old = [...listeners]; stop();
    const second = callbacks();
    const stopSecond = subscribeToUserRecords({ uid: 'test-owner-b' } as User, second);
    for (const row of old) row.next(snapshot([{ id: 'private-row', data: { value: { amount: 999 } } }]));
    expect(first.onRecords).not.toHaveBeenCalled();
    expect(second.onRecords).not.toHaveBeenCalled();
    expect(listeners.slice(7).every(row => row.path.startsWith('users/test-owner-b/'))).toBe(true);
    stopSecond();
  });

  it('forwards listener errors while leaving the last records available for the app', () => {
    const cb = callbacks();
    const stop = subscribeToUserRecords(owner, cb);
    listeners[0].error(new Error('Connection needs attention'));
    expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'transactions: Connection needs attention' }));
    expect(cb.onStatus).toHaveBeenLastCalledWith({ connected: false, hasPendingWrites: false });
    stop();
  });

  it('coalesces overlapping reconnect/queue checks instead of applying proposals in parallel', async () => {
    let release!: (value: { docs: never[] }) => void;
    sdk.getDocs.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = syncUserRecords(owner), second = syncUserRecords(owner), third = syncUserRecords(owner);
    await vi.waitFor(() => expect(sdk.getDocs).toHaveBeenCalledTimes(1));
    release({ docs: [] });
    await Promise.all([first, second, third]);
    // One in-flight pass plus one follow-up pass for all requests that arrived during it.
    expect(sdk.getDocs).toHaveBeenCalledTimes(2);
    expect(sdk.runTransaction).not.toHaveBeenCalled();
  });
});


describe('payment and tip financial saves', () => {
  type Ref = { id: string; path: string };
  const prefix = 'users/test-owner-a';
  const txPath = `${prefix}/data/transactions/records/payment-1`;
  const metaPath = `${prefix}/data/meta/records/settings`;
  const transaction = { type: 'E-Load', amount: 100, selling: 100, fee: 3, tip: 0, tipWallet: 'cash' };
  const settings = { kind: 'meta', wallets: { cash: 1000, maribank: 500 } };
  let store: Map<string, any>, writes: { ref: Ref; value?: any; deleted?: boolean }[], ids: number;
  const clone = <T,>(value: T): T => structuredClone(value);
  const read = (ref: Ref) => ({ ref, id: ref.id, exists: () => store.has(ref.path), data: () => clone(store.get(ref.path)) });
  const collectionRows = (ref: Ref) => ({ docs: [...store.keys()].filter(path => path.startsWith(`${ref.path}/`)).map(path => read({ path, id: path.split('/').pop()! })) });
  function args(create = true, tip = 0, expectedUpdatedAt?: number, expectedMetaVersion = 3) {
    return { collection: 'transactions', id: 'payment-1', create, value: { ...transaction, tip, optional: undefined }, expectedUpdatedAt,
      meta: { id: 'settings', expectedUpdatedAt: expectedMetaVersion, value: { ...settings, wallets: { cash: 1103 + tip, maribank: 400 } } } };
  }
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubGlobal('navigator', { onLine: true });
    store = new Map([[metaPath, { value: clone(settings), updatedAt: 3 }]]); writes = []; ids = 0;
    sdk.doc.mockImplementation((parent: Ref, ...parts: string[]) => {
      const path = parent.path ? [parent.path, ...parts, ...(!parts.length ? [`generated-${++ids}`] : [])].join('/') : parts.join('/');
      return { path, id: path.split('/').pop()! };
    });
    sdk.getDocFromCache.mockImplementation(async ref => read(ref));
    sdk.getDocsFromCache.mockImplementation(async ref => collectionRows(ref));
    sdk.getDocs.mockImplementation(async ref => collectionRows(ref));
    sdk.setDoc.mockImplementation(async (ref, value) => { store.set(ref.path, clone(value)); });
    sdk.waitForPendingWrites.mockResolvedValue(undefined);
    sdk.runTransaction.mockImplementation(async (_db, callback) => {
      const staged: typeof writes = [];
      const result = await callback({
        get: async (ref: Ref) => read(ref),
        set: (ref: Ref, value: any) => { staged.push({ ref, value }); },
        delete: (ref: Ref) => { staged.push({ ref, deleted: true }); },
      });
      // Like the SDK, a throwing callback applies none of its staged writes.
      for (const item of staged) {
        if (item.deleted) store.delete(item.ref.path);
        else store.set(item.ref.path, clone(item.value));
      }
      writes.push(...staged); return result;
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('saves an owner-confirmed payment and its wallets together in one account-scoped transaction', async () => {
    const result = await firestoreRecords('records.save_transaction', args(), owner);
    expect(sdk.runTransaction).toHaveBeenCalledTimes(1);
    expect(writes.map(item => item.ref.path)).toEqual([txPath, metaPath]);
    expect(result.record.value).toEqual(transaction);
    expect(result.meta.value.wallets).toEqual({ cash: 1103, maribank: 400 });
    expect(store.get(txPath).value).not.toHaveProperty('optional');
    expect(sdk.setDoc).not.toHaveBeenCalled();
  });

  it('leaves no paid transaction behind when the wallet revision conflicts', async () => {
    await expect(firestoreRecords('records.save_transaction', args(true, 0, undefined, 2), owner)).rejects.toThrow(/Wallet balances changed/);
    expect(store.has(txPath)).toBe(false);
    expect(store.get(metaPath)).toEqual({ value: settings, updatedAt: 3 });
    expect(writes).toEqual([]);
  });

  it('rejects a stale tip or payment without touching either document', async () => {
    store.set(txPath, { value: transaction, updatedAt: 7 });
    await expect(firestoreRecords('records.save_transaction', args(false, 17, 6), owner)).rejects.toThrow(/changed or was removed/);
    expect(store.get(txPath)).toEqual({ value: transaction, updatedAt: 7 });
    expect(store.get(metaPath)).toEqual({ value: settings, updatedAt: 3 });
    expect(writes).toEqual([]);
  });

  it('does not duplicate payment or wallets if a create is retried after it already committed', async () => {
    const first = await firestoreRecords('records.save_transaction', args(), owner);
    const writesBeforeRetry = writes.length;
    const result = await firestoreRecords('records.save_transaction', args(), owner);
    expect(result.record).toEqual({ ...first.record, skipped: true });
    expect(writes).toHaveLength(writesBeforeRetry);
    expect(store.get(metaPath).value.wallets).toEqual({ cash: 1103, maribank: 400 });
  });

  it('commits the tip separately, preserving the confirmed payment and rejecting repeat stale submissions', async () => {
    const paid = await firestoreRecords('records.save_transaction', args(), owner);
    const tipped = await firestoreRecords('records.save_transaction', args(false, 17, paid.record.updatedAt, paid.meta.updatedAt), owner);
    expect(tipped.record.value).toEqual({ ...transaction, tip: 17 });
    expect(tipped.meta.value.wallets).toEqual({ cash: 1120, maribank: 400 });
    const count = writes.length;
    await expect(firestoreRecords('records.save_transaction', args(false, 17, paid.record.updatedAt, paid.meta.updatedAt), owner)).rejects.toThrow(/changed or was removed/);
    expect(writes).toHaveLength(count);
  });

  it('persists a confirmed release and its outgoing debit atomically, without a customer receipt', async () => {
    const payload = { ...args(), value: { ...transaction, type: 'Cash In', amount: 1000, selling: 0, fee: 15, utang: true, utangStatus: 'unpaid', paidAmount: 0, utangReleased: true },
      meta: { ...args().meta, value: { ...settings, wallets: { cash: 1000, maribank: -500 } } } };
    const result = await firestoreRecords('records.save_transaction', payload, owner);
    expect(result.record.value).toMatchObject({ utangStatus: 'unpaid', paidAmount: 0, utangReleased: true });
    expect(result.meta.value.wallets).toEqual({ cash: 1000, maribank: -500 });
    expect(writes.map(item => item.ref.path)).toEqual([txPath, metaPath]);
    expect(sdk.setDoc).not.toHaveBeenCalled();
  });

  it('deletes a transaction and reverses its balances together, never as two cloud writes', async () => {
    store.set(txPath, { value: { ...transaction, utang: true, utangStatus: 'unpaid', utangReleased: true }, updatedAt: 7 });
    const payload = { collection: 'transactions', id: 'payment-1', expectedUpdatedAt: 7,
      meta: { id: 'settings', expectedUpdatedAt: 3, value: { ...settings, wallets: { cash: 1000, maribank: 600 } } } };
    await firestoreRecords('records.delete_transaction', payload, owner);
    expect(store.has(txPath)).toBe(false);
    expect(store.get(metaPath).value.wallets).toEqual({ cash: 1000, maribank: 600 });
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({ ref: { path: txPath }, deleted: true });
    expect(sdk.deleteDoc).not.toHaveBeenCalled();
    expect(sdk.setDoc).not.toHaveBeenCalled();
  });

  it.each(['wallet', 'record'])('keeps both the record and wallets unchanged when deleting conflicts on the %s revision', async changed => {
    store.set(txPath, { value: transaction, updatedAt: 7 });
    const before = clone([...store.entries()]);
    await expect(firestoreRecords('records.delete_transaction', { collection: 'transactions', id: 'payment-1', expectedUpdatedAt: changed === 'record' ? 6 : 7,
      meta: { id: 'settings', expectedUpdatedAt: changed === 'wallet' ? 2 : 3, value: settings } }, owner)).rejects.toThrow(/changed/);
    expect([...store.entries()]).toEqual(before);
    expect(writes).toEqual([]);
  });

  it('does not reverse a completed deletion again on retry, including after unrelated wallet activity', async () => {
    const updatedSettings = { ...settings, wallets: { cash: 900, maribank: 800 } };
    store.set(metaPath, { value: updatedSettings, updatedAt: 10 });
    const result = await firestoreRecords('records.delete_transaction', { collection: 'transactions', id: 'payment-1', expectedUpdatedAt: 7,
      meta: { id: 'settings', expectedUpdatedAt: 3, value: settings } }, owner);
    expect(result.record.skipped).toBe(true);
    expect(result.meta).toMatchObject({ updatedAt: 10, value: updatedSettings });
    expect(store.get(metaPath)).toEqual({ value: updatedSettings, updatedAt: 10 });
    expect(writes).toEqual([]);
  });

  it('preserves the release marker in new offline entries and queues their wallet proposal against the original balance revision', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const payload = { ...args(), value: { ...transaction, utang: true, utangStatus: 'unpaid', paidAmount: 0, utangReleased: true },
      meta: { ...args().meta, value: { ...settings, wallets: { cash: 1000, maribank: 400 } } } };
    await firestoreRecords('records.save_transaction', payload, owner);
    const operations = [...store.entries()].filter(([path]) => path.includes('/offline_mutations/')).map(([, value]) => value);
    expect(store.get(txPath).value).toMatchObject({ utangReleased: true, utangStatus: 'unpaid', paidAmount: 0 });
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ collection: 'meta', recordId: 'settings', expectedUpdatedAt: 3, value: { wallets: { cash: 1000, maribank: 400 } } });
    expect(sdk.runTransaction).not.toHaveBeenCalled();
  });

  it('retains offline deletion and its reversal as proposals at the original revisions', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const debt = { ...transaction, utang: true, utangStatus: 'unpaid', utangReleased: true };
    store.set(txPath, { value: debt, updatedAt: 7 });
    await firestoreRecords('records.delete_transaction', { collection: 'transactions', id: 'payment-1', expectedUpdatedAt: 7,
      meta: { id: 'settings', expectedUpdatedAt: 3, value: { ...settings, wallets: { cash: 1000, maribank: 600 } } } }, owner);
    const operations = [...store.entries()].filter(([path]) => path.includes('/offline_mutations/')).map(([path, data]) => ({ ...data, id: path.split('/').pop()! })) as OfflineMutation[];
    expect(operations).toHaveLength(2);
    expect(operations.find(item => item.collection === 'transactions')).toMatchObject({ action: 'delete', recordId: 'payment-1', expectedUpdatedAt: 7 });
    expect(operations.find(item => item.collection === 'meta')).toMatchObject({ action: 'replace', recordId: 'settings', expectedUpdatedAt: 3 });
    expect(overlayOfflineMutations([{ id: 'payment-1', value: debt, updatedAt: 7 }], operations, 'transactions')).toEqual([]);
    expect(store.get(txPath)).toEqual({ value: debt, updatedAt: 7 });
    expect(sdk.runTransaction).not.toHaveBeenCalled();
    expect(sdk.deleteDoc).not.toHaveBeenCalled();
  });

  it('retains offline confirmation then tip as proposals at the original revisions', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const debt = { ...transaction, utang: true, utangStatus: 'unpaid', paidAmount: 0 };
    store.set(txPath, { value: debt, updatedAt: 7 });
    const full = args(false, 0, 7); full.value = { ...full.value, ...{ utang: true, utangStatus: 'paid', paidAmount: 100 } };
    const confirmed = await firestoreRecords('records.save_transaction', full, owner);
    const tip = args(false, 17, confirmed.record.updatedAt);
    tip.value = { ...tip.value, ...{ utang: true, utangStatus: 'paid', paidAmount: 100 } };
    await firestoreRecords('records.save_transaction', tip, owner);
    const operations = [...store.entries()].filter(([path]) => path.includes('/offline_mutations/')).map(([path, data]) => ({ ...data, id: path.split('/').pop()! })) as OfflineMutation[];
    expect(operations).toHaveLength(2);
    expect(operations.find(item => item.collection === 'transactions')).toMatchObject({ expectedUpdatedAt: 7, value: { paidAmount: 100, tip: 17, amount: 100, fee: 3 } });
    expect(operations.find(item => item.collection === 'meta')).toMatchObject({ expectedUpdatedAt: 3, value: { wallets: { cash: 1120, maribank: 400 } } });
    expect(store.get(txPath)).toEqual({ value: debt, updatedAt: 7 });
    expect(overlayOfflineMutations([{ id: 'payment-1', value: debt, updatedAt: 7 }], operations, 'transactions')[0].value).toMatchObject({ utangStatus: 'paid', paidAmount: 100, tip: 17 });
    expect(sdk.runTransaction).not.toHaveBeenCalled();
  });

  it('atomically reclassifies a paid receipt and its tip without creating another payment', async () => {
    const old = { ...transaction, type: 'Cash Out', selling: 0, fee: 1.5, tip: 18.5, tipWallet: 'maribank', utang: true, utangStatus: 'paid', paidAmount: 100, utangReleased: true };
    store.set(txPath, { value: old, updatedAt: 7 });
    const corrected = { ...old, tipWallet: 'cash', paymentAllocation: { cash: 101.5, maribank: 0 } };
    const payload = { ...args(false, 0, 7), requireOnline: true, value: corrected,
      meta: { ...args().meta, value: { ...settings, wallets: { cash: 1120, maribank: 380 } } } };
    const result = await firestoreRecords('records.save_transaction', payload, owner);
    expect(result.record.id).toBe('payment-1');
    expect(result.record.value).toEqual(corrected);
    expect(writes.map(item => item.ref.path)).toEqual([txPath, metaPath]);
    expect(store.get(metaPath).value.wallets).toEqual({ cash: 1120, maribank: 380 });
    const committed = clone([...store.entries()]);
    await expect(firestoreRecords('records.save_transaction', payload, owner)).rejects.toThrow(/changed or was removed/);
    expect([...store.entries()]).toEqual(committed);
    expect(writes).toHaveLength(2);
    expect(sdk.setDoc).not.toHaveBeenCalled();
  });

  it('refuses an online-only receipt correction offline without creating any proposal', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    store.set(txPath, { value: transaction, updatedAt: 7 });
    const before = clone([...store.entries()]);
    await expect(firestoreRecords('records.save_transaction', { ...args(false, 0, 7), requireOnline: true }, owner)).rejects.toThrow(/Reconnect before correcting/);
    expect([...store.entries()]).toEqual(before);
    expect(sdk.runTransaction).not.toHaveBeenCalled();
    expect(sdk.setDoc).not.toHaveBeenCalled();
  });

  it('does not split a correction into offline proposals when connectivity drops during the queue check', async () => {
    store.set(txPath, { value: transaction, updatedAt: 7 });
    sdk.getDocs.mockImplementationOnce(async () => {
      vi.stubGlobal('navigator', { onLine: false });
      return { docs: [] };
    });
    const before = clone([...store.entries()]);
    await expect(firestoreRecords('records.save_transaction', { ...args(false, 0, 7), requireOnline: true }, owner)).rejects.toThrow(/Reconnect before correcting/);
    expect([...store.entries()]).toEqual(before);
    expect(sdk.runTransaction).not.toHaveBeenCalled();
    expect(sdk.setDoc).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'mutation', collection: 'transactions' },
    { kind: 'conflict', collection: 'transactions' },
    { kind: 'mutation', collection: 'meta' },
    { kind: 'conflict', collection: 'meta' },
  ])('keeps a $kind proposal for $collection intact instead of overwriting its financial overlay', async operation => {
    store.set(txPath, { value: transaction, updatedAt: 7 });
    store.set(`${prefix}/offline_mutations/pending-financial-change`, { ...operation, recordId: 'other-record', action: 'replace', value: { amount: 200 }, expectedUpdatedAt: 2 });
    const before = clone([...store.entries()]);
    await expect(firestoreRecords('records.save_transaction', { ...args(false, 0, 7), requireOnline: true }, owner)).rejects.toThrow(/Finish syncing/);
    expect([...store.entries()]).toEqual(before);
    expect(sdk.runTransaction).not.toHaveBeenCalled();
    expect(sdk.setDoc).not.toHaveBeenCalled();
  });

  it.each(['fromCache', 'hasPendingWrites'])('requires a server-confirmed queue instead of a $0 snapshot for a correction', async flag => {
    store.set(txPath, { value: transaction, updatedAt: 7 });
    sdk.getDocs.mockResolvedValueOnce({ docs: [], metadata: { [flag]: true } });
    await expect(firestoreRecords('records.save_transaction', { ...args(false, 0, 7), requireOnline: true }, owner)).rejects.toThrow(/Finish syncing/);
    expect(writes).toEqual([]);
    expect(sdk.runTransaction).not.toHaveBeenCalled();
  });

  it('does not erase unrelated customer proposals while correcting a receipt', async () => {
    store.set(txPath, { value: transaction, updatedAt: 7 });
    const path = `${prefix}/offline_mutations/customer-draft`;
    const proposal = { kind: 'mutation', collection: 'customers', recordId: 'buyer', value: { name: 'Local draft' } };
    store.set(path, clone(proposal));
    await firestoreRecords('records.save_transaction', { ...args(false, 0, 7), requireOnline: true }, owner);
    expect(store.get(path)).toEqual(proposal);
    expect(sdk.runTransaction).toHaveBeenCalledTimes(1);
    expect(writes.map(item => item.ref.path)).toEqual([txPath, metaPath]);
  });

});
