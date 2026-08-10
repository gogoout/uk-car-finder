/**
 * Client-side verification of search results.
 *
 * AutoTrader's `listings` array is not a faithful application of the filters we
 * send: it interleaves empty sponsored slots and, when a search is narrow, pads
 * with promoted "you might also like" adverts that ignore the price, year and
 * mileage bounds. A live run of the Mazda2 combo (£6-8k, 2015+, <80k) returned a
 * 2024 car at £17,250 and a 2022 at £11,400 alongside the four genuine matches,
 * while reporting a result count of 4.
 *
 * So every listing is re-checked here before it is stored. Unknown values pass:
 * a missing price shouldn't discard a car that may well qualify — that would
 * trade one kind of wrong result for another.
 *
 * Only filters we can actually evaluate are checked. Everything else in the
 * combo is passed to AutoTrader and trusted, which is why `rejectedCount` is
 * surfaced in the run history rather than hidden.
 */

import {
  FILTER,
  filterNumber,
  filterValue,
  filterValues,
  type Combo,
  type ListingDetail,
  type ResultListing,
  type SearchListing,
} from '../types';

export interface MatchResult {
  matches: boolean;
  /** Why it was rejected, for the run log. */
  reason?: string;
}

const MATCH: MatchResult = { matches: true };
const fail = (reason: string): MatchResult => ({ matches: false, reason });

/** Case-insensitive membership, since AutoTrader's casing varies by field. */
function includesIgnoreCase(haystack: string[], needle: string): boolean {
  return haystack.some((h) => h.toLowerCase() === needle.toLowerCase());
}

export function matchesCombo(listing: SearchListing, combo: Combo): MatchResult {
  const makes = filterValues(combo, FILTER.make);
  if (makes.length > 0 && listing.title) {
    // Promoted adverts are often a different make entirely. `title` is
    // "<make> <model>", e.g. "Mazda Mazda2" or "MINI Cooper". Multi-select
    // makes pass if the title matches any of them.
    const title = listing.title.toLowerCase();
    const anyMakeMatches = makes.some((make) =>
      title.startsWith(make.toLowerCase().split(' ')[0]!),
    );
    if (!anyMakeMatches) {
      return fail(`make mismatch: "${listing.title}" is not ${makes.join('/')}`);
    }
  }

  const minYear = filterNumber(combo, FILTER.minYear);
  const maxYear = filterNumber(combo, FILTER.maxYear);
  if (listing.year !== null) {
    if (minYear !== undefined && listing.year < minYear) {
      return fail(`year ${listing.year} < ${minYear}`);
    }
    if (maxYear !== undefined && listing.year > maxYear) {
      return fail(`year ${listing.year} > ${maxYear}`);
    }
  }

  const minPrice = filterNumber(combo, FILTER.minPrice);
  const maxPrice = filterNumber(combo, FILTER.maxPrice);
  if (listing.price !== null) {
    if (minPrice !== undefined && listing.price < minPrice) {
      return fail(`price ${listing.price} < ${minPrice}`);
    }
    if (maxPrice !== undefined && listing.price > maxPrice) {
      return fail(`price ${listing.price} > ${maxPrice}`);
    }
  }

  const minMileage = filterNumber(combo, FILTER.minMileage);
  const maxMileage = filterNumber(combo, FILTER.maxMileage);
  if (listing.mileage !== null) {
    if (maxMileage !== undefined && listing.mileage > maxMileage) {
      return fail(`mileage ${listing.mileage} > ${maxMileage}`);
    }
    if (minMileage !== undefined && listing.mileage < minMileage) {
      return fail(`mileage ${listing.mileage} < ${minMileage}`);
    }
  }

  return MATCH;
}

/**
 * Second pass once the detail page has been fetched, covering fields the search
 * payload doesn't carry.
 *
 * `aggregated_trim` (Variant) is deliberately absent: AutoTrader exposes trim
 * only inside the free-text `subTitle`, so any check would be substring
 * guesswork that wrongly discards real matches. It is trusted to their filter.
 */
export function detailMatchesCombo(detail: ListingDetail, combo: Combo): MatchResult {
  const minEngine = filterNumber(combo, FILTER.minEngine);
  const maxEngine = filterNumber(combo, FILTER.maxEngine);
  if (detail.engineLitres !== null) {
    // Engine sizes are advertised rounded to 0.1L, so compare with a tolerance
    // rather than rejecting a 1.498L car from a 1.5-1.5 window.
    const epsilon = 0.05;
    if (minEngine !== undefined && detail.engineLitres < minEngine - epsilon) {
      return fail(`engine ${detail.engineLitres}L < ${minEngine}L`);
    }
    if (maxEngine !== undefined && detail.engineLitres > maxEngine + epsilon) {
      return fail(`engine ${detail.engineLitres}L > ${maxEngine}L`);
    }
  }

  const transmissions = filterValues(combo, FILTER.transmission);
  if (detail.transmission !== null && transmissions.length > 0) {
    if (!includesIgnoreCase(transmissions, detail.transmission)) {
      return fail(`transmission ${detail.transmission} is not ${transmissions.join('/')}`);
    }
  }

  const fuels = filterValues(combo, FILTER.fuelType);
  if (detail.fuel !== null && fuels.length > 0 && !includesIgnoreCase(fuels, detail.fuel)) {
    return fail(`fuel ${detail.fuel} is not ${fuels.join('/')}`);
  }

  const bodyTypes = filterValues(combo, FILTER.bodyType);
  if (
    detail.bodyType !== null &&
    bodyTypes.length > 0 &&
    !includesIgnoreCase(bodyTypes, detail.bodyType)
  ) {
    return fail(`body type ${detail.bodyType} is not ${bodyTypes.join('/')}`);
  }

  const doors = filterValues(combo, FILTER.doors);
  if (detail.doors !== null && doors.length > 0 && !doors.includes(String(detail.doors))) {
    return fail(`doors ${detail.doors} is not ${doors.join('/')}`);
  }

  // A confirmed write-off when the combo asked to exclude them. UNKNOWN passes,
  // as elsewhere — absent data must not be read as a positive.
  if (filterValue(combo, FILTER.writeOff) === 'exclude' && detail.writeOff === 'FAILED') {
    return fail('recorded as previously written off');
  }

  return MATCH;
}

/**
 * Re-checks an already-stored listing against a combo's *current* filters.
 *
 * Links are written when a listing matches and are never revisited, so
 * narrowing a combo used to leave the excluded cars on screen: AutoTrader
 * simply stops returning them, and nothing removes the existing link. Results
 * are therefore verified at read time, against the combo as it stands now.
 *
 * Runs the same two matchers as the ingest path so there is one definition of
 * "matches" rather than a second, drifting copy. Detail-derived fields are null
 * until enrichment, and nulls pass, so an un-enriched listing is judged on its
 * search fields alone — exactly as it was on the way in.
 */
export function storedListingMatches(listing: ResultListing, combo: Combo): MatchResult {
  const asSearchListing: SearchListing = {
    advertId: listing.advertId,
    title: listing.title,
    subTitle: listing.subTitle,
    attentionGrabber: null,
    price: listing.price,
    mileage: listing.mileage,
    year: listing.year,
    plateReg: listing.plateReg,
    priceIndicator: listing.priceIndicator,
    sellerType: listing.sellerType,
    detailPath: '',
    imageCount: null,
  };

  const searchResult = matchesCombo(asSearchListing, combo);
  if (!searchResult.matches) return searchResult;

  const asDetail: ListingDetail = {
    advertId: listing.advertId,
    make: listing.make,
    model: listing.model,
    year: listing.year,
    price: listing.price,
    mileage: listing.mileage,
    plateReg: listing.plateReg,
    engineLitres: listing.engineLitres,
    transmission: listing.transmission,
    fuel: listing.fuel,
    bodyType: listing.bodyType,
    doors: listing.doors,
    priceIndicator: listing.priceIndicator ?? 'NOANALYSIS',
    serviceHistory: listing.serviceHistory ?? 'UNKNOWN',
    lastServiceDate: listing.lastServiceDate,
    writeOff: listing.writeOff ?? 'UNKNOWN',
    stolen: listing.stolen ?? 'UNKNOWN',
    scrapped: listing.scrapped ?? 'UNKNOWN',
    imported: listing.imported ?? 'UNKNOWN',
    motStatus: listing.motStatus,
    sellerName: listing.sellerName,
    sellerType: listing.sellerType,
    location: listing.location,
    imageUrl: listing.imageUrl,
    vrm: listing.vrm,
  };

  return detailMatchesCombo(asDetail, combo);
}
