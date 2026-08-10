/**
 * Runs SearchResultsListingsQuery against the gateway and pages through results.
 */

import { gatewayQuery, type FetchOptions } from './gateway';
import type { FilterInput } from './filters';
import type { PriceIndicator, SearchListing } from '../types';

const OPNAME = 'SearchResultsListingsQuery';

/**
 * Every field here was validated against the live schema. If AutoTrader drops
 * one, the gateway returns a GraphQL error naming it — see `npm run smoke`.
 */
const QUERY = `query ${OPNAME}($filters: [FilterInput!]!, $channel: Channel!, $page: Int, $sortBy: SearchResultsSort, $searchId: String!) {
  searchResults(input: {facets: [], filters: $filters, channel: $channel, page: $page, sortBy: $sortBy, searchId: $searchId}) {
    listings {
      ... on SearchListing {
        advertId
        title
        subTitle
        attentionGrabber
        price
        sellerType
        fpaLink
        numberOfImages
        condition
        badges { type displayText }
      }
    }
    page { number count results { count } }
  }
}`;

interface RawBadge {
  type?: string | null;
  displayText?: string | null;
}

interface RawListing {
  advertId?: string | null;
  title?: string | null;
  subTitle?: string | null;
  attentionGrabber?: string | null;
  price?: string | null;
  sellerType?: string | null;
  fpaLink?: string | null;
  numberOfImages?: number | null;
  badges?: RawBadge[] | null;
}

interface RawSearchResponse {
  searchResults: {
    // Sponsored slots come back as `{}` — hence every field being optional.
    listings: RawListing[];
    page: { number: number; count: number; results: { count: number } };
  };
}

/** "£6,550" -> 6550 */
export function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

/** "64,639 miles" -> 64639 */
export function parseMileage(value: string | null | undefined): number | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

/** "2016 (66 reg)" -> { year: 2016, plateReg: '66' } */
export function parseRegisteredYear(value: string | null | undefined): {
  year: number | null;
  plateReg: string | null;
} {
  if (!value) return { year: null, plateReg: null };
  const year = value.match(/\b(19|20)\d{2}\b/);
  const plate = value.match(/\(([^)]+?)\s*reg\)/i);
  return {
    year: year ? Number(year[0]) : null,
    plateReg: plate?.[1] ?? null,
  };
}

const PI_BADGES: Record<string, PriceIndicator> = {
  PI_GREAT: 'GREAT',
  PI_GOOD: 'GOOD',
  PI_FAIR: 'FAIR',
  PI_HIGH: 'HIGH',
  PI_LOW: 'LOW',
};

/**
 * Search results carry the price indicator as a badge, so we get AutoTrader's
 * market verdict without paying for a detail-page fetch.
 */
export function priceIndicatorFromBadges(badges: RawBadge[] | null | undefined): PriceIndicator | null {
  for (const badge of badges ?? []) {
    const mapped = badge.type ? PI_BADGES[badge.type] : undefined;
    if (mapped) return mapped;
  }
  return null;
}

function badgeText(badges: RawBadge[] | null | undefined, type: string): string | null {
  return badges?.find((b) => b.type === type)?.displayText ?? null;
}

export function normaliseSearchListing(raw: RawListing): SearchListing | null {
  if (!raw.advertId || !raw.fpaLink) return null; // sponsored/empty slot
  const { year, plateReg } = parseRegisteredYear(badgeText(raw.badges, 'REGISTERED_YEAR'));

  return {
    advertId: raw.advertId,
    title: raw.title ?? '',
    subTitle: raw.subTitle ?? null,
    attentionGrabber: raw.attentionGrabber ?? null,
    price: parsePrice(raw.price),
    mileage: parseMileage(badgeText(raw.badges, 'MILEAGE')),
    year,
    plateReg,
    priceIndicator: priceIndicatorFromBadges(raw.badges),
    sellerType: raw.sellerType ?? null,
    // Strip the volatile searchId/sort query string so the path is stable.
    detailPath: raw.fpaLink.split('?')[0] ?? raw.fpaLink,
    imageCount: raw.numberOfImages ?? null,
  };
}

export interface SearchPage {
  listings: SearchListing[];
  pageNumber: number;
  pageCount: number;
  totalResults: number;
}

export async function searchPage(
  filters: FilterInput[],
  page: number,
  opts: FetchOptions = {},
): Promise<SearchPage> {
  const data = await gatewayQuery<RawSearchResponse>(
    OPNAME,
    QUERY,
    {
      filters,
      channel: 'cars',
      page,
      sortBy: 'relevance',
      // Their API requires a searchId; it only ties results to their analytics.
      searchId: '00000000-0000-0000-0000-000000000000',
    },
    opts,
  );

  const results = data.searchResults;
  return {
    listings: results.listings.map(normaliseSearchListing).filter((l): l is SearchListing => l !== null),
    pageNumber: results.page.number,
    pageCount: results.page.count,
    totalResults: results.page.results.count,
  };
}

export interface SearchAllOptions extends FetchOptions {
  /** Safety valve — a badly-scoped combo shouldn't walk 40 pages. */
  maxPages?: number;
  /** Delay between page requests, in ms. Keeps our footprint polite. */
  delayMs?: number;
}

/** Walks every page of a search, returning listings deduped by advertId. */
export async function searchAll(
  filters: FilterInput[],
  opts: SearchAllOptions = {},
): Promise<{ listings: SearchListing[]; pagesFetched: number; totalResults: number }> {
  const maxPages = opts.maxPages ?? 10;
  const delayMs = opts.delayMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const byId = new Map<string, SearchListing>();
  let pagesFetched = 0;
  let totalResults = 0;

  for (let page = 1; page <= maxPages; page++) {
    const result = await searchPage(filters, page, opts);
    pagesFetched++;
    totalResults = result.totalResults;
    for (const listing of result.listings) byId.set(listing.advertId, listing);

    if (page >= result.pageCount) break;
    if (delayMs > 0) await sleep(delayMs);
  }

  return { listings: [...byId.values()], pagesFetched, totalResults };
}
