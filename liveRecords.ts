import { overlayOfflineMutations, type OfflineMutation } from './offlineSync';

export const recordCollectionLimits = {
  transactions: 100,
  meta: 10,
  customers: 100,
  daily_reports: 100,
  favorites: 100,
  wallet_adjustments: 200,
  sync_conflicts: 100,
} as const;
export type RecordCollection = keyof typeof recordCollectionLimits;
export type DataCollection = Exclude<RecordCollection, 'sync_conflicts'>;
export type LiveSource = DataCollection | 'offline_mutations';
export const liveSources: readonly LiveSource[] = ['transactions', 'meta', 'customers', 'daily_reports', 'favorites', 'wallet_adjustments', 'offline_mutations'];
export type LiveRecord = { id: string; value: any; updatedAt?: number };
export type LiveSnapshot = { records: LiveRecord[]; fromCache: boolean; hasPendingWrites: boolean };
export type LiveStatus = { connected: boolean; hasPendingWrites: boolean };
export type LiveRecordCallbacks = {
  onRecords: (collection: RecordCollection, records: LiveRecord[]) => void;
  onStatus: (status: LiveStatus) => void;
  onError: (error: Error) => void;
  onPendingMutations?: () => void;
};
export type WatchRecords = (source: LiveSource, next: (snapshot: LiveSnapshot) => void, error: (error: Error) => void) => () => void;

// Consume the snapshots directly rather than refetching every collection whenever
// one document changes. Wait for the proposal queue before displaying cloud rows,
// so a cached/offline edit cannot be replaced by an un-overlaid server snapshot.
export function listenToRecordCollections(watch: WatchRecords, callbacks: LiveRecordCallbacks): () => void {
  let active = true;
  let failed = false;
  let operationsReady = false;
  let mutations: OfflineMutation[] = [];
  const snapshots = new Map<LiveSource, LiveSnapshot>();
  const stops: (() => void)[] = [];
  const emitStatus = () => {
    const states = [...snapshots.values()];
    callbacks.onStatus({
      connected: !failed && snapshots.size === liveSources.length && states.every(state => !state.fromCache && !state.hasPendingWrites),
      hasPendingWrites: states.some(state => state.hasPendingWrites),
    });
  };
  const emitRecords = (name: DataCollection) => {
    const snapshot = snapshots.get(name);
    if (!operationsReady || !snapshot) return;
    const records = overlayOfflineMutations(snapshot.records, mutations, name);
    records.sort((a, b) => Number(b.value?.createdAt || 0) - Number(a.value?.createdAt || 0) || a.id.localeCompare(b.id));
    callbacks.onRecords(name, records.slice(0, recordCollectionLimits[name]));
  };
  const stop = () => {
    if (!active) return;
    active = false;
    stops.forEach(unsubscribe => unsubscribe());
  };
  try {
    for (const source of liveSources) {
      stops.push(watch(source, snapshot => {
        if (!active) return;
        snapshots.set(source, snapshot);
        if (source === 'offline_mutations') {
          mutations = snapshot.records.map(row => ({ ...row.value, id: row.id } as OfflineMutation));
          operationsReady = true;
          for (const name of liveSources) if (name !== 'offline_mutations') emitRecords(name);
          const conflicts = snapshot.records.filter(row => row.value?.kind === 'conflict').map(row => ({
            ...row, updatedAt: Number(row.value.conflictAt || 0),
          }));
          callbacks.onRecords('sync_conflicts', conflicts.slice(0, recordCollectionLimits.sync_conflicts));
          if (!snapshot.fromCache && !snapshot.hasPendingWrites && mutations.some(row => row.kind === 'mutation')) callbacks.onPendingMutations?.();
        } else {
          emitRecords(source);
        }
        emitStatus();
      }, error => {
        if (!active) return;
        failed = true;
        emitStatus();
        callbacks.onError(new Error(`${source}: ${error.message}`));
      }));
    }
  } catch (error) {
    stop();
    callbacks.onStatus({ connected: false, hasPendingWrites: false });
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
  return stop;
}

// A settings form is a draft, not a copy of the wallet balances to write back.
// Keep new cloud fields and reject conflicting edits to the same setting.
export function mergeDraftFields<T extends object>(latest: T, base: T, draft: T, keys: readonly (keyof T)[]): T {
  const merged = { ...latest };
  for (const key of keys) {
    if (Object.is(draft[key], base[key])) continue;
    if (!Object.is(latest[key], base[key]) && !Object.is(latest[key], draft[key])) {
      throw new Error('Business settings changed on another device. Your draft is kept; review the latest settings before saving.');
    }
    merged[key] = draft[key];
  }
  return merged;
}
