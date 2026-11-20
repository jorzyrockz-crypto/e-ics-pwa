import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  onSnapshot: vi.fn(), getDocs: vi.fn(), waitForPendingWrites: vi.fn(), runTransaction: vi.fn(),
}));
vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }));
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}), GoogleAuthProvider: class {}, signInWithPopup: vi.fn(), onAuthStateChanged: vi.fn(), signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  initializeFirestore: () => ({}), getFirestore: () => ({}),
  persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
  collection: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  doc: vi.fn(), getDoc: vi.fn(), getDocFromCache: vi.fn(), getDocs: sdk.getDocs, getDocsFromCache: vi.fn(),
  setDoc: vi.fn(), deleteDoc: vi.fn(), onSnapshot: sdk.onSnapshot,
  waitForPendingWrites: sdk.waitForPendingWrites, runTransaction: sdk.runTransaction,
}));

import { subscribeToUserRecords, syncUserRecords, type User } from './firebase';
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
