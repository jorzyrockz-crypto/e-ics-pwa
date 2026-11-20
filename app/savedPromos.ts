// Build suggestions from this account's already-loaded ledger, including its
// offline cache. No separate catalog, extra network read, or customer data needed.
export type PromoHistoryRecord = { id: string; value: unknown; updatedAt?: number };
export type SavedPromo = {
  key: string;
  network: string;
  name: string;
  amount: number;
  details: string;
  validity: string;
  uses: number;
  lastUsed: number;
};

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const timestamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

export function collectSavedPromos(records: readonly PromoHistoryRecord[]): SavedPromo[] {
  const groups = new Map<string, { promo: SavedPromo; updatedAt: number; sourceId: string }>();
  for (const record of records) {
    if (!record.value || typeof record.value !== 'object') continue;
    const sale = record.value as Record<string, unknown>;
    // Older promo sales may have a name but no eloadKind. Explicit regular-load,
    // other services, sample rows, and malformed prices are not promo templates.
    if (sale.type !== 'E-Load' || (sale.eloadKind !== undefined && sale.eloadKind !== 'promo') || sale.sample === true) continue;
    const name = text(sale.promoName).replace(/\s+/g, ' '), network = text(sale.network);
    if (!name || !network || typeof sale.amount !== 'number' || !Number.isFinite(sale.amount) || sale.amount <= 0) continue;
    const key = JSON.stringify([normalized(network), normalized(name)]);
    const date = text(sale.date);
    const dateTime = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : 0;
    const lastUsed = timestamp(sale.createdAt) || (Number.isFinite(dateTime) ? dateTime : 0);
    const updatedAt = timestamp(record.updatedAt);
    const previous = groups.get(key);
    const uses = (previous?.promo.uses || 0) + 1;
    const newer = !previous || lastUsed > previous.promo.lastUsed || (lastUsed === previous.promo.lastUsed &&
      (updatedAt > previous.updatedAt || (updatedAt === previous.updatedAt && record.id.localeCompare(previous.sourceId) < 0)));
    if (newer) {
      // Take one coherent snapshot, including intentionally blank details. Do not
      // mix an old price with newer inclusions or copy a customer's payment/tip.
      groups.set(key, { promo: { key, network, name, amount: sale.amount, details: text(sale.promoDetails), validity: text(sale.promoValidity), uses, lastUsed }, updatedAt, sourceId: record.id });
    } else if (previous) {
      previous.promo = { ...previous.promo, uses };
    }
  }
  return [...groups.values()].map(group => group.promo).sort((a, b) => b.lastUsed - a.lastUsed || b.uses - a.uses || a.key.localeCompare(b.key));
}

export function findSavedPromos(promos: readonly SavedPromo[], network: string, query: string, limit = 6): SavedPromo[] {
  const networkKey = normalized(network), search = normalized(query), terms = search.split(' ').filter(Boolean);
  return promos.filter(promo => normalized(promo.network) === networkKey && terms.every(term => normalized(promo.name).includes(term)))
    .sort((a, b) => Number(normalized(b.name).startsWith(search)) - Number(normalized(a.name).startsWith(search)) ||
      b.lastUsed - a.lastUsed || b.uses - a.uses || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, limit));
}
