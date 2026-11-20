export type OfflineMutation = {
  id: string;
  kind: 'mutation' | 'conflict';
  collection: string;
  recordId: string;
  action: 'replace' | 'delete';
  value?: unknown;
  expectedUpdatedAt: number;
  createdAt: number;
  remoteUpdatedAt?: number;
  remoteValue?: unknown;
};

export function coalesceOfflineMutation(previous: OfflineMutation|undefined, next: OfflineMutation): OfflineMutation {
  if(!previous) return next;
  if(previous.collection!==next.collection||previous.recordId!==next.recordId||previous.kind!=='mutation') return next;
  return {...next,id:previous.id,expectedUpdatedAt:previous.expectedUpdatedAt,createdAt:previous.createdAt};
}

export function recordVersionMatches(expected: number, exists: boolean, actual: number): boolean {
  return exists && expected === actual;
}

export function overlayOfflineMutations<T extends { id: string; value: unknown; updatedAt?: number }>(
  records: T[],
  mutations: OfflineMutation[],
  collectionName: string,
): T[] {
  let result = [...records];
  for (const mutation of mutations) {
    if (mutation.kind !== 'mutation' || mutation.collection !== collectionName) continue;
    if (mutation.action === 'delete') {
      result = result.filter(record => record.id !== mutation.recordId);
      continue;
    }
    const optimistic = {
      id: mutation.recordId,
      value: mutation.value,
      updatedAt: mutation.expectedUpdatedAt,
    } as T;
    const index = result.findIndex(record => record.id === mutation.recordId);
    if (index < 0) result.unshift(optimistic);
    else result[index] = optimistic;
  }
  return result;
}
