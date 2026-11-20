import { describe, expect, it } from 'vitest';
import { collectSavedPromos, findSavedPromos, type PromoHistoryRecord } from './app/savedPromos';

function sale(id: string, changes: Record<string, unknown> = {}, updatedAt = 1): PromoHistoryRecord {
  return { id, updatedAt, value: {
    type: 'E-Load', network: 'Globe', eloadKind: 'promo', promoName: 'Go+99',
    amount: 99, promoDetails: '8GB + texts', promoValidity: '7 days', createdAt: 100,
    ...changes,
  } };
}

describe('saved promo templates from loaded transactions', () => {
  it('copies only reusable product fields, never a customer, fee, discount, tip, or payment state', () => {
    const rows = [sale('sale', {
      network: ' Globe ', promoName: '  Go+99  ', promoDetails: ' 8GB + texts ', promoValidity: ' 7 days ',
      phone: '09171234567', customerName: 'Private Buyer', fee: 20, discount: 5, tip: 17,
      notes: 'Private note', payment: 'Cash', utang: true, utangStatus: 'unpaid', paidAmount: 0,
    })];
    const before = structuredClone(rows);
    expect(collectSavedPromos(rows)).toEqual([{
      key: '["globe","go+99"]', network: 'Globe', name: 'Go+99', amount: 99,
      details: '8GB + texts', validity: '7 days', uses: 1, lastUsed: 100,
    }]);
    expect(rows).toEqual(before);
  });

  it('deduplicates normalized names within each network and uses one complete latest-sale snapshot', () => {
    const rows = [
      sale('old', { promoName: ' Go   Bundle ', amount: 90, promoDetails: 'Old data', promoValidity: '3 days', createdAt: 10 }, 999),
      sale('new', { promoName: 'GO Bundle', amount: 129, promoDetails: 'New data', promoValidity: '7 days', createdAt: 20 }),
      sale('other-network', { network: 'Smart', promoName: 'Go Bundle', createdAt: 30 }),
      sale('other-package', { promoName: 'Go+99', createdAt: 15 }),
    ];
    const promos = collectSavedPromos(rows);
    expect(promos).toHaveLength(3);
    expect(findSavedPromos(promos, 'globe', 'go bundle')).toEqual([expect.objectContaining({
      name: 'GO Bundle', amount: 129, details: 'New data', validity: '7 days', uses: 2, lastUsed: 20,
    })]);
    expect(collectSavedPromos([...rows].reverse())).toEqual(promos);
  });

  it('breaks equal-date ties by revision then record ID, independently of snapshot order', () => {
    const rows = [sale('z', { amount: 90 }, 1), sale('b', { amount: 100 }, 2), sale('a', { amount: 110 }, 2)];
    expect(collectSavedPromos(rows)[0]).toMatchObject({ amount: 110, uses: 3 });
    expect(collectSavedPromos([...rows].reverse())).toEqual(collectSavedPromos(rows));
  });

  it('keeps intentionally empty new details instead of mixing them with an old offer', () => {
    const promos = collectSavedPromos([
      sale('old'), sale('new', { amount: 109, promoDetails: undefined, promoValidity: '', createdAt: 200 }),
    ]);
    expect(promos[0]).toMatchObject({ amount: 109, details: '', validity: '', uses: 2 });
  });

  it('accepts older named promo records without a kind and uses their date when createdAt is absent', () => {
    const promos = collectSavedPromos([
      sale('legacy', { eloadKind: undefined, createdAt: undefined, date: '2026-11-18' }),
      sale('invalid-date', { promoName: 'Another', createdAt: NaN, date: 'not a date' }),
    ]);
    expect(promos[0]).toMatchObject({ name: 'Go+99', lastUsed: Date.parse('2026-11-18T00:00:00Z') });
    expect(promos[1].lastUsed).toBe(0);
  });

  it('ignores regular load, other services, samples, blank names/networks, and invalid prices', () => {
    const rows = [
      sale('regular', { eloadKind: 'regular' }), sale('cash', { type: 'Cash In' }),
      sale('sample', { sample: true }), sale('name', { promoName: '  ' }),
      sale('network', { network: '' }), sale('zero', { amount: 0 }), sale('negative', { amount: -10 }),
      sale('string', { amount: '99' }), sale('nan', { amount: NaN }), sale('infinite', { amount: Infinity }),
      { id: 'null', value: null }, { id: 'malformed', value: 'Go99' },
    ];
    expect(collectSavedPromos(rows)).toEqual([]);
  });
});

describe('network-specific promo matching', () => {
  const promos = collectSavedPromos([
    sale('go', { promoName: 'Go+99', createdAt: 10 }),
    sale('go149', { promoName: 'Go+149', amount: 149, createdAt: 30 }),
    sale('goplan', { promoName: 'Extra Go Plan 99', createdAt: 40 }),
    sale('bundle', { promoName: 'Weekend   Bundle', createdAt: 20 }),
    sale('smart', { network: 'Smart', promoName: 'Go+99', createdAt: 50 }),
  ]);

  it('matches case, Unicode, whitespace and multiple words without crossing networks', () => {
    expect(findSavedPromos(promos, ' GLOBE ', ' Ｇｏ＋９９ ').map(promo => promo.name)).toEqual(['Go+99']);
    expect(findSavedPromos(promos, 'Globe', '99  go').map(promo => promo.name)).toEqual(['Extra Go Plan 99', 'Go+99']);
    expect(findSavedPromos(promos, 'Globe', 'WEEKEND   bundle')[0].name).toBe('Weekend Bundle');
    expect(findSavedPromos(promos, 'Smart', 'go')).toHaveLength(1);
    expect(findSavedPromos(promos, 'DITO', '')).toEqual([]);
  });

  it('puts prefix matches first, then recent usage, and does not mutate the catalog', () => {
    const before = structuredClone(promos);
    expect(findSavedPromos(promos, 'Globe', 'go').map(promo => promo.name)).toEqual(['Go+149', 'Go+99', 'Extra Go Plan 99']);
    expect(promos).toEqual(before);
  });

  it('shows at most six recent choices on empty focus and supports a smaller/zero result limit', () => {
    const many = collectSavedPromos(Array.from({ length: 10 }, (_, i) => sale(`${i}`, { promoName: `Bundle ${i}`, createdAt: i + 1 })));
    expect(findSavedPromos(many, 'Globe', '')).toHaveLength(6);
    expect(findSavedPromos(many, 'Globe', '', 2).map(promo => promo.name)).toEqual(['Bundle 9', 'Bundle 8']);
    expect(findSavedPromos(many, 'Globe', '', 0)).toEqual([]);
    expect(findSavedPromos(many, 'Globe', 'not saved')).toEqual([]);
  });
});
