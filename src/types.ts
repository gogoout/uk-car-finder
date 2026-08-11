/** Domain types shared by the worker and the SPA. */

export type Transmission = 'Automatic' | 'Manual';

/**
 * Filter selections keyed by AutoTrader's own filter names — `make`, `model`,
 * `aggregated_trim`, `min_price`, `max_mileage`, `fuel_type`, and so on.
 *
 * Deliberately an open bag rather than typed fields. AutoTrader's facet API
 * tells us at runtime which filters exist and what values each accepts, so the
 * editor renders whatever they support and filters they add later work with no
 * code change. Values are always arrays because every non-range filter accepts
 * several values as an OR (`fuel_type: [Petrol, Diesel]` really does return the
 * union).
 */
export type FilterSelections = Record<string, string[]>;

/**
 * One search combination, e.g. "MINI Cooper 1.5 Auto, 2015+, <85k, £5.5-7k".
 * A saved search holds several of these and merges their results.
 */
export interface Combo {
  /** Stable id within the search, used to tag results. */
  id: string;
  /** Human label shown on result cards, e.g. "MINI Cooper 1.5 Auto". */
  label: string;
  /**
   * True once you have typed your own label, so later filter changes stop
   * regenerating it from make/model/variant and overwriting your wording.
   */
  labelIsCustom?: boolean;
  filters: FilterSelections;
}

/** Filter names this app reads directly, rather than just passing through. */
export const FILTER = {
  make: 'make',
  model: 'model',
  variant: 'aggregated_trim',
  minYear: 'min_year_manufactured',
  maxYear: 'max_year_manufactured',
  minPrice: 'min_price',
  maxPrice: 'max_price',
  minMileage: 'min_mileage',
  maxMileage: 'max_mileage',
  minEngine: 'min_engine_size',
  maxEngine: 'max_engine_size',
  transmission: 'transmission',
  fuelType: 'fuel_type',
  bodyType: 'body_type',
  doors: 'doors_values',
  writeOff: 'is_writeoff',
  postcode: 'postcode',
  distance: 'distance',
  priceSearchType: 'price_search_type',
} as const;

/** First selected value for a filter, or undefined. */
export function filterValue(combo: Combo, name: string): string | undefined {
  return combo.filters[name]?.[0];
}

/** First selected value parsed as a number, or undefined if absent/unparseable. */
export function filterNumber(combo: Combo, name: string): number | undefined {
  const raw = filterValue(combo, name);
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const filterValues = (combo: Combo, name: string): string[] => combo.filters[name] ?? [];

/**
 * A combination as it actually behaves: its own filters layered over the
 * search's globals.
 *
 * Everything that reads a combination's filters must go through this, or the
 * feature half-works — the filters sent to AutoTrader, both matchers, and the
 * read-time verification in getResults all need the same merged view.
 */
export function effectiveCombo(
  combo: Combo,
  globalFilters: FilterSelections | undefined,
): Combo {
  if (!globalFilters || Object.keys(globalFilters).length === 0) return combo;
  // Combo keys last: a combination overrides the global for filters it sets.
  return { ...combo, filters: { ...globalFilters, ...combo.filters } };
}

export interface SavedSearch {
  id: string;
  name: string;
  /**
   * Filters applied to every combination. A combination that sets the same
   * filter overrides it, so these behave as defaults rather than constraints —
   * which is what lets one search share a write-off exclusion and a mileage cap
   * while each combination keeps its own price range.
   */
  globalFilters: FilterSelections;
  postcode: string;
  /** Search radius in miles, or 'national'. */
  radius: number | 'national';
  combos: Combo[];
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
}

/** AutoTrader's market-price verdict. LOW/GREAT/GOOD are cheap, HIGH is dear. */
export type PriceIndicator = 'GREAT' | 'GOOD' | 'FAIR' | 'HIGH' | 'LOW' | 'NOANALYSIS';

/** AutoTrader's service-history classification. */
export type ServiceHistory = 'FULL' | 'PART' | 'NO_HISTORY' | 'UNKNOWN';

/**
 * Result of AutoTrader's free write-off check. UNKNOWN means the check block
 * was absent from the page, which is common — treat it as "not cleared".
 */
export type CheckStatus = 'PASSED' | 'FAILED' | 'UNKNOWN';

/** What we learn from a search-results page (cheap, one request per page). */
export interface SearchListing {
  advertId: string;
  title: string;
  subTitle: string | null;
  attentionGrabber: string | null;
  price: number | null;
  mileage: number | null;
  year: number | null;
  /** Plate identifier from the badge, e.g. "66" in "2016 (66 reg)". */
  plateReg: string | null;
  priceIndicator: PriceIndicator | null;
  sellerType: string | null;
  detailPath: string;
  imageCount: number | null;
  /** Cover photo, still containing AutoTrader's `{resize}` token. */
  imageUrl: string | null;
}

/** What we learn from a detail page (one request per listing, queued). */
export interface ListingDetail {
  advertId: string;
  make: string | null;
  model: string | null;
  year: number | null;
  price: number | null;
  mileage: number | null;
  plateReg: string | null;
  engineLitres: number | null;
  transmission: Transmission | null;
  fuel: string | null;
  bodyType: string | null;
  doors: number | null;
  priceIndicator: PriceIndicator;
  serviceHistory: ServiceHistory;
  lastServiceDate: string | null;
  writeOff: CheckStatus;
  stolen: CheckStatus;
  scrapped: CheckStatus;
  imported: CheckStatus;
  motStatus: string | null;
  sellerName: string | null;
  sellerType: string | null;
  location: string | null;
  imageUrl: string | null;
  /** Opportunistically recovered from dealer deep-links; usually null. */
  vrm: string | null;
  /**
   * The advert's own text mentions the car being an import. Only meaningful
   * when `imported` is UNKNOWN — the vehicle check is the real signal.
   */
  importMentioned: boolean;
}

/**
 * A listing as served to the UI, merged from search + detail + delta state.
 *
 * Detail-derived fields are `null` until the fetch queue reaches this listing,
 * so every one of them is nullable rather than optional — the UI should never
 * have to distinguish "absent key" from "not enriched yet".
 */
export interface ResultListing
  extends Omit<ListingDetail, 'advertId' | 'price' | 'mileage' | 'year' | 'priceIndicator' | 'serviceHistory' | 'writeOff' | 'stolen' | 'scrapped' | 'imported'> {
  advertId: string;
  title: string;
  subTitle: string | null;
  price: number | null;
  mileage: number | null;
  year: number | null;
  priceIndicator: PriceIndicator | null;
  serviceHistory: ServiceHistory | null;
  writeOff: CheckStatus | null;
  stolen: CheckStatus | null;
  scrapped: CheckStatus | null;
  imported: CheckStatus | null;
  detailUrl: string;
  /** Combo labels that matched this listing (a car can match more than one). */
  matchedCombos: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  detailFetchedAt: string | null;
  /** First seen on the most recent run of this search. */
  isNew: boolean;
  /** Positive number of pounds the price has fallen since we first saw it. */
  priceDrop: number | null;
  previousPrice: number | null;
  starred: boolean;
  /** Ruled out by you; hidden from results unless you ask to see them. */
  discarded: boolean;
  vrm: string | null;
}
