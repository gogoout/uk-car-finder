/**
 * Caches DVSA MOT lookups, keyed on the registration plate.
 *
 * DVSA's payload is stored exactly as received. The mileage timeline, the
 * clocking verdict and the advert comparison are all derived from it on read —
 * same reasoning as the advert text: sharpening a rule later has to re-judge
 * every car we already hold, not leave old rows carrying an older answer.
 *
 * A week is a generous TTL for data that changes once a year per plate, and the
 * panel offers an explicit re-check for the day you want to be sure.
 */

import type { MotRaw } from '../types';

export const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedMot {
  raw: MotRaw;
  fetchedAt: string;
  stale: boolean;
}

export async function readMotCache(
  db: D1Database,
  vrm: string,
  now = Date.now(),
): Promise<CachedMot | null> {
  const row = await db
    .prepare('SELECT json, fetched_at FROM mot_history WHERE vrm = ?')
    .bind(vrm)
    .first<{ json: string; fetched_at: string }>();
  if (!row) return null;

  return {
    raw: JSON.parse(row.json) as MotRaw,
    fetchedAt: row.fetched_at,
    stale: now - new Date(row.fetched_at).getTime() > TTL_MS,
  };
}

export async function writeMotCache(
  db: D1Database,
  vrm: string,
  raw: MotRaw,
  fetchedAt = new Date().toISOString(),
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mot_history (vrm, json, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(vrm) DO UPDATE SET json = excluded.json, fetched_at = excluded.fetched_at`,
    )
    .bind(vrm, JSON.stringify(raw), fetchedAt)
    .run();
}

/** D1 caps bound parameters per statement, so the `IN` list is chunked. */
const PARAM_LIMIT = 50;

/** Every plate we hold a lookup for, so results can be annotated in one pass. */
export async function readMotCacheMany(
  db: D1Database,
  vrms: string[],
): Promise<Map<string, CachedMot>> {
  const found = new Map<string, CachedMot>();

  for (let i = 0; i < vrms.length; i += PARAM_LIMIT) {
    const chunk = vrms.slice(i, i + PARAM_LIMIT);
    const placeholders = chunk.map(() => '?').join(', ');
    const { results } = await db
      .prepare(`SELECT vrm, json, fetched_at FROM mot_history WHERE vrm IN (${placeholders})`)
      .bind(...chunk)
      .all<{ vrm: string; json: string; fetched_at: string }>();

    for (const row of results) {
      found.set(row.vrm, {
        raw: JSON.parse(row.json) as MotRaw,
        fetchedAt: row.fetched_at,
        stale: false,
      });
    }
  }
  return found;
}

export interface MotResult extends CachedMot {
  source: 'cache' | 'network' | 'stale-fallback';
}

/**
 * Fresh cache hit wins; otherwise fetch. If DVSA is unreachable but we hold an
 * expired copy, serve that — an MOT history from last week is still the same
 * history, and it beats an empty panel.
 *
 * `force` skips the fresh check for the explicit re-check button, but still
 * falls back to what we have if the refetch fails.
 */
export async function getMotHistory(
  db: D1Database,
  vrm: string,
  fetcher: (vrm: string) => Promise<MotRaw>,
  opts: { force?: boolean; now?: number } = {},
): Promise<MotResult> {
  const now = opts.now ?? Date.now();
  const cached = await readMotCache(db, vrm, now);
  if (cached && !cached.stale && !opts.force) return { ...cached, source: 'cache' };

  try {
    const raw = await fetcher(vrm);
    const fetchedAt = new Date(now).toISOString();
    await writeMotCache(db, vrm, raw, fetchedAt);
    return { raw, fetchedAt, stale: false, source: 'network' };
  } catch (err) {
    if (cached) return { ...cached, source: 'stale-fallback' };
    throw err;
  }
}
