import { Hono } from 'hono';
import type { Context } from 'hono';
import * as db from './db/queries';
import { refreshAllSearches, refreshSearch } from './jobs/refresh';
import { drainDetailQueue } from './jobs/drain';
import { buildMotHistory, fetchMotRaw, isMotConfigured, MotNotFound, normalisePlate } from './mot/dvsa';
import { getMotHistory } from './db/motCache';
import { fetchFacets } from './autotrader/facets';
import { fetchDetailPage } from './autotrader/gateway';
import { AdvertGone, extractAdvert } from './autotrader/detail';
import { normaliseFullDetail } from './autotrader/fullDetail';
import { normaliseAdvert } from './autotrader/normalise';
import { getFacets, pruneFacetCache } from './db/facetCache';
import { searchLevelFilters, type FilterInput } from './autotrader/filters';
import { FILTER, type Combo, type FilterSelections, type SavedSearch } from './types';

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

/** Guard rails on the open filter bag — the keys are AutoTrader's, not ours. */
const MAX_FILTERS_PER_COMBO = 60;
const MAX_VALUES_PER_FILTER = 60;
const FILTER_NAME_RE = /^[a-z0-9_]{1,64}$/;

/**
 * Validates a combo's filter bag without enumerating the filters themselves —
 * AutoTrader's facet API decides what exists, so hard-coding a list here would
 * silently drop anything new. Unknown names are rejected by their gateway with
 * a clear error, which is a better place for that check than here.
 */
function parseFilters(input: unknown, index: number): FilterSelections {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequest(`Combination ${index + 1} has an invalid filters object`);
  }

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_FILTERS_PER_COMBO) {
    throw new BadRequest(`Combination ${index + 1} has too many filters`);
  }

  const filters: FilterSelections = {};
  for (const [name, raw] of entries) {
    if (!FILTER_NAME_RE.test(name)) {
      throw new BadRequest(`Invalid filter name: ${name}`);
    }
    if (!Array.isArray(raw)) {
      throw new BadRequest(`Filter ${name} must be an array of values`);
    }
    if (raw.length > MAX_VALUES_PER_FILTER) {
      throw new BadRequest(`Filter ${name} has too many values`);
    }

    const values = raw
      .filter((v) => v !== null && v !== undefined && v !== '')
      .map((v) => String(v).slice(0, 200));

    // An empty selection is the absence of the filter, not an empty array —
    // AutoTrader rejects the latter.
    if (values.length > 0) filters[name] = values;
  }

  return filters;
}

function parseCombos(input: unknown): Combo[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new BadRequest('At least one search combination is required');
  }

  return input.map((raw, index): Combo => {
    const combo = (raw ?? {}) as Partial<Combo>;
    const filters = parseFilters(combo.filters, index);
    const enabled = combo.enabled !== false;

    // A combination with no make would match the entire site — but a parked one
    // never runs, so it is allowed to sit there half-built.
    if (enabled && !filters[FILTER.make]?.length) {
      throw new BadRequest(`Combination ${index + 1} needs a make`);
    }

    const derivedLabel = [FILTER.make, FILTER.model, FILTER.variant]
      .flatMap((name) => filters[name] ?? [])
      .join(' ');

    return {
      id: combo.id || shortId(6),
      label: combo.label?.trim() || derivedLabel || 'Untitled combination',
      labelIsCustom: Boolean(combo.labelIsCustom),
      enabled,
      filters,
    };
  });
}

/**
 * Absent means "leave the stored note alone"; blank means "clear it". Keeping
 * those apart is what lets the star be toggled without losing what you wrote.
 */
function cleanNote(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim().slice(0, 500);
  return trimmed || null;
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
    // Reuses the same generic validator as a combination's bag — the keys are
    // AutoTrader's filter names either way.
    globalFilters: parseFilters(body?.globalFilters, 0),
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

/**
 * Filter options for the editor, proxied from AutoTrader's own facet API and
 * cached in D1.
 *
 * The Make/Model/Variant cascade falls out of this: post the filters chosen so
 * far and AutoTrader returns the valid children — no make means no models, and
 * a model unlocks that model's variants.
 */
app.post('/api/facets', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    filters?: unknown;
    postcode?: string;
    radius?: number | 'national';
  };

  const selections = parseFilters(body.filters, 0);
  const filters: FilterInput[] = Object.entries(selections).map(([filter, selected]) => ({
    filter,
    selected,
  }));

  // A postcode isn't needed for facets, but including it makes the result
  // counts reflect the area actually being searched.
  if (body.postcode) {
    const searchLevel = searchLevelFilters({
      postcode: body.postcode,
      radius: body.radius ?? 'national',
    });
    const present = new Set(filters.map((f) => f.filter));
    filters.push(...searchLevel.filter((f) => !present.has(f.filter)));
  }

  try {
    const result = await getFacets(c.env.DB, filters, fetchFacets);
    // Housekeeping on a naturally frequent route; failure here is irrelevant.
    c.executionCtx.waitUntil(pruneFacetCache(c.env.DB).catch(() => {}));
    return c.json({ ...result.data, source: result.source, fetchedAt: result.fetchedAt });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Could not load filter options' },
      502,
    );
  }
});

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
    includeDiscarded: c.req.query('includeDiscarded') === 'true',
    includeGone: c.req.query('includeGone') === 'true',
  });

  return c.json({
    search,
    results,
    pendingDetails: await db.queueDepth(c.env.DB),
    discardedCount: await db.countDiscarded(c.env.DB, id),
    goneCount: await db.countGone(c.env.DB, id),
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

/**
 * Everything AutoTrader publishes about one advert, for the detail modal.
 *
 * Fetched live rather than stored: photos, price and availability all change,
 * and keeping ~200KB per listing for the few you actually open would bloat D1
 * for nothing. One request per open, which is user-initiated and rare.
 *
 * That same response is also the freshest view of the fields we *do* store, so
 * it is written back. Opening a car therefore repairs its stored record —
 * corrected service history, a changed description, a check AutoTrader has
 * since published — at no extra request, and with no staleness timer to tune.
 * Cars you never open keep their existing data, which the 4-hourly search
 * refresh continues to update for price and mileage.
 */
app.get('/api/listings/:advertId/detail', async (c) => {
  const advertId = c.req.param('advertId');
  if (!/^\d{6,20}$/.test(advertId)) return c.json({ error: 'Invalid advert id' }, 400);

  try {
    const html = await fetchDetailPage(advertId);
    const advert = extractAdvert(html);

    // Write-back must never delay or break the response the user is waiting
    // for: it is a side benefit of the fetch, not the point of it.
    c.executionCtx.waitUntil(
      db
        .applyDetail(c.env.DB, { ...normaliseAdvert(advert), advertId })
        .catch((err) => console.error('Detail write-back failed', advertId, err)),
    );

    return c.json(normaliseFullDetail(advert, advertId));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not load this advert';
    // Two ways an advert can be gone: a 404, or — far more common — a page that
    // still renders but carries no advert. Both are ordinary, and both are
    // worth recording, so the car stops appearing in results at all.
    const gone = err instanceof AdvertGone || message.includes('404');
    if (gone) {
      c.executionCtx.waitUntil(
        db.markGone(c.env.DB, advertId).catch((e) => console.error('markGone failed', advertId, e)),
      );
    }
    return c.json(
      {
        error: gone
          ? 'This advert is no longer on AutoTrader — it has probably sold.'
          : `Could not load this advert: ${message}`,
        gone,
      },
      gone ? 404 : 502,
    );
  }
});

/** Rule a car out, hiding it from every search that finds it. */
app.post('/api/listings/:advertId/discard', async (c) => {
  const { discarded, reason } = (await c.req.json()) as {
    discarded?: boolean;
    reason?: string | null;
  };
  await db.setDiscarded(c.env.DB, c.req.param('advertId'), discarded !== false, cleanNote(reason));
  return c.json({ ok: true });
});

app.post('/api/listings/:advertId/star', async (c) => {
  const advertId = c.req.param('advertId');
  const { starred, note } = (await c.req.json()) as { starred?: boolean; note?: string | null };
  await db.setStarred(c.env.DB, advertId, starred !== false, cleanNote(note));
  return c.json({ ok: true });
});

app.put('/api/listings/:advertId/vrm', async (c) => {
  const advertId = c.req.param('advertId');
  const { vrm } = (await c.req.json()) as { vrm?: string | null };
  await db.setVrm(c.env.DB, advertId, vrm ?? null);
  return c.json({ ok: true });
});

/**
 * MOT history.
 *
 * AutoTrader doesn't publish the VRM, so this is driven by the plate you type
 * in (occasionally pre-filled from a dealer deep-link). DVSA's payload is
 * cached per plate and everything shown is derived from it on read.
 *
 * The three failure modes are kept distinct because they need different words
 * on screen: no credentials (501), no record for that plate (404), and DVSA
 * being unreachable with nothing cached to fall back on (502).
 */
async function motResponse(
  c: Context<{ Bindings: Env }>,
  vrm: string,
  advert: { mileage?: number | null; make?: string | null } = {},
) {
  if (!isMotConfigured(c.env)) {
    return c.json({ error: 'DVSA MOT credentials are not configured' }, 501);
  }

  const plate = normalisePlate(vrm);
  try {
    const result = await getMotHistory(c.env.DB, plate, (v) => fetchMotRaw(c.env, v), {
      force: c.req.query('refresh') === '1',
    });
    return c.json(
      buildMotHistory(result.raw, { fetchedAt: result.fetchedAt, source: result.source }, advert),
    );
  } catch (err) {
    if (err instanceof MotNotFound) return c.json({ error: err.message }, 404);
    return c.json({ error: err instanceof Error ? err.message : 'MOT lookup failed' }, 502);
  }
}

/** A bare plate lookup, with no advert to compare against. */
app.get('/api/mot/:vrm', (c) => motResponse(c, c.req.param('vrm')));

/**
 * The MOT history of a car we hold, which is the useful form: knowing the
 * advertised mileage and make is what turns the reading into a verdict.
 */
app.get('/api/listings/:advertId/mot', async (c) => {
  const listing = await db.getListingFacts(c.env.DB, c.req.param('advertId'));
  if (!listing) return c.json({ error: 'Unknown listing' }, 404);
  if (!listing.vrm) return c.json({ error: 'No registration plate on file for this car' }, 400);

  return motResponse(c, listing.vrm, { mileage: listing.mileage, make: listing.make });
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
