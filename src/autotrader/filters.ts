/**
 * Translates a Combo into AutoTrader's `FilterInput[]`.
 *
 * Filter names come from their SPA bundle (`/search-results-app/bundles/main-*.js`),
 * where a `FilterName` enum maps to URL params. `filter` values are an enum on
 * their side, so an unknown name is a hard error rather than a silent no-op.
 */

import type { Combo } from '../types';

export interface FilterInput {
  filter: string;
  selected: string[];
}

export interface BuildFiltersOptions {
  postcode: string;
  radius: number | 'national';
}

export function buildFilters(combo: Combo, opts: BuildFiltersOptions): FilterInput[] {
  const filters: FilterInput[] = [
    { filter: 'postcode', selected: [opts.postcode] },
    // 'total' means the sticker price rather than a monthly finance figure.
    { filter: 'price_search_type', selected: ['total'] },
  ];

  // Their URL param is `radius`, but the gateway enum calls it `distance`.
  if (opts.radius !== 'national') {
    filters.push({ filter: 'distance', selected: [String(opts.radius)] });
  }

  const add = (filter: string, value: string | number | undefined | null) => {
    if (value === undefined || value === null || value === '') return;
    filters.push({ filter, selected: [String(value)] });
  };

  add('make', combo.make);
  add('model', combo.model);
  add('min_year_manufactured', combo.minYear);
  add('max_year_manufactured', combo.maxYear);
  add('min_engine_size', combo.minEngineLitres);
  add('max_engine_size', combo.maxEngineLitres);
  add('max_mileage', combo.maxMileage);
  add('min_price', combo.minPrice);
  add('max_price', combo.maxPrice);
  add('transmission', combo.transmission);

  // Server-side write-off exclusion. The converter only accepts 'false' — 'true'
  // and 'on' are rejected by their backend. This narrows the result set but is
  // not the last word: the per-listing WRITE_OFF check in normalise.ts is what
  // actually confirms a specific car, since it distinguishes "cleared" from
  // "no check published".
  if (combo.excludeWriteOffs) {
    filters.push({ filter: 'is_writeoff', selected: ['false'] });
  }

  return filters;
}
