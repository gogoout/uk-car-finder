import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/index';
import * as db from '../../src/db/queries';
import { resetDb } from './helpers';
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
