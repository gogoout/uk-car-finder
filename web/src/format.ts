import type { PriceIndicator, ResultListing, ServiceHistory } from '../../src/types';

export const money = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `£${value.toLocaleString('en-GB')}`;

export const miles = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value.toLocaleString('en-GB')} miles`;

export function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * AutoTrader's own market verdict. LOW means priced below what they'd expect,
 * HIGH means above — so LOW/GREAT/GOOD are the buyer-friendly end.
 */
export const PRICE_LABELS: Record<PriceIndicator, string> = {
  GREAT: 'Great price',
  GOOD: 'Good price',
  FAIR: 'Fair price',
  HIGH: 'Higher price',
  LOW: 'Lower price',
  NOANALYSIS: 'No price analysis',
};

export function priceTone(indicator: PriceIndicator | null | undefined): string {
  switch (indicator) {
    case 'GREAT':
    case 'GOOD':
    case 'LOW':
      return 'good';
    case 'HIGH':
      return 'bad';
    case 'FAIR':
      return 'warn';
    default:
      return '';
  }
}

export const SERVICE_LABELS: Record<ServiceHistory, string> = {
  FULL: 'Full service history',
  PART: 'Part service history',
  NO_HISTORY: 'No service history',
  UNKNOWN: 'Service history unknown',
};

export function serviceTone(history: ServiceHistory | null | undefined): string {
  if (history === 'FULL') return 'good';
  if (history === 'PART') return 'warn';
  if (history === 'NO_HISTORY') return 'bad';
  return '';
}

/** Ranks results without mutating the input array. */
export type SortKey =
  | 'newest'
  | 'price-asc'
  | 'price-desc'
  | 'mileage-asc'
  | 'year-desc'
  | 'price-rating';

const RATING_ORDER: PriceIndicator[] = ['GREAT', 'GOOD', 'LOW', 'FAIR', 'HIGH', 'NOANALYSIS'];

/** Nulls always sort last, whichever direction the key implies. */
function compareNullable(a: number | null | undefined, b: number | null | undefined, dir: 1 | -1): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  return (a - b) * dir;
}

export function sortResults(results: ResultListing[], key: SortKey): ResultListing[] {
  const sorted = [...results];
  switch (key) {
    case 'price-asc':
      return sorted.sort((a, b) => compareNullable(a.price, b.price, 1));
    case 'price-desc':
      return sorted.sort((a, b) => compareNullable(a.price, b.price, -1));
    case 'mileage-asc':
      return sorted.sort((a, b) => compareNullable(a.mileage, b.mileage, 1));
    case 'year-desc':
      return sorted.sort((a, b) => compareNullable(a.year, b.year, -1));
    case 'price-rating':
      return sorted.sort(
        (a, b) =>
          RATING_ORDER.indexOf(a.priceIndicator ?? 'NOANALYSIS') -
          RATING_ORDER.indexOf(b.priceIndicator ?? 'NOANALYSIS'),
      );
    case 'newest':
    default:
      // New arrivals first, then most recently first seen.
      return sorted.sort(
        (a, b) =>
          Number(b.isNew) - Number(a.isNew) || b.firstSeenAt.localeCompare(a.firstSeenAt),
      );
  }
}
