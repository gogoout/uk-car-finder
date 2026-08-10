/**
 * Caches AutoTrader's facet responses so the filter editor stays responsive.
 *
 * The cascade means each (make, model, …) context has its own option lists, so
 * the key is the filter set itself. For a personal tool the key space is
 * whatever combos you actually build — small — and stale rows are pruned.
 */

import type { FilterInput } from '../autotrader/filters';
import type { FacetData } from '../autotrader/facets';

export const TTL_MS = 60 * 60 * 1000; // 1 hour
export const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Order-independent key: the same filters chosen in a different order must hit
 * the same cache entry.
 */
export function cacheKey(filters: FilterInput[]): string {
  return JSON.stringify(
    filters
      .map((f) => [f.filter, [...f.selected].sort()] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}

export interface CachedFacets {
  data: FacetData;
  fetchedAt: string;
  stale: boolean;
}

export async function readFacetCache(
  db: D1Database,
  key: string,
  now = Date.now(),
): Promise<CachedFacets | null> {
  const row = await db
    .prepare('SELECT json, fetched_at FROM facet_cache WHERE cache_key = ?')
    .bind(key)
    .first<{ json: string; fetched_at: string }>();
  if (!row) return null;

  return {
    data: JSON.parse(row.json) as FacetData,
    fetchedAt: row.fetched_at,
    stale: now - new Date(row.fetched_at).getTime() > TTL_MS,
  };
}

export async function writeFacetCache(
  db: D1Database,
  key: string,
  data: FacetData,
  fetchedAt = new Date().toISOString(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO facet_cache (cache_key, json, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`,
    )
    .bind(key, JSON.stringify(data), fetchedAt)
    .run();
}

export async function pruneFacetCache(db: D1Database, now = Date.now()): Promise<void> {
  await db
    .prepare('DELETE FROM facet_cache WHERE fetched_at < ?')
    .bind(new Date(now - PRUNE_AFTER_MS).toISOString())
    .run();
}

export interface FacetResult extends CachedFacets {
  source: 'cache' | 'network' | 'stale-fallback';
}

/**
 * Fresh cache hit wins; otherwise fetch. If AutoTrader is unreachable but we
 * hold an expired copy, serve that rather than leaving the editor with no
 * dropdowns at all — stale options beat none.
 */
export async function getFacets(
  db: D1Database,
  filters: FilterInput[],
  fetcher: (filters: FilterInput[]) => Promise<FacetData>,
  now = Date.now(),
): Promise<FacetResult> {
  const key = cacheKey(filters);
  const cached = await readFacetCache(db, key, now);
  if (cached && !cached.stale) return { ...cached, source: 'cache' };

  try {
    const data = await fetcher(filters);
    const fetchedAt = new Date(now).toISOString();
    await writeFacetCache(db, key, data, fetchedAt);
    return { data, fetchedAt, stale: false, source: 'network' };
  } catch (err) {
    if (cached) return { ...cached, source: 'stale-fallback' };
    throw err;
  }
}
