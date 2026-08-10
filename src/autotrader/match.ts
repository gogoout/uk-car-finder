/**
 * Client-side verification of search results.
 *
 * AutoTrader's `listings` array is not a faithful application of the filters we
 * send: it interleaves empty sponsored slots and, when a search is narrow,
 * pads with promoted "you might also like" adverts that ignore the price, year
 * and mileage bounds. A live run of the Mazda2 combo (£6-8k, 2015+, <80k)
 * returned a 2024 car at £17,250 and a 2022 at £11,400 alongside the four
 * genuine matches, while reporting a result count of 4.
 *
 * So every listing is re-checked here before it is stored. Unknown values pass:
 * a missing price shouldn't discard a car that may well qualify — that would
 * trade one kind of wrong result for another.
 *
 * Engine size and transmission aren't in the search payload, so they are
 * verified later against the detail page by `detailMatchesCombo`.
 */

import type { Combo, ListingDetail, SearchListing } from '../types';

export interface MatchResult {
  matches: boolean;
  /** Why it was rejected, for the run log. */
  reason?: string;
}

export function matchesCombo(listing: SearchListing, combo: Combo): MatchResult {
  const fail = (reason: string): MatchResult => ({ matches: false, reason });

  // Promoted adverts are often a different model entirely. `title` is
  // "<make> <model>", e.g. "Mazda Mazda2" or "MINI Cooper".
  if (listing.title && !listing.title.toLowerCase().startsWith(combo.make.toLowerCase().split(' ')[0]!)) {
    return fail(`make mismatch: "${listing.title}" is not a ${combo.make}`);
  }

  if (listing.year !== null) {
    if (combo.minYear !== undefined && listing.year < combo.minYear) {
      return fail(`year ${listing.year} < ${combo.minYear}`);
    }
    if (combo.maxYear !== undefined && listing.year > combo.maxYear) {
      return fail(`year ${listing.year} > ${combo.maxYear}`);
    }
  }

  if (listing.price !== null) {
    if (combo.minPrice !== undefined && listing.price < combo.minPrice) {
      return fail(`price ${listing.price} < ${combo.minPrice}`);
    }
    if (combo.maxPrice !== undefined && listing.price > combo.maxPrice) {
      return fail(`price ${listing.price} > ${combo.maxPrice}`);
    }
  }

  if (
    listing.mileage !== null &&
    combo.maxMileage !== undefined &&
    listing.mileage > combo.maxMileage
  ) {
    return fail(`mileage ${listing.mileage} > ${combo.maxMileage}`);
  }

  return { matches: true };
}

/**
 * Second pass once the detail page has been fetched, covering the fields the
 * search payload doesn't carry.
 */
export function detailMatchesCombo(detail: ListingDetail, combo: Combo): MatchResult {
  const fail = (reason: string): MatchResult => ({ matches: false, reason });

  if (detail.engineLitres !== null) {
    // Engine sizes are advertised rounded to 0.1L, so compare with a tolerance
    // rather than rejecting a 1.498L car from a 1.5-1.5 window.
    const epsilon = 0.05;
    if (combo.minEngineLitres !== undefined && detail.engineLitres < combo.minEngineLitres - epsilon) {
      return fail(`engine ${detail.engineLitres}L < ${combo.minEngineLitres}L`);
    }
    if (combo.maxEngineLitres !== undefined && detail.engineLitres > combo.maxEngineLitres + epsilon) {
      return fail(`engine ${detail.engineLitres}L > ${combo.maxEngineLitres}L`);
    }
  }

  if (
    detail.transmission !== null &&
    combo.transmission !== undefined &&
    detail.transmission !== combo.transmission
  ) {
    return fail(`transmission ${detail.transmission} is not ${combo.transmission}`);
  }

  return { matches: true };
}
