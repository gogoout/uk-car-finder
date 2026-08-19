import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { combo, resetDb, savedSearch, searchListing } from './helpers';
import * as db from '../../src/db/queries';
import DETAIL_HTML from '../fixtures/car-details-202601269420779-fullhistory.html?raw';

let env: { DB: D1Database };

beforeEach(async () => {
  env = { DB: await resetDb() };
  vi.restoreAllMocks();
});

// The route only needs waitUntil; the rest of ExecutionContext is irrelevant
// here, so it is stubbed rather than faithfully reproduced. Deferred work is
// captured so tests can await it.
const ctx = {
  waitUntil: (p: Promise<unknown>) => waited.push(p),
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const waited: Promise<unknown>[] = [];
const call = (path: string) =>
  worker.fetch(new Request(`https://example.com${path}`), env as never, ctx);

describe('GET /api/listings/:advertId/detail', () => {
  it('returns the parsed advert', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(DETAIL_HTML, { status: 200 }),
    );

    const res = await call('/api/listings/202601269420779/detail');
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.images).toHaveLength(32);
    expect(body.title).toBe('2015 Mazda Mazda2');
    expect(body.serviceHistory).toBe('FULL');
    expect(body.features.length).toBeGreaterThan(0);
  });

  it('rejects an id that is not an advert id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await call('/api/listings/..%2Fetc%2Fpasswd/detail');

    expect(res.status).toBe(400);
    // Must not reach AutoTrader with a rubbish id.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('records a sold advert and stops showing it', async () => {
    await db.upsertSearch(env.DB, savedSearch());
    await db.upsertSearchListing(env.DB, searchListing({ advertId: '202601269420779' }));
    const runId = await db.startRun(env.DB, 's1');
    await db.linkListingToCombo(env.DB, 's1', '202601269420779', combo(), runId);
    await db.finishRun(env.DB, runId, {
      pagesFetched: 1,
      listingsSeen: 1,
      newCount: 1,
      priceDropCount: 0,
    });
    expect(await db.getResults(env.DB, 's1')).toHaveLength(1);

    // The page still renders — it just has no advert in it any more.
    const hydration = JSON.stringify({ loaderData: { 'car-details': {} } });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        `<script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(hydration)})</script>`,
        { status: 200 },
      ),
    );

    const res = await call('/api/listings/202601269420779/detail');
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).gone).toBe(true);

    await Promise.all(waited.splice(0));

    expect(await db.getResults(env.DB, 's1')).toHaveLength(0);
    expect(await db.getResults(env.DB, 's1', { includeGone: true })).toHaveLength(1);
    expect(await db.countGone(env.DB, 's1')).toBe(1);
  });

  it('says plainly when the advert has sold rather than reporting a failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('gone', { status: 404 }));

    const res = await call('/api/listings/202601269420779/detail');

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.gone).toBe(true);
    expect(body.error).toContain('no longer on AutoTrader');
  });

  it('reports an upstream failure as a bad gateway', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));

    const res = await call('/api/listings/202601269420779/detail');

    expect(res.status).toBe(502);
    expect((await res.json() as any).gone).toBe(false);
  });

  it('does not fall over on a page whose layout has changed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>nothing to parse</body></html>', { status: 200 }),
    );

    const res = await call('/api/listings/202601269420779/detail');

    expect(res.status).toBe(502);
    expect((await res.json() as any).error).toContain('__staticRouterHydrationData');
  });
});

/**
 * Opening a car is the main thing that refreshes its stored record. It costs no
 * extra request — the modal already fetches the page — and it means a listing
 * enriched before a field existed repairs itself the moment you look at it.
 */
describe('write-back on detail fetch', () => {
  it('updates the stored listing from the freshly fetched page', async () => {
    await db.upsertSearchListing(env.DB, searchListing({ advertId: '202601269420779' }));
    let row = await env.DB.prepare('SELECT advert_text, service_history FROM listings WHERE advert_id = ?')
      .bind('202601269420779')
      .first<any>();
    expect(row.advert_text).toBeNull();
    expect(row.service_history).toBeNull();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(DETAIL_HTML, { status: 200 }));
    await call('/api/listings/202601269420779/detail');
    await Promise.all(waited.splice(0));

    row = await env.DB.prepare('SELECT advert_text, service_history FROM listings WHERE advert_id = ?')
      .bind('202601269420779')
      .first<any>();
    expect(row.service_history).toBe('FULL');
    expect(row.advert_text).toContain('Mazda 2');
  });

  it('still returns the advert when there is no stored listing to update', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(DETAIL_HTML, { status: 200 }));

    const res = await call('/api/listings/202601269420779/detail');
    await Promise.all(waited.splice(0));

    expect(res.status).toBe(200);
  });
});
