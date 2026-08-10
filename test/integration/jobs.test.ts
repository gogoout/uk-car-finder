import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshSearch } from '../../src/jobs/refresh';
import { drainDetailQueue } from '../../src/jobs/drain';
import * as db from '../../src/db/queries';
import { combo, resetDb, savedSearch } from './helpers';
import DETAIL_HTML from '../fixtures/car-details-202601269420779-fullhistory.html?raw';

let DB: D1Database;

beforeEach(async () => {
  DB = await resetDb();
});

const gatewayPage = (ids: string[], price = '£6,000', pageCount = 1) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        searchResults: {
          listings: ids.map((id) => ({
            advertId: id,
            title: 'MINI Cooper',
            subTitle: 'S 1.5 3dr',
            price,
            fpaLink: `/car-details/${id}?sort=relevance`,
            badges: [
              { type: 'MILEAGE', displayText: '64,639 miles' },
              { type: 'REGISTERED_YEAR', displayText: '2016 (66 reg)' },
            ],
          })),
          page: { number: 1, count: pageCount, results: { count: ids.length } },
        },
      },
    }),
  }) as Response;

describe('refreshSearch', () => {
  it('stores listings, links combos, queues details and records a run', async () => {
    const search = savedSearch();
    await db.upsertSearch(DB, search);
    const fetchImpl = vi.fn().mockResolvedValue(gatewayPage(['1', '2']));

    const result = await refreshSearch(DB, search, { fetchImpl, delayMs: 0 });

    expect(result).toMatchObject({ listingsSeen: 2, newCount: 2, pagesFetched: 1, rejectedCount: 0 });

    const results = await db.getResults(DB, 's1');
    expect(results).toHaveLength(2);
    expect(results[0]!.matchedCombos).toEqual(['MINI Cooper 1.5 Auto']);
    expect(results.every((r) => r.isNew)).toBe(true);

    // Both are new, so both need a detail fetch.
    expect(await db.queueDepth(DB)).toBe(2);

    const [run] = await db.listRuns(DB, 's1');
    expect(run).toMatchObject({ listings_seen: 2, new_count: 2, error: null });
    expect(run!.finished_at).not.toBeNull();
    expect((await db.getSearch(DB, 's1'))!.lastRunAt).not.toBeNull();
  });

  it('counts a price drop on the second run and does not re-queue a known listing', async () => {
    const search = savedSearch();
    await db.upsertSearch(DB, search);

    await refreshSearch(DB, search, {
      fetchImpl: vi.fn().mockResolvedValue(gatewayPage(['1'], '£7,000')),
      delayMs: 0,
    });
    await db.dequeueDetail(DB, '1');

    const second = await refreshSearch(DB, search, {
      fetchImpl: vi.fn().mockResolvedValue(gatewayPage(['1'], '£6,500')),
      delayMs: 0,
    });

    expect(second.newCount).toBe(0);
    expect(second.priceDropCount).toBe(1);
    expect(await db.queueDepth(DB)).toBe(0);

    const [result] = await db.getResults(DB, 's1');
    expect(result!.price).toBe(6500);
    expect(result!.priceDrop).toBe(500);
    expect(result!.isNew).toBe(false);
  });

  it('discards promoted adverts that ignore the combo bounds', async () => {
    const search = savedSearch({
      combos: [combo({ maxPrice: 8000, minYear: 2015 })],
    });
    await db.upsertSearch(DB, search);

    // Mirrors what AutoTrader actually returns: two genuine matches plus a
    // promoted advert well outside the price cap.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          searchResults: {
            listings: [
              { advertId: '1', title: 'MINI Cooper', price: '£6,500', fpaLink: '/car-details/1', badges: [{ type: 'REGISTERED_YEAR', displayText: '2016 (66 reg)' }] },
              { advertId: '2', title: 'MINI Cooper', price: '£17,250', fpaLink: '/car-details/2', badges: [{ type: 'REGISTERED_YEAR', displayText: '2024 (24 reg)' }] },
              { advertId: '3', title: 'MINI Cooper', price: '£7,000', fpaLink: '/car-details/3', badges: [{ type: 'REGISTERED_YEAR', displayText: '2015 (15 reg)' }] },
            ],
            page: { number: 1, count: 1, results: { count: 2 } },
          },
        },
      }),
    } as Response);

    const result = await refreshSearch(DB, search, { fetchImpl, delayMs: 0 });

    expect(result.listingsSeen).toBe(2);
    expect(result.rejectedCount).toBe(1);
    expect((await db.getResults(DB, 's1')).map((r) => r.advertId).sort()).toEqual(['1', '3']);
    // The rejected advert must not be stored or queued for enrichment either.
    expect(await db.queueDepth(DB)).toBe(2);
  });

  it('keeps going when one combo fails and records the failure on the run', async () => {
    const search = savedSearch({
      combos: [combo({ id: 'c1', label: 'Broken' }), combo({ id: 'c2', label: 'Working' })],
    });
    await db.upsertSearch(DB, search);

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400 } as Response)
      .mockResolvedValue(gatewayPage(['1']));

    const result = await refreshSearch(DB, search, { fetchImpl, delayMs: 0, maxAttempts: 1 });

    expect(result.error).toContain('Broken');
    expect(result.listingsSeen).toBe(1);
    expect((await db.getResults(DB, 's1'))[0]!.matchedCombos).toEqual(['Working']);
  });
});

describe('drainDetailQueue', () => {
  it('enriches queued listings from their detail pages', async () => {
    const search = savedSearch();
    await db.upsertSearch(DB, search);
    await refreshSearch(DB, search, {
      fetchImpl: vi.fn().mockResolvedValue(gatewayPage(['1'])),
      delayMs: 0,
    });

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => DETAIL_HTML,
    } as Response);

    const drained = await drainDetailQueue(DB, { fetchImpl, delayMs: 0 });

    expect(drained).toMatchObject({ attempted: 1, succeeded: 1, failed: 0, remaining: 0 });

    const [result] = await db.getResults(DB, 's1');
    expect(result!.serviceHistory).toBe('FULL');
    expect(result!.transmission).toBe('Automatic');
    expect(result!.imported).toBe('FAILED');
    expect(result!.detailFetchedAt).not.toBeNull();
  });

  it('unlinks a listing whose detail page contradicts the combo', async () => {
    // The fixture is a 1.3L automatic; this combo wants 1.5-2.0L, which only
    // the detail page can disprove since engine size isn't in search results.
    const search = savedSearch({
      combos: [combo({ minEngineLitres: 1.5, maxEngineLitres: 2.0 })],
    });
    await db.upsertSearch(DB, search);
    await refreshSearch(DB, search, {
      fetchImpl: vi.fn().mockResolvedValue(gatewayPage(['1'])),
      delayMs: 0,
    });
    expect(await db.getResults(DB, 's1')).toHaveLength(1);

    const drained = await drainDetailQueue(DB, {
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => DETAIL_HTML } as Response),
      delayMs: 0,
    });

    expect(drained.unlinked).toBe(1);
    expect(await db.getResults(DB, 's1')).toHaveLength(0);
  });

  it('keeps a listing linked when the detail page agrees with the combo', async () => {
    const search = savedSearch({
      combos: [combo({ minEngineLitres: 1.2, maxEngineLitres: 1.4, transmission: 'Automatic' })],
    });
    await db.upsertSearch(DB, search);
    await refreshSearch(DB, search, {
      fetchImpl: vi.fn().mockResolvedValue(gatewayPage(['1'])),
      delayMs: 0,
    });

    const drained = await drainDetailQueue(DB, {
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => DETAIL_HTML } as Response),
      delayMs: 0,
    });

    expect(drained.unlinked).toBe(0);
    expect(await db.getResults(DB, 's1')).toHaveLength(1);
  });

  it('leaves a failed fetch queued for retry and keeps draining the rest', async () => {
    await db.enqueueDetail(DB, 'bad');
    await db.enqueueDetail(DB, 'good');
    await db.upsertSearchListing(DB, {
      advertId: 'good',
      title: 'MINI',
      subTitle: null,
      attentionGrabber: null,
      price: null,
      mileage: null,
      year: null,
      plateReg: null,
      priceIndicator: null,
      sellerType: null,
      detailPath: '/car-details/good',
      imageCount: null,
    });

    const fetchImpl = vi.fn().mockImplementation((url: string) =>
      url.includes('bad')
        ? Promise.resolve({ ok: false, status: 404 } as Response)
        : Promise.resolve({ ok: true, status: 200, text: async () => DETAIL_HTML } as Response),
    );

    const drained = await drainDetailQueue(DB, { fetchImpl, delayMs: 0, maxAttempts: 1 });

    expect(drained).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
    expect(drained.remaining).toBe(1);

    const row = await DB.prepare('SELECT attempts, last_error FROM fetch_queue WHERE advert_id = ?')
      .bind('bad')
      .first<any>();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toContain('404');
  });

  it('respects the batch size so a big backlog cannot blow the subrequest budget', async () => {
    for (let i = 0; i < 10; i++) await db.enqueueDetail(DB, `id-${i}`);

    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => DETAIL_HTML } as Response);

    const drained = await drainDetailQueue(DB, { fetchImpl, delayMs: 0, batchSize: 3 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(drained.attempted).toBe(3);
    expect(drained.remaining).toBe(7);
  });
});
