import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import { resetDb } from './helpers';
import DETAIL_HTML from '../fixtures/car-details-202601269420779-fullhistory.html?raw';

let env: { DB: D1Database };

beforeEach(async () => {
  env = { DB: await resetDb() };
  vi.restoreAllMocks();
});

// The route only needs waitUntil; the rest of ExecutionContext is irrelevant
// here, so it is stubbed rather than faithfully reproduced.
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

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
