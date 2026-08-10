import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getFacets,
  pruneFacetCache,
  readFacetCache,
  TTL_MS,
  writeFacetCache,
} from '../../src/db/facetCache';
import * as db from '../../src/db/queries';
import { resetDb, savedSearch } from './helpers';
import type { FacetData } from '../../src/autotrader/facets';

let DB: D1Database;

beforeEach(async () => {
  DB = await resetDb();
});

const facetData = (makeCount: number): FacetData => ({
  groups: [{ name: 'make_and_model', title: 'Make and model', helpText: null }],
  facets: {
    make: {
      facet: 'make',
      filters: [
        {
          filter: 'make',
          selected: [],
          options: Array.from({ length: makeCount }, (_, i) => ({
            label: `Make ${i}`,
            value: `Make ${i}`,
            count: i,
          })),
        },
      ],
    },
  },
  resultCount: makeCount,
});

const FILTERS = [{ filter: 'make', selected: ['MINI'] }];

describe('facet cache', () => {
  it('round-trips a payload', async () => {
    await writeFacetCache(DB, 'k', facetData(2));
    const cached = await readFacetCache(DB, 'k');

    expect(cached!.data.facets.make!.filters[0]!.options).toHaveLength(2);
    expect(cached!.stale).toBe(false);
  });

  it('marks an entry stale once the TTL has passed', async () => {
    const written = new Date(Date.now() - TTL_MS - 1000).toISOString();
    await writeFacetCache(DB, 'k', facetData(1), written);

    expect((await readFacetCache(DB, 'k'))!.stale).toBe(true);
  });

  it('prunes only entries past the retention window', async () => {
    await writeFacetCache(DB, 'fresh', facetData(1));
    await writeFacetCache(DB, 'old', facetData(1), new Date(Date.now() - 48 * 3600_000).toISOString());

    await pruneFacetCache(DB);

    expect(await readFacetCache(DB, 'fresh')).not.toBeNull();
    expect(await readFacetCache(DB, 'old')).toBeNull();
  });
});

describe('getFacets', () => {
  it('fetches and caches on a miss', async () => {
    const fetcher = vi.fn().mockResolvedValue(facetData(3));

    const first = await getFacets(DB, FILTERS, fetcher);
    expect(first.source).toBe('network');
    expect(fetcher).toHaveBeenCalledTimes(1);

    const second = await getFacets(DB, FILTERS, fetcher);
    expect(second.source).toBe('cache');
    // The whole point: the cascade doesn't re-hit AutoTrader on every keystroke.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second.data.resultCount).toBe(3);
  });

  it('treats a different filter context as a different entry', async () => {
    const fetcher = vi.fn().mockResolvedValue(facetData(1));

    await getFacets(DB, FILTERS, fetcher);
    await getFacets(DB, [{ filter: 'make', selected: ['MAZDA'] }], fetcher);

    // Distinct cascades (MINI's models vs Mazda's) must not share a cache slot.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refetches once the entry is stale', async () => {
    const fetcher = vi.fn().mockResolvedValue(facetData(5));
    const start = Date.now();

    await getFacets(DB, FILTERS, fetcher, start);
    const later = await getFacets(DB, FILTERS, fetcher, start + TTL_MS + 1000);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(later.source).toBe('network');
  });

  it('serves a stale copy when AutoTrader is unreachable', async () => {
    const start = Date.now();
    await getFacets(DB, FILTERS, vi.fn().mockResolvedValue(facetData(7)), start);

    const failing = vi.fn().mockRejectedValue(new Error('gateway down'));
    const result = await getFacets(DB, FILTERS, failing, start + TTL_MS + 1000);

    // Stale dropdowns beat no dropdowns.
    expect(result.source).toBe('stale-fallback');
    expect(result.data.resultCount).toBe(7);
  });

  it('propagates the error when there is nothing cached to fall back on', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('gateway down'));
    await expect(getFacets(DB, FILTERS, failing)).rejects.toThrow('gateway down');
  });
});

describe('combo migration on read', () => {
  it('converts a legacy combo stored before the filter-bag refactor', async () => {
    // Write the old shape straight into the column, as a pre-refactor row would.
    const legacy = [
      {
        id: 'mini',
        label: 'MINI Cooper 1.5 Auto',
        make: 'MINI',
        model: 'Cooper',
        maxPrice: 7000,
        transmission: 'Automatic',
        excludeWriteOffs: true,
      },
    ];
    const search = savedSearch();
    await db.upsertSearch(DB, { ...search, combos: [] });
    await DB.prepare('UPDATE searches SET combos_json = ? WHERE id = ?')
      .bind(JSON.stringify(legacy), search.id)
      .run();

    const loaded = await db.getSearch(DB, search.id);

    expect(loaded!.combos[0]!.filters).toEqual({
      make: ['MINI'],
      model: ['Cooper'],
      max_price: ['7000'],
      transmission: ['Automatic'],
      is_writeoff: ['exclude'],
    });
    expect(loaded!.combos[0]!.label).toBe('MINI Cooper 1.5 Auto');
  });
});
