import { Hono } from 'hono';
import * as db from './db/queries';
import { refreshAllSearches, refreshSearch } from './jobs/refresh';
import { drainDetailQueue } from './jobs/drain';
import { fetchMotHistory, isMotConfigured } from './mot/dvsa';
import type { Combo, SavedSearch } from './types';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  // DVSA MOT History API — set with `wrangler secret put`, never committed.
  DVSA_CLIENT_ID?: string;
  DVSA_CLIENT_SECRET?: string;
  DVSA_API_KEY?: string;
  DVSA_TOKEN_URL?: string;
}

const app = new Hono<{ Bindings: Env }>();

/** URL-safe, unambiguous alphabet — no 0/O or 1/l to misread over a message. */
const ID_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';

function shortId(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

class BadRequest extends Error {}

function parseCombos(input: unknown): Combo[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new BadRequest('At least one search combination is required');
  }

  return input.map((raw, index): Combo => {
    const combo = raw as Partial<Combo>;
    if (!combo.make) throw new BadRequest(`Combination ${index + 1} needs a make`);

    const num = (value: unknown): number | undefined => {
      if (value === undefined || value === null || value === '') return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new BadRequest(`Invalid number: ${String(value)}`);
      return parsed;
    };

    return {
      id: combo.id || shortId(6),
      label: combo.label?.trim() || [combo.make, combo.model].filter(Boolean).join(' '),
      make: combo.make,
      model: combo.model || undefined,
      minYear: num(combo.minYear),
      maxYear: num(combo.maxYear),
      minEngineLitres: num(combo.minEngineLitres),
      maxEngineLitres: num(combo.maxEngineLitres),
      maxMileage: num(combo.maxMileage),
      minPrice: num(combo.minPrice),
      maxPrice: num(combo.maxPrice),
      transmission:
        combo.transmission === 'Automatic' || combo.transmission === 'Manual'
          ? combo.transmission
          : undefined,
      excludeWriteOffs: Boolean(combo.excludeWriteOffs),
    };
  });
}

function parseSearchBody(body: any, id: string): Omit<SavedSearch, 'createdAt' | 'updatedAt' | 'lastRunAt'> {
  const postcode = String(body?.postcode ?? '').trim();
  if (!postcode) throw new BadRequest('A postcode is required — AutoTrader searches need one');

  const rawRadius = body?.radius;
  const radius = rawRadius === 'national' ? 'national' : Number(rawRadius ?? 50);
  if (radius !== 'national' && !Number.isFinite(radius)) throw new BadRequest('Invalid radius');

  return {
    id,
    name: String(body?.name ?? '').trim() || 'Untitled search',
    postcode,
    radius,
    combos: parseCombos(body?.combos),
  };
}

app.onError((err, c) => {
  if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
  console.error('Unhandled error', err);
  return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
});

/* --------------------------------------------------------------------- routes */

app.get('/api/health', (c) =>
  c.json({ ok: true, motConfigured: isMotConfigured(c.env) }),
);

app.get('/api/searches', async (c) => c.json(await db.listSearches(c.env.DB)));

app.post('/api/searches', async (c) => {
  const body = await c.req.json();
  const search = parseSearchBody(body, shortId());
  return c.json(await db.upsertSearch(c.env.DB, search), 201);
});

app.get('/api/searches/:id', async (c) => {
  const search = await db.getSearch(c.env.DB, c.req.param('id'));
  return search ? c.json(search) : c.json({ error: 'Not found' }, 404);
});

app.put('/api/searches/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await db.getSearch(c.env.DB, id))) return c.json({ error: 'Not found' }, 404);
  const search = parseSearchBody(await c.req.json(), id);
  return c.json(await db.upsertSearch(c.env.DB, search));
});

app.delete('/api/searches/:id', async (c) => {
  await db.deleteSearch(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

app.get('/api/searches/:id/results', async (c) => {
  const id = c.req.param('id');
  const search = await db.getSearch(c.env.DB, id);
  if (!search) return c.json({ error: 'Not found' }, 404);

  const results = await db.getResults(c.env.DB, id, {
    excludeWriteOffs: c.req.query('excludeWriteOffs') === 'true',
  });

  return c.json({
    search,
    results,
    pendingDetails: await db.queueDepth(c.env.DB),
  });
});

app.get('/api/searches/:id/runs', async (c) =>
  c.json(await db.listRuns(c.env.DB, c.req.param('id'))),
);

/** Manual "refresh now" — the cron does the same thing on a schedule. */
app.post('/api/searches/:id/refresh', async (c) => {
  const search = await db.getSearch(c.env.DB, c.req.param('id'));
  if (!search) return c.json({ error: 'Not found' }, 404);

  const result = await refreshSearch(c.env.DB, search);
  // Enrich a few of the newly-queued listings immediately so a manual refresh
  // shows service history straight away rather than only after the next cron.
  const drained = await drainDetailQueue(c.env.DB, { batchSize: 8 });

  return c.json({ ...result, drained });
});

app.post('/api/listings/:advertId/star', async (c) => {
  const advertId = c.req.param('advertId');
  const { starred } = (await c.req.json()) as { starred?: boolean };
  await db.setStarred(c.env.DB, advertId, starred !== false);
  return c.json({ ok: true });
});

app.put('/api/listings/:advertId/vrm', async (c) => {
  const advertId = c.req.param('advertId');
  const { vrm } = (await c.req.json()) as { vrm?: string | null };
  await db.setVrm(c.env.DB, advertId, vrm ?? null);
  return c.json({ ok: true });
});

/**
 * MOT history for a plate. AutoTrader doesn't publish the VRM, so this is
 * driven by what you type in on a starred car (occasionally pre-filled from a
 * dealer deep-link).
 */
app.get('/api/mot/:vrm', async (c) => {
  if (!isMotConfigured(c.env)) {
    return c.json({ error: 'DVSA MOT credentials are not configured' }, 501);
  }
  try {
    return c.json(await fetchMotHistory(c.env, c.req.param('vrm')));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'MOT lookup failed' }, 502);
  }
});

// Anything else is the SPA — including /s/:id share links.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // The 4-hourly trigger re-runs searches; the 15-minute one only drains the
    // detail queue, which is what keeps us inside the subrequest budget.
    const isSearchRefresh = event.cron === '0 */4 * * *';

    ctx.waitUntil(
      (async () => {
        if (isSearchRefresh) {
          const results = await refreshAllSearches(env.DB);
          console.log('Refreshed searches', JSON.stringify(results));
        }
        const drained = await drainDetailQueue(env.DB);
        console.log('Drained detail queue', JSON.stringify(drained));
      })(),
    );
  },
};
