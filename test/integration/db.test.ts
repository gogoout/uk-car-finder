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

  it('gives a listing its cover photo before the detail queue reaches it', async () => {
    await db.upsertSearchListing(DB, searchListing());

    const row = await DB.prepare('SELECT image_url, detail_fetched_at FROM listings WHERE advert_id = ?')
      .bind('1')
      .first<any>();

    expect(row.image_url).toBe('https://m.atcdn.co.uk/a/media/{resize}/cover.jpg');
    expect(row.detail_fetched_at).toBeNull();
  });

  it('does not blank the cover photo when enrichment has none of its own', async () => {
    await db.upsertSearchListing(DB, searchListing());

    await db.applyDetail(DB, { ...normaliseAdvert({}), advertId: '1', imageUrl: null });

    const row = await DB.prepare('SELECT image_url FROM listings WHERE advert_id = ?')
      .bind('1')
      .first<any>();
    expect(row.image_url).toBe('https://m.atcdn.co.uk/a/media/{resize}/cover.jpg');
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

describe('the detail queue', () => {
  it('gives an advert another chance when there is a fresh reason to look', async () => {
    await db.enqueueDetail(DB, '1');
    for (let i = 0; i < 3; i++) await db.recordQueueFailure(DB, '1', 'boom');

    // Three failures and it is skipped for good — which is how every sold
    // advert ended up queued forever without ever being confirmed as gone.
    expect(await db.takeQueueBatch(DB, 10)).toHaveLength(0);

    await db.enqueueDetail(DB, '1');

    const batch = await db.takeQueueBatch(DB, 10);
    expect(batch).toHaveLength(1);
    expect(batch[0]!.attempts).toBe(0);
  });
});

describe('reasons', () => {
  const seedOne = async () => {
    await db.upsertSearchListing(DB, searchListing());
    await db.upsertSearch(DB, savedSearch());
    const runId = await db.startRun(DB, 's1');
    await db.linkListingToCombo(DB, 's1', '1', combo(), runId);
    await db.finishRun(DB, runId, { pagesFetched: 1, listingsSeen: 1, newCount: 1, priceDropCount: 0 });
  };
  const first = async (opts = {}) => (await db.getResults(DB, 's1', opts))[0]!;

  it('keeps why a car was shortlisted, and why one was ruled out', async () => {
    await seedOne();

    await db.setStarred(DB, '1', true, 'closest one with FSH');
    await db.setDiscarded(DB, '1', true, 'sills look rusty in photo 12');

    const listing = await first({ includeDiscarded: true });
    expect(listing.starNote).toBe('closest one with FSH');
    expect(listing.discardReason).toBe('sills look rusty in photo 12');
  });

  it('leaves the reason alone when the decision is repeated without one', async () => {
    await seedOne();
    await db.setStarred(DB, '1', true, 'closest one with FSH');

    // Starring again with no note must not wipe what you wrote — this is the
    // difference between "no opinion" and "clear it".
    await db.setStarred(DB, '1', true);

    expect((await first()).starNote).toBe('closest one with FSH');
  });

  it('clears the reason when one is explicitly emptied', async () => {
    await seedOne();
    await db.setStarred(DB, '1', true, 'wrong, actually');

    await db.setStarred(DB, '1', true, null);

    expect((await first()).starNote).toBeNull();
  });

  it('forgets the reason once the decision is undone', async () => {
    await seedOne();
    await db.setDiscarded(DB, '1', true, 'rusty sills');

    await db.setDiscarded(DB, '1', false);
    await db.setDiscarded(DB, '1', true);

    // The reason belonged to a decision that was reversed; carrying it into a
    // fresh one would be putting words in your mouth.
    expect((await first({ includeDiscarded: true })).discardReason).toBeNull();
  });

  it('has no reason until one is written', async () => {
    await seedOne();
    await db.setStarred(DB, '1', true);

    expect((await first()).starNote).toBeNull();
  });
});

describe('global filters and discarding', () => {
  const seed = async (listings: Parameters<typeof searchListing>[0][]) => {
    const runId = await db.startRun(DB, 's1');
    for (const overrides of listings) {
      const listing = searchListing(overrides);
      await db.upsertSearchListing(DB, listing);
      await db.recordPrice(DB, listing.advertId, listing.price);
      await db.linkListingToCombo(DB, 's1', listing.advertId, combo(), runId);
    }
    await db.finishRun(DB, runId, {
      pagesFetched: 1, listingsSeen: listings.length, newCount: listings.length, priceDropCount: 0,
    });
  };

  it('round-trips global filters', async () => {
    await db.upsertSearch(DB, savedSearch({ globalFilters: { max_price: ['8000'] } }));
    expect((await db.getSearch(DB, 's1'))!.globalFilters).toEqual({ max_price: ['8000'] });
  });

  it('reads a row written before the column existed as having no globals', async () => {
    // What the migration actually produces: ALTER TABLE ... NOT NULL DEFAULT
    // '{}' backfills existing rows, so an insert that never mentions the column
    // is the faithful stand-in for a pre-migration row.
    await DB.prepare(
      `INSERT INTO searches (id, name, postcode, radius, combos_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('legacy', 'Old search', 'SW1A 1AA', '50', '[]', '2026-01-01', '2026-01-01')
      .run();

    expect((await db.getSearch(DB, 'legacy'))!.globalFilters).toEqual({});
  });

  /**
   * The whole point of read-time verification: tightening a global must take
   * effect immediately, without waiting for the next refresh.
   */
  it('retro-filters stored listings when a global is tightened', async () => {
    await db.upsertSearch(DB, savedSearch());
    await seed([{ advertId: 'cheap', price: 6500 }, { advertId: 'dear', price: 7800 }]);
    expect(await db.getResults(DB, 's1')).toHaveLength(2);

    await db.upsertSearch(DB, savedSearch({ globalFilters: { max_price: ['7000'] } }));

    expect((await db.getResults(DB, 's1')).map((r) => r.advertId)).toEqual(['cheap']);
  });

  it('lets a combination override a global that would exclude it', async () => {
    await db.upsertSearch(DB, savedSearch());
    await seed([{ advertId: 'dear', price: 7800 }]);

    await db.upsertSearch(
      DB,
      savedSearch({
        globalFilters: { max_price: ['7000'] },
        combos: [combo({ max_price: ['9000'] })],
      }),
    );

    expect(await db.getResults(DB, 's1')).toHaveLength(1);
  });

  it('hides a discarded car, and restores it', async () => {
    await db.upsertSearch(DB, savedSearch());
    await seed([{ advertId: '1' }, { advertId: '2' }]);

    await db.setDiscarded(DB, '1', true);

    expect((await db.getResults(DB, 's1')).map((r) => r.advertId)).toEqual(['2']);
    expect(await db.countDiscarded(DB, 's1')).toBe(1);

    // Visible on request, and flagged so the UI can show it differently.
    const withDiscarded = await db.getResults(DB, 's1', { includeDiscarded: true });
    expect(withDiscarded).toHaveLength(2);
    expect(withDiscarded.find((r) => r.advertId === '1')!.discarded).toBe(true);

    await db.setDiscarded(DB, '1', false);
    expect(await db.getResults(DB, 's1')).toHaveLength(2);
  });

  it('hides a discarded car from every search that finds it', async () => {
    await db.upsertSearch(DB, savedSearch());
    await db.upsertSearch(DB, savedSearch({ id: 's2', name: 'Other' }));
    await seed([{ advertId: '1' }]);
    const runId = await db.startRun(DB, 's2');
    await db.linkListingToCombo(DB, 's2', '1', combo(), runId);
    await db.finishRun(DB, runId, { pagesFetched: 1, listingsSeen: 1, newCount: 1, priceDropCount: 0 });
    expect(await db.getResults(DB, 's2')).toHaveLength(1);

    await db.setDiscarded(DB, '1', true);

    expect(await db.getResults(DB, 's1')).toHaveLength(0);
    expect(await db.getResults(DB, 's2')).toHaveLength(0);
  });

  it('keeps a discarded car hidden when it is seen again', async () => {
    await db.upsertSearch(DB, savedSearch());
    await seed([{ advertId: '1' }]);
    await db.setDiscarded(DB, '1', true);

    // A later run re-links the same advert.
    await seed([{ advertId: '1' }]);

    expect(await db.getResults(DB, 's1')).toHaveLength(0);
  });
});
