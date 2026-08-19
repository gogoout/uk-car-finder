import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';
import * as db from '../../src/db/queries';
import {
  getMotHistory,
  readMotCache,
  readMotCacheMany,
  TTL_MS,
  writeMotCache,
} from '../../src/db/motCache';
import { combo, resetDb, savedSearch, searchListing } from './helpers';
import type { MotRaw } from '../../src/types';

let DB: D1Database;

beforeEach(async () => {
  DB = await resetDb();
  vi.restoreAllMocks();
});

const motRaw = (mileages: number[]): MotRaw => ({
  registration: 'AB12CDE',
  make: 'MINI',
  model: 'COOPER',
  motTests: mileages.map((miles, i) => ({
    completedDate: `${2020 + i}-05-12T00:00:00.000Z`,
    testResult: 'PASSED',
    expiryDate: `${2021 + i}-05-11`,
    odometerValue: String(miles),
    odometerUnit: 'MI',
  })),
});

describe('mot cache', () => {
  it('round-trips DVSA’s payload unchanged', async () => {
    await writeMotCache(DB, 'AB12CDE', motRaw([40000, 52000]));

    const cached = await readMotCache(DB, 'AB12CDE');

    // Stored verbatim: the verdict is derived on read, so nothing about the
    // payload may be trimmed on the way in.
    expect(cached!.raw.motTests).toHaveLength(2);
    expect(cached!.raw.make).toBe('MINI');
    expect(cached!.stale).toBe(false);
  });

  it('marks an entry stale once the TTL has passed', async () => {
    const written = new Date(Date.now() - TTL_MS - 1000).toISOString();
    await writeMotCache(DB, 'AB12CDE', motRaw([40000]), written);

    expect((await readMotCache(DB, 'AB12CDE'))!.stale).toBe(true);
  });

  it('reads many plates at once, skipping those never looked up', async () => {
    await writeMotCache(DB, 'AB12CDE', motRaw([40000]));

    const found = await readMotCacheMany(DB, ['AB12CDE', 'ZZ99ZZZ']);

    expect([...found.keys()]).toEqual(['AB12CDE']);
  });

  it('returns an empty map for a search with no plates on file', async () => {
    // Guards the `IN ()` case, which is not valid SQL.
    expect(await readMotCacheMany(DB, [])).toEqual(new Map());
  });
});

describe('getMotHistory', () => {
  it('fetches on a miss and serves the cache afterwards', async () => {
    const fetcher = vi.fn().mockResolvedValue(motRaw([40000]));

    expect((await getMotHistory(DB, 'AB12CDE', fetcher)).source).toBe('network');
    expect((await getMotHistory(DB, 'AB12CDE', fetcher)).source).toBe('cache');
    // MOT history changes once a year; DVSA should be asked about as often.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refetches once the entry is stale', async () => {
    const fetcher = vi.fn().mockResolvedValue(motRaw([40000]));
    const start = Date.now();

    await getMotHistory(DB, 'AB12CDE', fetcher, { now: start });
    await getMotHistory(DB, 'AB12CDE', fetcher, { now: start + TTL_MS + 1000 });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refetches on demand when you ask for a re-check', async () => {
    const fetcher = vi.fn().mockResolvedValue(motRaw([40000]));

    await getMotHistory(DB, 'AB12CDE', fetcher);
    const forced = await getMotHistory(DB, 'AB12CDE', fetcher, { force: true });

    expect(forced.source).toBe('network');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('serves the stored copy when DVSA is unreachable', async () => {
    const start = Date.now();
    await getMotHistory(DB, 'AB12CDE', vi.fn().mockResolvedValue(motRaw([40000])), { now: start });

    const result = await getMotHistory(DB, 'AB12CDE', vi.fn().mockRejectedValue(new Error('DVSA down')), {
      now: start + TTL_MS + 1000,
    });

    // Last week's MOT history is the same MOT history.
    expect(result.source).toBe('stale-fallback');
    expect(result.raw.motTests).toHaveLength(1);
  });

  it('propagates the failure when there is nothing stored to fall back on', async () => {
    await expect(
      getMotHistory(DB, 'AB12CDE', vi.fn().mockRejectedValue(new Error('DVSA down'))),
    ).rejects.toThrow('DVSA down');
  });
});

/* ------------------------------------------------------------------- routes */

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const DVSA_ENV = {
  DVSA_CLIENT_ID: 'id',
  DVSA_CLIENT_SECRET: 'secret',
  DVSA_API_KEY: 'key',
  DVSA_TOKEN_URL: 'https://login.example.com/token',
};

const call = (path: string, extra: Record<string, string> = DVSA_ENV) =>
  worker.fetch(new Request(`https://example.com${path}`), { DB, ...extra } as never, ctx);

/**
 * Answers by URL rather than by call order: the OAuth token is cached for the
 * life of the module, so after the first test the token request simply doesn't
 * happen and an ordered stub would hand the token to the MOT call instead.
 */
function stubDvsa(mot: () => Response) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    return url.includes('login.example.com')
      ? new Response(JSON.stringify({ access_token: 't' }), { status: 200 })
      : mot();
  });
}

describe('GET /api/listings/:advertId/mot', () => {
  beforeEach(async () => {
    await db.upsertSearch(DB, savedSearch());
    await db.upsertSearchListing(DB, searchListing({ advertId: '1', mileage: 48000 }));
  });

  it('compares the MOT reading against what the advert claims', async () => {
    await db.setVrm(DB, '1', 'ab12 cde');
    stubDvsa(() => new Response(JSON.stringify(motRaw([40000, 52000, 61000])), { status: 200 }));

    const res = await call('/api/listings/1/mot');
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.latestOdometer).toBe(61000);
    // 61,000 on the last test against 48,000 advertised.
    expect(body.mileageMismatch).toBe(13000);
    expect(body.source).toBe('network');
  });

  it('asks for a plate rather than failing when none is on file', async () => {
    const res = await call('/api/listings/1/mot');

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toContain('registration plate');
  });

  it('reports missing credentials as unconfigured, not as a failure', async () => {
    await db.setVrm(DB, '1', 'AB12CDE');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await call('/api/listings/1/mot', {});

    expect(res.status).toBe(501);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('distinguishes a plate DVSA has never heard of from a broken lookup', async () => {
    await db.setVrm(DB, '1', 'AB12CDE');
    stubDvsa(() => new Response('not found', { status: 404 }));

    const res = await call('/api/listings/1/mot');

    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error).toContain('no MOT record');
  });

  it('reports a DVSA outage as an outage', async () => {
    await db.setVrm(DB, '1', 'AB12CDE');
    stubDvsa(() => new Response('boom', { status: 500 }));

    const res = await call('/api/listings/1/mot');

    expect(res.status).toBe(502);
  });
});

describe('results carry the MOT verdict', () => {
  it('derives the summary for cars with a plate, and nothing for the rest', async () => {
    await db.upsertSearch(DB, savedSearch());
    const runId = await db.startRun(DB, 's1');
    await db.upsertSearchListing(DB, searchListing({ advertId: '1', mileage: 48000 }));
    await db.upsertSearchListing(DB, searchListing({ advertId: '2' }));
    await db.linkListingToCombo(DB, 's1', '1', combo(), runId);
    await db.linkListingToCombo(DB, 's1', '2', combo(), runId);
    await db.setVrm(DB, '1', 'AB12CDE');
    // An odometer that goes backwards between two tests.
    await writeMotCache(DB, 'AB12CDE', motRaw([80000, 52000]));

    const results = await db.getResults(DB, 's1');
    const withPlate = results.find((r) => r.advertId === '1')!;
    const without = results.find((r) => r.advertId === '2')!;

    expect(withPlate.motSummary).toMatchObject({ possibleClocking: true, testCount: 2 });
    expect(without.motSummary).toBeNull();
  });

  it('re-judges a stored payload rather than replaying an old verdict', async () => {
    await db.upsertSearch(DB, savedSearch());
    const runId = await db.startRun(DB, 's1');
    await db.upsertSearchListing(DB, searchListing({ advertId: '1', mileage: 48000 }));
    await db.linkListingToCombo(DB, 's1', '1', combo(), runId);
    await db.setVrm(DB, '1', 'AB12CDE');
    await writeMotCache(DB, 'AB12CDE', motRaw([40000, 61000]));

    expect((await db.getResults(DB, 's1'))[0]!.motSummary!.mileageMismatch).toBe(13000);

    // Correct the advertised mileage and the verdict follows, with no refetch:
    // nothing about the comparison is stored.
    await DB.prepare('UPDATE listings SET mileage = ? WHERE advert_id = ?').bind(62000, '1').run();

    expect((await db.getResults(DB, 's1'))[0]!.motSummary!.mileageMismatch).toBeNull();
  });
});
