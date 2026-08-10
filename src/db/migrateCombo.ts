/**
 * Upgrades combos saved before filters became an open bag.
 *
 * Combos live in a JSON blob (`searches.combos_json`), so there is no SQL
 * migration to run — old rows are converted as they are read. Applied on every
 * read, so it must be idempotent: a combo already in the new shape passes
 * straight through.
 */

import { FILTER, type Combo, type FilterSelections } from '../types';

/** The shape combos had before the refactor. */
interface LegacyCombo {
  id?: string;
  label?: string;
  make?: string;
  model?: string;
  minYear?: number;
  maxYear?: number;
  minEngineLitres?: number;
  maxEngineLitres?: number;
  maxMileage?: number;
  minPrice?: number;
  maxPrice?: number;
  transmission?: string;
  excludeWriteOffs?: boolean;
  filters?: FilterSelections;
}

const LEGACY_TO_FILTER: [keyof LegacyCombo, string][] = [
  ['make', FILTER.make],
  ['model', FILTER.model],
  ['minYear', FILTER.minYear],
  ['maxYear', FILTER.maxYear],
  ['minEngineLitres', FILTER.minEngine],
  ['maxEngineLitres', FILTER.maxEngine],
  ['maxMileage', FILTER.maxMileage],
  ['minPrice', FILTER.minPrice],
  ['maxPrice', FILTER.maxPrice],
  ['transmission', FILTER.transmission],
];

export function migrateCombo(raw: unknown): Combo {
  const legacy = (raw ?? {}) as LegacyCombo;

  // Already migrated — leave it alone.
  if (legacy.filters && typeof legacy.filters === 'object') {
    return {
      id: legacy.id ?? '',
      label: legacy.label ?? '',
      filters: legacy.filters,
    };
  }

  const filters: FilterSelections = {};
  for (const [legacyKey, filterName] of LEGACY_TO_FILTER) {
    const value = legacy[legacyKey];
    if (value === undefined || value === null || value === '') continue;
    filters[filterName] = [String(value)];
  }

  if (legacy.excludeWriteOffs) {
    // 'exclude' is the canonical value from AutoTrader's own facet options.
    // The legacy code sent 'false', which their converter also accepts.
    filters[FILTER.writeOff] = ['exclude'];
  }

  return {
    id: legacy.id ?? '',
    label: legacy.label ?? [legacy.make, legacy.model].filter(Boolean).join(' '),
    filters,
  };
}

export const migrateCombos = (raw: unknown): Combo[] =>
  Array.isArray(raw) ? raw.map(migrateCombo) : [];
