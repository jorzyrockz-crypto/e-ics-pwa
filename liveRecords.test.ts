import { describe, expect, it, vi } from 'vitest';
import {
  listenToRecordCollections, liveSources, mergeDraftFields,
  type LiveRecord, type LiveSnapshot, type LiveSource, type RecordCollection,
} from './liveRecords';

function device() {
  const watchers = new Map<LiveSource, { next: (snapshot: LiveSnapshot) => void; error: (error: Error) => void; stop: ReturnType<typeof vi.fn> }>();
  const records: Partial<Record<RecordCollection, LiveRecord[]>> = {};
  const onRecords = vi.fn((name: RecordCollection, rows: LiveRecord[]) => { records[name] = rows; });
  const onStatus = vi.fn(), onError = vi.fn(), onPendingMutations = vi.fn();
  const stop = listenToRecordCollections((source, next, error) => {
    const unsubscribe = vi.fn();
    watchers.set(source, { next, error, stop: unsubscribe });
    return unsubscribe;
  }, { onRecords, onStatus, onError, onPendingMutations });
  const emit = (source: LiveSource, rows: LiveRecord[], metadata: Partial<Omit<LiveSnapshot, 'records'>> = {}) => {
    watchers.get(source)!.next({ records: rows, fromCache: false, hasPendingWrites: false, ...metadata });
  };
  return { watchers, records, onRecords, onStatus, onError, onPendingMutations, stop, emit };
}
const tx = (amount: number, version = 1): LiveRecord => ({ id: 'tx-1', value: { amount, type: 'E-Load', fee: 3, tip: 17, createdAt: 1 }, updatedAt: version });
const proposal = (kind: 'mutation' | 'conflict', action: 'replace' | 'delete' = 'replace'): LiveRecord => ({
  id: 'op-1', value: { kind, collection: 'transactions', recordId: 'tx-1', action, value: tx(125).value, expectedUpdatedAt: 1, createdAt: 2, conflictAt: 3, remoteValue: tx(150).value, remoteUpdatedAt: 2 },
});

describe('live account records', () => {
  it('watches all data collections and the offline proposal queue once', () => {
    const d = device();
    expect([...d.watchers.keys()]).toEqual(liveSources);
    expect(d.watchers.size).toBe(7);
    d.stop();
  });

  it('waits for cached offline proposals before replacing the displayed records', () => {
    const d = device();
    d.emit('transactions', [tx(100)], { fromCache: true });
    expect(d.onRecords).not.toHaveBeenCalled();
    d.emit('offline_mutations', [proposal('mutation')], { fromCache: true });
    expect(d.records.transactions).toEqual([{ id: 'tx-1', value: tx(125).value, updatedAt: 1 }]);
    expect(d.onPendingMutations).not.toHaveBeenCalled();
    d.stop();
  });

  it('reflects a create, edit and deletion on two devices without any refetch', () => {
    const a = device(), b = device();
    for (const d of [a, b]) d.emit('offline_mutations', []);
    for (const d of [a, b]) d.emit('transactions', [tx(100)]);
    expect(b.records.transactions?.[0].value).toMatchObject({ amount: 100, tip: 17 });
    for (const d of [a, b]) d.emit('transactions', [tx(200, 2)]);
    expect(a.records.transactions).toEqual(b.records.transactions);
    expect(b.records.transactions?.[0].value.amount).toBe(200);
    for (const d of [a, b]) d.emit('transactions', []);
    expect(a.records.transactions).toEqual([]);
    expect(b.records.transactions).toEqual([]);
    a.stop(); b.stop();
  });

  it('pushes balances, customers, favorites, reports and wallet activity independently', () => {
    const d = device();
    d.emit('offline_mutations', []);
    const values = {
      meta: { wallets: { cash: 10120, maribank: 4900 } },
      customers: { name: 'Test Buyer', phone: '09171234567' },
      favorites: { phone: '09171234567', amount: 100 },
      daily_reports: { date: '2026-11-18', profit: 20 },
      wallet_adjustments: { wallet: 'cash', amount: 10, mode: 'add' },
    };
    for (const [name, value] of Object.entries(values)) {
      d.emit(name as LiveSource, [{ id: name, value, updatedAt: 2 }]);
      expect(d.records[name as RecordCollection]?.[0].value).toEqual(value);
    }
    d.stop();
  });

  it('keeps a queued edit or delete visible until the conflict is resolved', () => {
    const d = device();
    d.emit('offline_mutations', [proposal('mutation')]);
    d.emit('transactions', [tx(150, 2)]);
    expect(d.records.transactions?.[0].value.amount).toBe(125);
    expect(d.records.transactions?.[0].updatedAt).toBe(1);
    d.emit('offline_mutations', [proposal('mutation', 'delete')]);
    expect(d.records.transactions).toEqual([]);
    d.emit('offline_mutations', [proposal('conflict')]);
    expect(d.records.transactions?.[0].value.amount).toBe(150);
    expect(d.records.sync_conflicts?.[0]).toMatchObject({ id: 'op-1', updatedAt: 3, value: { kind: 'conflict' } });
    d.emit('offline_mutations', []);
    expect(d.records.sync_conflicts).toEqual([]);
    d.stop();
  });

  it('does not report live sync for cached or pending-write snapshots', () => {
    const d = device();
    for (const source of liveSources) d.emit(source, [], { fromCache: true });
    expect(d.onStatus).toHaveBeenLastCalledWith({ connected: false, hasPendingWrites: false });
    for (const source of liveSources) d.emit(source, []);
    expect(d.onStatus).toHaveBeenLastCalledWith({ connected: true, hasPendingWrites: false });
    d.emit('transactions', [tx(100)], { hasPendingWrites: true });
    expect(d.onStatus).toHaveBeenLastCalledWith({ connected: false, hasPendingWrites: true });
    d.emit('transactions', [tx(100)]);
    expect(d.onStatus).toHaveBeenLastCalledWith({ connected: true, hasPendingWrites: false });
    d.stop();
  });

  it('processes proposals only after their server acknowledgement, not on a cached/local event', () => {
    const d = device();
    d.emit('offline_mutations', [proposal('mutation')], { fromCache: true });
    d.emit('offline_mutations', [proposal('mutation')], { hasPendingWrites: true });
    expect(d.onPendingMutations).not.toHaveBeenCalled();
    d.emit('offline_mutations', [proposal('mutation')]);
    expect(d.onPendingMutations).toHaveBeenCalledTimes(1);
    d.emit('offline_mutations', [proposal('conflict')]);
    expect(d.onPendingMutations).toHaveBeenCalledTimes(1);
    d.stop();
  });

  it('sorts and limits the live view without changing the source snapshot', () => {
    const d = device();
    d.emit('offline_mutations', []);
    const rows = Array.from({ length: 105 }, (_, i) => ({ id: `tx-${i}`, value: { createdAt: i, amount: i } }));
    d.emit('transactions', rows);
    expect(d.records.transactions).toHaveLength(100);
    expect(d.records.transactions?.[0].value.amount).toBe(104);
    expect(rows[0].value.amount).toBe(0);
    d.stop();
  });

  it('retains records and reports an error instead of claiming sync succeeded', () => {
    const d = device();
    for (const source of liveSources) d.emit(source, source === 'transactions' ? [tx(100)] : []);
    d.watchers.get('transactions')!.error(new Error('Permission denied'));
    expect(d.records.transactions?.[0].value.amount).toBe(100);
    expect(d.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'transactions: Permission denied' }));
    d.emit('meta', []);
    expect(d.onStatus).toHaveBeenLastCalledWith({ connected: false, hasPendingWrites: false });
    d.stop();
  });

  it('unsubscribes on cleanup and ignores late events from a prior account/session', () => {
    const old = device();
    old.emit('offline_mutations', []);
    old.emit('transactions', [tx(100)]);
    old.stop(); old.stop();
    const calls = old.onRecords.mock.calls.length;
    old.emit('transactions', [tx(999)]);
    old.watchers.get('meta')!.error(new Error('late error'));
    expect(old.onRecords).toHaveBeenCalledTimes(calls);
    expect(old.onError).not.toHaveBeenCalled();
    for (const watcher of old.watchers.values()) expect(watcher.stop).toHaveBeenCalledTimes(1);
    const current = device();
    current.emit('offline_mutations', []);
    current.emit('transactions', []);
    expect(current.records.transactions).toEqual([]);
    current.stop();
  });

  it('cleans up partially opened listeners if subscription setup throws', () => {
    const stops = [vi.fn(), vi.fn()];
    let index = 0;
    const onError = vi.fn();
    const stop = listenToRecordCollections(() => {
      if (index === 2) throw new Error('Could not subscribe');
      return stops[index++];
    }, { onRecords: vi.fn(), onStatus: vi.fn(), onError });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Could not subscribe' }));
    for (const unsubscribe of stops) expect(unsubscribe).toHaveBeenCalledTimes(1);
    stop();
    for (const unsubscribe of stops) expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('settings drafts during live updates', () => {
  const base = { businessName: 'Test Store', fee: 3, threshold: 1000, wallets: { cash: 10000, maribank: 5000 } };
  const keys = ['businessName', 'fee', 'threshold'] as const;

  it('keeps current balances and untouched cloud settings when saving a local draft', () => {
    const latest = { ...base, threshold: 500, wallets: { cash: 10120, maribank: 4900 } };
    const draft = { ...base, businessName: 'New Store Name' };
    expect(mergeDraftFields(latest, base, draft, keys)).toEqual({ ...latest, businessName: 'New Store Name' });
    expect(base.businessName).toBe('Test Store');
  });

  it('keeps a conflicting draft for review instead of overwriting the same cloud setting', () => {
    expect(() => mergeDraftFields({ ...base, fee: 5 }, base, { ...base, fee: 4 }, keys)).toThrow(/changed on another device/);
  });

  it('accepts the same setting value saved from both devices', () => {
    expect(mergeDraftFields({ ...base, fee: 5 }, base, { ...base, fee: 5 }, keys).fee).toBe(5);
  });
});
