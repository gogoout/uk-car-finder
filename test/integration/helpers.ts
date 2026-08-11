import { env } from 'cloudflare:test';
// Tests execute inside workerd, where there is no filesystem — Vite inlines the
// migration at build time instead.
import MIGRATION from '../../migrations/0001_init.sql?raw';
import MIGRATION_2 from '../../migrations/0002_facet_cache.sql?raw';
import MIGRATION_3 from '../../migrations/0003_globals_import_discard.sql?raw';
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
  'discarded',
];

/** Applies the migration and empties every table, so each test starts clean. */
export async function resetDb(): Promise<D1Database> {
  const statements = [MIGRATION, MIGRATION_2, MIGRATION_3]
    .join(';\n')
    // Strip `--` comments first, or a comment-only tail parses as a statement.
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sql of statements) {
    try {
      await env.DB.prepare(sql).run();
    } catch (err) {
      // Tests share one database and re-apply the migrations before each case.
      // `CREATE TABLE IF NOT EXISTS` is idempotent; `ALTER TABLE ADD COLUMN` is
      // not, so a repeat run legitimately reports the column already exists.
      // Anything else is a real failure and must still surface.
      if (!/duplicate column name/i.test(String(err))) throw err;
    }
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
  globalFilters: {},
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
  imageUrl: 'https://m.atcdn.co.uk/a/media/{resize}/cover.jpg',
  ...overrides,
});
