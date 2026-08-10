import { env } from 'cloudflare:test';
// Tests execute inside workerd, where there is no filesystem — Vite inlines the
// migration at build time instead.
import MIGRATION from '../../migrations/0001_init.sql?raw';
import MIGRATION_2 from '../../migrations/0002_facet_cache.sql?raw';
import type { Combo, SavedSearch, SearchListing } from '../../src/types';

// The pool types `env` as `Cloudflare.Env`; declare the bindings our tests use.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
    }
  }
}

const TABLES = [
  'searches',
  'listings',
  'listing_prices',
  'search_listings',
  'runs',
  'fetch_queue',
  'starred',
  'mot_history',
  'facet_cache',
];

/** Applies the migration and empties every table, so each test starts clean. */
export async function resetDb(): Promise<D1Database> {
  const statements = [MIGRATION, MIGRATION_2]
    .join(';\n')
    // Strip `--` comments first, or a comment-only tail parses as a statement.
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sql of statements) {
    await env.DB.prepare(sql).run();
  }
  for (const table of TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
  return env.DB;
}

export const combo = (filters: Record<string, string[]> = {}, overrides: Partial<Combo> = {}): Combo => ({
  id: 'c1',
  label: 'MINI Cooper 1.5 Auto',
  filters: { make: ['MINI'], model: ['Cooper'], ...filters },
  ...overrides,
});

export const savedSearch = (overrides: Partial<SavedSearch> = {}): SavedSearch => ({
  id: 's1',
  name: 'Small autos',
  postcode: 'SW1A 1AA',
  radius: 50,
  combos: [combo()],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  lastRunAt: null,
  ...overrides,
});

export const searchListing = (overrides: Partial<SearchListing> = {}): SearchListing => ({
  advertId: '1',
  title: 'MINI Cooper',
  subTitle: 'S 1.5 3dr',
  attentionGrabber: null,
  price: 6550,
  mileage: 64639,
  year: 2016,
  plateReg: '66',
  priceIndicator: 'GOOD',
  sellerType: 'TRADE',
  detailPath: '/car-details/1',
  imageCount: 10,
  ...overrides,
});
