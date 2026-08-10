/**
 * Turns a Combo into AutoTrader's `FilterInput[]`.
 *
 * Since a Combo now stores selections keyed by AutoTrader's own filter names,
 * this is almost a straight pass-through. The only additions are the
 * search-level values that describe the searcher rather than the car.
 *
 * `filter` is an enum on their side, so an unknown name is a hard 400 rather
 * than a silently ignored filter — and the error body names the offender.
 */

import { FILTER, type Combo } from '../types';

export interface FilterInput {
  filter: string;
  selected: string[];
}

export interface BuildFiltersOptions {
  postcode: string;
  radius: number | 'national';
}

/** Search-level filters, which live on the saved search rather than the combo. */
export function searchLevelFilters(opts: BuildFiltersOptions): FilterInput[] {
  const filters: FilterInput[] = [
    { filter: FILTER.postcode, selected: [opts.postcode] },
    // 'total' means the sticker price rather than a monthly finance figure.
    { filter: FILTER.priceSearchType, selected: ['total'] },
  ];

  // Their URL param is `radius`, but the gateway enum calls it `distance`.
  if (opts.radius !== 'national') {
    filters.push({ filter: FILTER.distance, selected: [String(opts.radius)] });
  }

  return filters;
}

export function buildFilters(combo: Combo, opts: BuildFiltersOptions): FilterInput[] {
  const comboFilters = Object.entries(combo.filters)
    // An empty selection means "no preference", which is the absence of the
    // filter — sending an empty array would be rejected.
    .filter(([, selected]) => selected.length > 0)
    .map(([filter, selected]) => ({ filter, selected }));

  // Combo values win: a combo that sets its own distance overrides the search's.
  const comboNames = new Set(comboFilters.map((f) => f.filter));
  return [
    ...searchLevelFilters(opts).filter((f) => !comboNames.has(f.filter)),
    ...comboFilters,
  ];
}
