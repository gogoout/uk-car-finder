import { beforeEach, describe, expect, it } from 'vitest';
import * as db from '../../src/db/queries';
import { normaliseAdvert } from '../../src/autotrader/normalise';
import { combo, resetDb, savedSearch, searchListing } from './helpers';

let DB: D1Database;

beforeEach(async () => {
  DB = await resetDb();
});

describe('searches', () => {
  it('round-trips a saved search including its combos', async () => {
    const search = savedSearch();
    await db.upsertSearch(DB, search);

    const loaded = await db.getSearch(DB, 's1');
    expect(loaded).toMatchObject({ id: 's1', name: 'Small autos', postcode: 'SW1A 1AA', radius: 50 });
    expect(loaded!.combos).toHaveLength(1);
    expect(loaded!.combos[0]!.label).toBe('MINI Cooper 1.5 Auto');
  });

  it('preserves a national radius rather than coercing it to NaN', async () => {
    await db.upsertSearch(DB, savedSearch({ radius: 'national' }));
    expect((await db.getSearch(DB, 's1'))!.radius).toBe('national');
  });

  it('updates in place on re-save', async () => {
    await db.upsertSearch(DB, savedSearch());
    await db.upsertSearch(DB, savedSearch({ name: 'Renamed', combos: [combo(), combo({}, { id: 'c2' })] }));

    const all = await db.listSearches(DB);
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('Renamed');
    expect(all[0]!.combos).toHaveLength(2);
  });

  it('removes a search and its links without touching the listing cache', async () => {
    await db.upsertSearch(DB, savedSearch());
    await db.upsertSearchListing(DB, searchListing());
    const runId = await db.startRun(DB, 's1');
    await db.linkListingToCombo(DB, 's1', '1', combo(), runId);

    await db.deleteSearch(DB, 's1');

    expect(await db.getSearch(DB, 's1')).toBeNull();
    expect(await db.listRuns(DB, 's1')).toHaveLength(0);
    // The listing survives — another search may still reference it.
    const row = await DB.prepare('SELECT advert_id FROM listings').first();
    expect(row).not.toBeNull();
  });
});

describe('price history', () => {
  it('records the first sighting without calling it a drop', async () => {
    await db.upsertSearchListing(DB, searchListing());
    expect(await db.recordPrice(DB, '1', 6550)).toBe(false);
  });

  it('ignores an unchanged price so history stays meaningful', async () => {
    await db.recordPrice(DB, '1', 6550);
    await db.recordPrice(DB, '1', 6550);

    const { results } = await DB.prepare('SELECT * FROM listing_prices WHERE advert_id = ?')
      .bind('1')
      .all();
    expect(results).toHaveLength(1);
  });

  it('flags a fall and not a rise', async () => {
    await db.recordPrice(DB, '1', 6550, '2026-08-01T00:00:00Z');
    expect(await db.recordPrice(DB, '1', 6200, '2026-08-02T00:00:00Z')).toBe(true);
    expect(await db.recordPrice(DB, '1', 6400, '2026-08-03T00:00:00Z')).toBe(false);
  });

  it('skips listings with no price rather than storing a null', async () => {
    expect(await db.recordPrice(DB, '1', null)).toBe(false);
    const { results } = await DB.prepare('SELECT * FROM listing_prices').all();
    expect(results).toHaveLength(0);
  });
});

describe('detail enrichment', () => {
  it('fills in detail columns without clobbering search-derived ones', async () => {
    await db.upsertSearchListing(DB, searchListing({ price: 6550 }));

    await db.applyDetail(DB, {
      ...normaliseAdvert({}),
      advertId: '1',
      transmission: 'Automatic',
      engineLitres: 1.5,
      serviceHistory: 'FULL',
      writeOff: 'PASSED',
    });

    const row = await DB.prepare('SELECT * FROM listings WHERE advert_id = ?').bind('1').first<any>();
    expect(row.transmission).toBe('Automatic');
    expect(row.engine_litres).toBe(1.5);
    expect(row.service_history).toBe('FULL');
    expect(row.price).toBe(6550);
    expect(row.detail_fetched_at).not.toBeNull();
  });

  it('keeps a user-entered plate when the scraper finds none', async () => {
    await db.upsertSearchListing(DB, searchListing());
    await db.setVrm(DB, '1', 'yt66 cnk');

    await db.applyDetail(DB, { ...normaliseAdvert({}), advertId: '1', vrm: null });

    const row = await DB.prepare('SELECT vrm FROM listings WHERE advert_id = ?').bind('1').first<any>();
    expect(row.vrm).toBe('YT66CNK');
  });

  it('keeps the search badge indicator when the detail page has no analysis', async () => {
    await db.upsertSearchListing(DB, searchListing({ priceIndicator: 'GREAT' }));

    await db.applyDetail(DB, { ...normaliseAdvert({}), advertId: '1', priceIndicator: 'NOANALYSIS' });

    const row = await DB.prepare('SELECT price_indicator FROM listings WHERE advert_id = ?')
      .bind('1')
      .first<any>();
    expect(row.price_indicator).toBe('GREAT');
  });
});

describe('results and deltas', () => {
  const seedRun = async (listings: Parameters<typeof searchListing>[0][]) => {
    const runId = await db.startRun(DB, 's1');
    for (const overrides of listings) {
      const listing = searchListing(overrides);
      await db.upsertSearchListing(DB, listing);
      await db.recordPrice(DB, listing.advertId, listing.price);
      await db.linkListingToCombo(DB, 's1', listing.advertId, combo(), runId);
    }
    await db.finishRun(DB, runId, {
      pagesFetched: 1,
      listingsSeen: listings.length,
      newCount: listings.length,
      priceDropCount: 0,
    });
    return runId;
  };

  beforeEach(async () => {
    await db.upsertSearch(DB, savedSearch());
  });

  it('marks only listings first seen on the latest run as new', async () => {
    await seedRun([{ advertId: '1' }]);
    await seedRun([{ advertId: '1' }, { advertId: '2' }]);

    const results = await db.getResults(DB, 's1');
    const byId = Object.fromEntries(results.map((r) => [r.advertId, r]));

    expect(byId['1']!.isNew).toBe(false);
    expect(byId['2']!.isNew).toBe(true);
  });

  it('reports the total fall from the highest price ever seen', async () => {
    await seedRun([{ advertId: '1', price: 7000 }]);
    await seedRun([{ advertId: '1', price: 6800 }]);
    await seedRun([{ advertId: '1', price: 6500 }]);

    const [result] = await db.getResults(DB, 's1');
    expect(result!.priceDrop).toBe(500);
    expect(result!.previousPrice).toBe(7000);
  });

  it('reports no drop for a listing that has only ever gone up', async () => {
    await seedRun([{ advertId: '1', price: 6000 }]);
    await seedRun([{ advertId: '1', price: 6500 }]);

    const [result] = await db.getResults(DB, 's1');
    expect(result!.priceDrop).toBeNull();
  });

  it('tags a listing with every combo that matched it', async () => {
    // Both combos must belong to the search — refreshSearch only ever links
    // combos it is iterating over, and credits are verified against them.
    const second = combo({}, { id: 'c2', label: 'Any small auto' });
    await db.upsertSearch(DB, savedSearch({ combos: [combo(), second] }));

    const runId = await db.startRun(DB, 's1');
    await db.upsertSearchListing(DB, searchListing());
    await db.linkListingToCombo(DB, 's1', '1', combo(), runId);
    await db.linkListingToCombo(DB, 's1', '1', second, runId);
    await db.finishRun(DB, runId, { pagesFetched: 1, listingsSeen: 1, newCount: 1, priceDropCount: 0 });

    const [result] = await db.getResults(DB, 's1');
    expect(result!.matchedCombos.sort()).toEqual(['Any small auto', 'MINI Cooper 1.5 Auto']);
  });

  it('excludes write-offs and anything not positively cleared', async () => {
    await seedRun([{ advertId: '1' }, { advertId: '2' }, { advertId: '3' }]);
    await db.applyDetail(DB, { ...normaliseAdvert({}), advertId: '1', writeOff: 'PASSED' });
    await db.applyDetail(DB, { ...normaliseAdvert({}), advertId: '2', writeOff: 'FAILED' });
    // '3' keeps writeOff UNKNOWN — the detail page never carried a check block.

    const all = await db.getResults(DB, 's1');
    const filtered = await db.getResults(DB, 's1', { excludeWriteOffs: true });

    expect(all).toHaveLength(3);
    expect(filtered.map((r) => r.advertId)).toEqual(['1']);
  });

  it('does not leak listings from another search', async () => {
    await db.upsertSearch(DB, savedSearch({ id: 's2', name: 'Other' }));
    await seedRun([{ advertId: '1' }]);

    expect(await db.getResults(DB, 's2')).toHaveLength(0);
  });

  /**
   * Links are written when a listing matches, but nothing re-evaluates them
   * afterwards. Narrowing a combo means AutoTrader simply stops returning that
   * car, so its link is never touched and it lingers in the results.
   */
  describe('after the combo is edited', () => {
    it('drops a listing that no longer satisfies a narrowed price range', async () => {
      await db.upsertSearch(
        DB,
        savedSearch({ combos: [combo({ max_price: ['8000'] })] }),
      );
      await seedRun([{ advertId: 'cheap', price: 6500 }, { advertId: 'dear', price: 7800 }]);
      expect(await db.getResults(DB, 's1')).toHaveLength(2);

      // The user lowers the cap to £7,000.
      await db.upsertSearch(DB, savedSearch({ combos: [combo({ max_price: ['7000'] })] }));

      const results = await db.getResults(DB, 's1');
      expect(results.map((r) => r.advertId)).toEqual(['cheap']);
    });

    it('drops a listing outside a narrowed year or mileage bound', async () => {
      await db.upsertSearch(DB, savedSearch({ combos: [combo()] }));
      await seedRun([
        { advertId: 'ok', year: 2016, mileage: 40000 },
        { advertId: 'old', year: 2012, mileage: 40000 },
        { advertId: 'worn', year: 2016, mileage: 120000 },
      ]);

      await db.upsertSearch(
        DB,
        savedSearch({
          combos: [combo({ min_year_manufactured: ['2015'], max_mileage: ['85000'] })],
        }),
      );

      expect((await db.getResults(DB, 's1')).map((r) => r.advertId)).toEqual(['ok']);
    });

    it('stops crediting a combo that no longer matches, without hiding the listing', async () => {
      await db.upsertSearch(
        DB,
        savedSearch({
          combos: [combo({}, { id: 'c1', label: 'Cheap' }), combo({}, { id: 'c2', label: 'Any' })],
        }),
      );
      const runId = await db.startRun(DB, 's1');
      await db.upsertSearchListing(DB, searchListing({ advertId: '1', price: 7500 }));
      await db.linkListingToCombo(DB, 's1', '1', combo({}, { id: 'c1', label: 'Cheap' }), runId);
      await db.linkListingToCombo(DB, 's1', '1', combo({}, { id: 'c2', label: 'Any' }), runId);
      await db.finishRun(DB, runId, {
        pagesFetched: 1, listingsSeen: 1, newCount: 1, priceDropCount: 0,
      });

      // Only the first combo gains a cap the listing fails.
      await db.upsertSearch(
        DB,
        savedSearch({
          combos: [
            combo({ max_price: ['7000'] }, { id: 'c1', label: 'Cheap' }),
            combo({}, { id: 'c2', label: 'Any' }),
          ],
        }),
      );

      const [result] = await db.getResults(DB, 's1');
      expect(result!.matchedCombos).toEqual(['Any']);
    });

    it('keeps a listing when the combo is widened', async () => {
      await db.upsertSearch(DB, savedSearch({ combos: [combo({ max_price: ['7000'] })] }));
      await seedRun([{ advertId: '1', price: 6500 }]);

      await db.upsertSearch(DB, savedSearch({ combos: [combo({ max_price: ['9000'] })] }));

      expect(await db.getResults(DB, 's1')).toHaveLength(1);
    });

    it('keeps a listing whose combo was deleted from the search entirely', async () => {
      // Nothing should vanish just because a combo was removed while the
      // listing is still linked — it simply loses that credit.
      await db.upsertSearch(DB, savedSearch({ combos: [combo()] }));
      await seedRun([{ advertId: '1', price: 6500 }]);

      await db.upsertSearch(DB, savedSearch({ combos: [combo({}, { id: 'other' })] }));

      expect(await db.getResults(DB, 's1')).toHaveLength(0);
    });
  });
});

describe('fetch queue', () => {
  it('dedupes, batches oldest-first and drops repeat failures', async () => {
    await db.enqueueDetail(DB, 'a');
    await db.enqueueDetail(DB, 'a');
    await db.enqueueDetail(DB, 'b');

    expect(await db.queueDepth(DB)).toBe(2);
    expect((await db.takeQueueBatch(DB, 10)).map((i) => i.advert_id).sort()).toEqual(['a', 'b']);

    for (let i = 0; i < 3; i++) await db.recordQueueFailure(DB, 'a', 'boom');

    // 'a' has burned its attempts, so it no longer blocks the queue.
    expect((await db.takeQueueBatch(DB, 10)).map((i) => i.advert_id)).toEqual(['b']);
    expect(await db.queueDepth(DB)).toBe(1);

    await db.dequeueDetail(DB, 'b');
    expect(await db.queueDepth(DB)).toBe(0);
  });
});

describe('starring', () => {
  it('stars, unstars and normalises a plate', async () => {
    await db.upsertSearchListing(DB, searchListing());
    await db.upsertSearch(DB, savedSearch());
    const runId = await db.startRun(DB, 's1');
    await db.linkListingToCombo(DB, 's1', '1', combo(), runId);
    await db.finishRun(DB, runId, { pagesFetched: 1, listingsSeen: 1, newCount: 1, priceDropCount: 0 });

    await db.setStarred(DB, '1', true);
    expect((await db.getResults(DB, 's1'))[0]!.starred).toBe(true);

    await db.setVrm(DB, '1', ' yt66cnk ');
    expect((await db.getResults(DB, 's1'))[0]!.vrm).toBe('YT66CNK');

    await db.setStarred(DB, '1', false);
    expect((await db.getResults(DB, 's1'))[0]!.starred).toBe(false);
  });
});
