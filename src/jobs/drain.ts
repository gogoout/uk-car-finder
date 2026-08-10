/**
 * Drains the detail-fetch queue.
 *
 * The Workers free plan allows 50 subrequests per invocation, so the batch size
 * is deliberately small and a 15-minute cron does the rest. Raising BATCH_SIZE
 * above ~45 requires the Workers Paid plan (1,000 subrequests).
 */

import { fetchDetailPage, type FetchOptions } from '../autotrader/gateway';
import { extractAdvert } from '../autotrader/detail';
import { normaliseAdvert } from '../autotrader/normalise';
import { detailMatchesCombo } from '../autotrader/match';
import * as db from '../db/queries';
import type { ListingDetail, SavedSearch } from '../types';

export const BATCH_SIZE = 35;

export interface DrainResult {
  attempted: number;
  succeeded: number;
  failed: number;
  remaining: number;
  /** Combo links dropped because the detail page contradicted the combo. */
  unlinked: number;
}

/**
 * Engine size and transmission only appear on the detail page, so a listing
 * that slipped through the search filters can only be caught now. Drop the
 * link rather than the listing — another combo may still legitimately want it.
 */
async function pruneMismatchedLinks(
  database: D1Database,
  advertId: string,
  detail: ListingDetail,
  searchCache: Map<string, SavedSearch | null>,
): Promise<number> {
  let unlinked = 0;

  for (const link of await db.listLinksForAdvert(database, advertId)) {
    if (!searchCache.has(link.search_id)) {
      searchCache.set(link.search_id, await db.getSearch(database, link.search_id));
    }
    const combo = searchCache.get(link.search_id)?.combos.find((c) => c.id === link.combo_id);
    if (!combo) continue;

    const match = detailMatchesCombo(detail, combo);
    if (!match.matches) {
      await db.unlinkListingFromCombo(database, link.search_id, advertId, link.combo_id);
      console.log(`Unlinked ${advertId} from ${combo.label}: ${match.reason}`);
      unlinked++;
    }
  }

  return unlinked;
}

export interface DrainOptions extends FetchOptions {
  batchSize?: number;
  delayMs?: number;
}

export async function drainDetailQueue(
  database: D1Database,
  opts: DrainOptions = {},
): Promise<DrainResult> {
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const delayMs = opts.delayMs ?? 400;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const batch = await db.takeQueueBatch(database, batchSize);
  let succeeded = 0;
  let failed = 0;
  let unlinked = 0;
  // One search is usually behind a whole batch; don't re-read it per listing.
  const searchCache = new Map<string, SavedSearch | null>();

  for (const [index, item] of batch.entries()) {
    try {
      const html = await fetchDetailPage(item.advert_id, opts);
      const detail = { ...normaliseAdvert(extractAdvert(html)), advertId: item.advert_id };
      await db.applyDetail(database, detail);
      unlinked += await pruneMismatchedLinks(database, item.advert_id, detail, searchCache);
      await db.dequeueDetail(database, item.advert_id);
      succeeded++;
    } catch (err) {
      // Leave it queued with a bumped attempt count; takeQueueBatch skips it
      // once it has failed three times, so a dead advert can't block the queue.
      await db.recordQueueFailure(
        database,
        item.advert_id,
        err instanceof Error ? err.message : String(err),
      );
      failed++;
    }

    if (delayMs > 0 && index < batch.length - 1) await sleep(delayMs);
  }

  return {
    attempted: batch.length,
    succeeded,
    failed,
    unlinked,
    remaining: await db.queueDepth(database),
  };
}
