/** Domain types shared by the worker and the SPA. */

export type Transmission = 'Automatic' | 'Manual';

/**
 * One search combination, e.g. "MINI Cooper 1.5 Auto, 2015+, <85k, £5.5-7k".
 * A saved search holds several of these and merges their results.
 */
export interface Combo {
  /** Stable id within the search, used to tag results. */
  id: string;
  /** Human label shown on result cards, e.g. "MINI Cooper 1.5 Auto". */
  label: string;
  make: string;
  model?: string;
  minYear?: number;
  maxYear?: number;
  /** Engine size in litres, e.g. 1.4 - 1.6 to catch "1.5" variants. */
  minEngineLitres?: number;
  maxEngineLitres?: number;
  maxMileage?: number;
  minPrice?: number;
  maxPrice?: number;
  transmission?: Transmission;
  /** Ask AutoTrader to exclude write-offs. Per-listing checks apply regardless. */
  excludeWriteOffs?: boolean;
}

export interface SavedSearch {
  id: string;
  name: string;
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
  vrm: string | null;
}
