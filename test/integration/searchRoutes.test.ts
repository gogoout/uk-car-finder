import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/index';
import * as db from '../../src/db/queries';
import { combo, resetDb, savedSearch, searchListing } from './helpers';
import type { SavedSearch } from '../../src/types';

let env: { DB: D1Database };

beforeEach(async () => {
  env = { DB: await resetDb() };
});

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const post = (body: unknown) =>
  worker.fetch(
    new Request('https://example.com/api/searches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env as never,
    ctx,
  );

const search = (combos: unknown[]) => ({
  name: 'Small autos',
  postcode: 'SW1A 1AA',
  radius: 50,
  globalFilters: {},
  combos,
});

describe('POST /api/searches', () => {
  it('still refuses a live combination with no make', async () => {
    // Without one it would match the entire site.
    const res = await post(search([{ id: 'c1', label: 'Anything', filters: {} }]));

    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toContain('needs a make');
  });

  it('accepts a switched-off combination with no make', async () => {
    // Parked and half-built is a legitimate state: it never runs.
    const res = await post(
      search([
        { id: 'c1', label: 'MINI', filters: { make: ['MINI'] } },
        { id: 'c2', label: 'Half-built', enabled: false, filters: {} },
      ]),
    );

    expect(res.status).toBe(201);
    expect(((await res.json()) as SavedSearch).combos[1]!.enabled).toBe(false);
  });

  it('remembers that a combination is off, and that a label is your own', async () => {
    // The round trip is the point: both flags used to be written correctly and
    // then dropped on the way back out, so the toggle would appear to work
    // until the page was reloaded.
    const created = (await (
      await post(
        search([
          { id: 'c1', label: 'My wording', labelIsCustom: true, filters: { make: ['MINI'] } },
          { id: 'c2', label: 'Parked', enabled: false, filters: { make: ['MAZDA'] } },
        ]),
      )
    ).json()) as SavedSearch;

    const reloaded = await db.getSearch(env.DB, created.id);

    expect(reloaded!.combos[0]!.labelIsCustom).toBe(true);
    expect(reloaded!.combos[1]!.enabled).toBe(false);
  });
});

describe('star and discard routes', () => {
  const call = (path: string, body: unknown) =>
    worker.fetch(
      new Request(`https://example.com${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env as never,
      ctx,
    );

  beforeEach(async () => {
    await db.upsertSearch(env.DB, savedSearch());
    await db.upsertSearchListing(env.DB, searchListing({ advertId: '1' }));
    const runId = await db.startRun(env.DB, 's1');
    await db.linkListingToCombo(env.DB, 's1', '1', combo(), runId);
    await db.finishRun(env.DB, runId, {
      pagesFetched: 1,
      listingsSeen: 1,
      newCount: 1,
      priceDropCount: 0,
    });
  });

  const listing = async () =>
    (await db.getResults(env.DB, 's1', { includeDiscarded: true }))[0]!;

  it('records the reason given with each decision', async () => {
    await call('/api/listings/1/star', { starred: true, note: '  closest with FSH  ' });
    await call('/api/listings/1/discard', { discarded: true, reason: 'rusty sills' });

    const row = await listing();
    // Trimmed on the way in, so a stray space doesn't become a "reason".
    expect(row.starNote).toBe('closest with FSH');
    expect(row.discardReason).toBe('rusty sills');
  });

  it('treats a blank reason as no reason', async () => {
    await call('/api/listings/1/star', { starred: true, note: '   ' });

    expect((await listing()).starNote).toBeNull();
  });

  it('leaves an existing reason alone when the note is not sent', async () => {
    await call('/api/listings/1/star', { starred: true, note: 'closest with FSH' });

    // What the star button sends: a decision, with no opinion on the note.
    await call('/api/listings/1/star', { starred: false });
    await call('/api/listings/1/star', { starred: true });

    // Unstarring dropped the row, so the note went with the decision.
    expect((await listing()).starNote).toBeNull();
  });
});
