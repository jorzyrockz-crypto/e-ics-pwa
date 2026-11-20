import { describe, expect, it } from 'vitest';
import { coalesceOfflineMutation, overlayOfflineMutations, recordVersionMatches, type OfflineMutation } from './offlineSync';

describe('offline mutation conflict safety', () => {
  it('accepts an edit only when the record still has the exact base revision', () => {
    expect(recordVersionMatches(12, true, 12)).toBe(true);
    expect(recordVersionMatches(12, true, 13)).toBe(false);
    expect(recordVersionMatches(12, false, 12)).toBe(false);
    expect(recordVersionMatches(0, true, 0)).toBe(true);
  });

  it('coalesces repeated edits on one device without moving the original compare point', () => {
    const first: OfflineMutation = { id: 'op-1', kind: 'mutation', collection: 'transactions', recordId: 'tx-1', action: 'replace', value: { amount: 110 }, expectedUpdatedAt: 12, createdAt: 20 };
    const second: OfflineMutation = { id: 'op-2', kind: 'mutation', collection: 'transactions', recordId: 'tx-1', action: 'replace', value: { amount: 125 }, expectedUpdatedAt: 30, createdAt: 40 };
    expect(coalesceOfflineMutation(first, second)).toEqual({ ...second, id: 'op-1', expectedUpdatedAt: 12, createdAt: 20 });
  });

  it('shows queued edits optimistically without changing the base list', () => {
    const base = [{ id: 'tx-1', value: { amount: 100 }, updatedAt: 12 }];
    const queue: OfflineMutation[] = [{
      id: 'op-1', kind: 'mutation', collection: 'transactions', recordId: 'tx-1',
      action: 'replace', value: { amount: 125 }, expectedUpdatedAt: 12, createdAt: 20,
    }];
    expect(overlayOfflineMutations(base, queue, 'transactions')).toEqual([
      { id: 'tx-1', value: { amount: 125 }, updatedAt: 12 },
    ]);
    expect(base[0].value).toEqual({ amount: 100 });
  });

  it('hides queued deletes and ignores another collection and already-conflicted operations', () => {
    const base = [
      { id: 'tx-1', value: { amount: 100 }, updatedAt: 12 },
      { id: 'tx-2', value: { amount: 200 }, updatedAt: 14 },
    ];
    const queue: OfflineMutation[] = [
      { id: 'op-delete', kind: 'mutation', collection: 'transactions', recordId: 'tx-1', action: 'delete', expectedUpdatedAt: 12, createdAt: 20 },
      { id: 'op-other', kind: 'mutation', collection: 'customers', recordId: 'tx-2', action: 'replace', value: {}, expectedUpdatedAt: 14, createdAt: 21 },
      { id: 'op-conflict', kind: 'conflict', collection: 'transactions', recordId: 'tx-2', action: 'replace', value: {}, expectedUpdatedAt: 14, createdAt: 22 },
    ];
    expect(overlayOfflineMutations(base, queue, 'transactions')).toEqual([base[1]]);
  });
});
