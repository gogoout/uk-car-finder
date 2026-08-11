/**
 * Runs a saved search: pages through every combo, records what changed, and
 * queues detail pages for anything we haven't enriched yet.
 */

import { buildFilters } from '../autotrader/filters';
import { matchesCombo } from '../autotrader/match';
import { searchAll, type SearchAllOptions } from '../autotrader/search';
import * as db from '../db/queries';
import { effectiveCombo, type SavedSearch } from '../types';

export interface RefreshResult {
  runId: number;
  pagesFetched: number;
  listingsSeen: number;
  newCount: number;
  priceDropCount: number;
  /** Listings AutoTrader returned that don't actually satisfy the combo. */
  rejectedCount: number;
  error?: string;
}

export type RefreshOptions = SearchAllOptions;

export async function refreshSearch(
  database: D1Database,
  search: SavedSearch,
  opts: RefreshOptions = {},
): Promise<RefreshResult> {
  const runId = await db.startRun(database, search.id);
  let pagesFetched = 0;
  let listingsSeen = 0;
  let newCount = 0;
  let priceDropCount = 0;
  let rejectedCount = 0;
  const failures: string[] = [];

  for (const rawCombo of search.combos) {
    // The search's globals layered under the combination's own filters. Used
    // for both the request and the verification below, so what we ask for and
    // what we accept can't drift apart.
    const combo = effectiveCombo(rawCombo, search.globalFilters);
    const filters = buildFilters(combo, {
      postcode: search.postcode,
      radius: search.radius,
    });

    try {
      const { listings, pagesFetched: pages } = await searchAll(filters, opts);
      pagesFetched += pages;

      for (const listing of listings) {
        // AutoTrader pads narrow searches with promoted adverts that ignore the
        // filters, so nothing is stored until we have checked it ourselves.
        const match = matchesCombo(listing, combo);
        if (!match.matches) {
          rejectedCount++;
          console.log(`Rejected ${listing.advertId} for ${combo.label}: ${match.reason}`);
          continue;
        }

        listingsSeen++;
        const isNewListing = await db.upsertSearchListing(database, listing);
        if (isNewListing) newCount++;

        if (await db.recordPrice(database, listing.advertId, listing.price)) priceDropCount++;

        await db.linkListingToCombo(database, search.id, listing.advertId, combo, runId);

        // Detail pages fill in service history and the write-off check. They
        // rarely change, so we only ever fetch each listing once.
        if (isNewListing) await db.enqueueDetail(database, listing.advertId);
      }
    } catch (err) {
      // One bad combo shouldn't cost us the other combos' results.
      failures.push(`${combo.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const error = failures.length ? failures.join(' | ') : undefined;
  await db.finishRun(database, runId, {
    pagesFetched,
    listingsSeen,
    newCount,
    priceDropCount,
    rejectedCount,
    error,
  });

  return { runId, pagesFetched, listingsSeen, newCount, priceDropCount, rejectedCount, error };
}

export async function refreshAllSearches(
  database: D1Database,
  opts: RefreshOptions = {},
): Promise<RefreshResult[]> {
  const searches = await db.listSearches(database);
  const results: RefreshResult[] = [];
  for (const search of searches) {
    results.push(await refreshSearch(database, search, opts));
  }
  return results;
}
