import { describe, expect, it, vi } from 'vitest';
import {
  normaliseSearchListing,
  parseMileage,
  parsePrice,
  parseRegisteredYear,
  priceIndicatorFromBadges,
  searchAll,
} from '../src/autotrader/search';
import { buildFilters } from '../src/autotrader/filters';
import { readFixture, SEARCH_RESULTS } from './fixtures';
import type { Combo } from '../src/types';

const fixture = JSON.parse(readFixture(SEARCH_RESULTS));

describe('parsers', () => {
  it('parses prices, mileage and registration text', () => {
    expect(parsePrice('£6,550')).toBe(6550);
    expect(parsePrice(null)).toBeNull();
    expect(parseMileage('64,639 miles')).toBe(64639);
    expect(parseRegisteredYear('2016 (66 reg)')).toEqual({ year: 2016, plateReg: '66' });
    expect(parseRegisteredYear('2015 (15 reg)')).toEqual({ year: 2015, plateReg: '15' });
    expect(parseRegisteredYear(undefined)).toEqual({ year: null, plateReg: null });
  });
});

describe('priceIndicatorFromBadges', () => {
  it('maps AutoTrader PI badges onto our scale', () => {
    expect(priceIndicatorFromBadges([{ type: 'PI_LOW', displayText: 'Lower price' }])).toBe('LOW');
    expect(priceIndicatorFromBadges([{ type: 'PI_GREAT', displayText: 'Great price' }])).toBe('GREAT');
    expect(priceIndicatorFromBadges([{ type: 'MILEAGE', displayText: '10 miles' }])).toBeNull();
    expect(priceIndicatorFromBadges(null)).toBeNull();
  });
});

describe('normaliseSearchListing', () => {
  it('normalises a real listing from the gateway', () => {
    const raw = fixture.data.searchResults.listings[0];
    expect(normaliseSearchListing(raw)).toMatchObject({
      advertId: '202608094936691',
      price: 6195,
      mileage: 71892,
      year: 2015,
      plateReg: '15',
      sellerType: 'TRADE',
      detailPath: '/car-details/202608094936691',
    });
  });

  it('drops the empty objects AutoTrader returns for sponsored slots', () => {
    expect(normaliseSearchListing({})).toBeNull();
  });
});

describe('buildFilters', () => {
  const combo: Combo = {
    id: 'c1',
    label: 'MINI Cooper 1.5 Auto',
    filters: {
      make: ['MINI'],
      model: ['Cooper'],
      aggregated_trim: ['Classic'],
      min_year_manufactured: ['2015'],
      max_year_manufactured: ['2016'],
      min_engine_size: ['1.4'],
      max_engine_size: ['1.6'],
      max_mileage: ['85000'],
      min_price: ['5500'],
      max_price: ['7000'],
      transmission: ['Automatic'],
      is_writeoff: ['exclude'],
    },
  };

  it('passes the combo bag straight through and adds the search-level filters', () => {
    const filters = buildFilters(combo, { postcode: 'SW1A 1AA', radius: 50 });
    const byName = Object.fromEntries(filters.map((f) => [f.filter, f.selected]));

    expect(byName).toMatchObject({
      postcode: ['SW1A 1AA'],
      // Their URL calls this `radius`; the gateway enum calls it `distance`.
      distance: ['50'],
      price_search_type: ['total'],
      ...combo.filters,
    });
  });

  it('carries filters it has never heard of, so new AutoTrader filters just work', () => {
    const filters = buildFilters(
      { id: 'c3', label: 'Future', filters: { make: ['MINI'], some_new_filter: ['a', 'b'] } },
      { postcode: 'SW1A 1AA', radius: 50 },
    );
    expect(filters.find((f) => f.filter === 'some_new_filter')?.selected).toEqual(['a', 'b']);
  });

  it('preserves multi-select values as an OR', () => {
    const filters = buildFilters(
      { id: 'c4', label: 'Multi', filters: { make: ['MINI'], fuel_type: ['Petrol', 'Diesel'] } },
      { postcode: 'SW1A 1AA', radius: 50 },
    );
    expect(filters.find((f) => f.filter === 'fuel_type')?.selected).toEqual(['Petrol', 'Diesel']);
  });

  it('omits the distance filter for a national search', () => {
    const filters = buildFilters(combo, { postcode: 'SW1A 1AA', radius: 'national' });
    expect(filters.find((f) => f.filter === 'distance')).toBeUndefined();
  });

  it('drops empty selections rather than sending an empty array', () => {
    const filters = buildFilters(
      { id: 'c2', label: 'Any MINI', filters: { make: ['MINI'], model: [], transmission: [] } },
      { postcode: 'SW1A 1AA', radius: 50 },
    );
    const names = filters.map((f) => f.filter);
    expect(names).not.toContain('model');
    expect(names).not.toContain('transmission');
    expect(names).toContain('make');
  });

  it('lets a combo override a search-level filter rather than sending both', () => {
    const filters = buildFilters(
      { id: 'c5', label: 'Near', filters: { make: ['MINI'], distance: ['10'] } },
      { postcode: 'SW1A 1AA', radius: 50 },
    );
    const distances = filters.filter((f) => f.filter === 'distance');
    expect(distances).toHaveLength(1);
    expect(distances[0]!.selected).toEqual(['10']);
  });
});

describe('searchAll', () => {
  const page = (number: number, count: number, ids: string[]) => ({
    data: {
      searchResults: {
        listings: ids.map((id) => ({
          advertId: id,
          title: 'MINI Cooper',
          price: '£6,000',
          fpaLink: `/car-details/${id}?sort=relevance`,
          badges: [],
        })),
        page: { number, count, results: { count: ids.length * count } },
      },
    },
  });

  const jsonResponse = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as Response;

  it('walks every page and dedupes by advertId', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(page(1, 2, ['a', 'b'])))
      .mockResolvedValueOnce(jsonResponse(page(2, 2, ['b', 'c'])));

    const result = await searchAll([], { fetchImpl, delayMs: 0 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.listings.map((l) => l.advertId)).toEqual(['a', 'b', 'c']);
    expect(result.pagesFetched).toBe(2);
  });

  it('stops at maxPages so a broad combo cannot run away', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(page(1, 99, ['a'])));

    const result = await searchAll([], { fetchImpl, delayMs: 0, maxPages: 3 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.pagesFetched).toBe(3);
  });

  it('retries a 429 with backoff', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 } as Response)
      .mockResolvedValueOnce(jsonResponse(page(1, 1, ['a'])));

    const result = await searchAll([], { fetchImpl, delayMs: 0, sleep });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(result.listings).toHaveLength(1);
  });

  it('does not retry a GraphQL schema error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ errors: [{ message: 'Cannot query field "nope"' }] }),
    );

    await expect(searchAll([], { fetchImpl, delayMs: 0 })).rejects.toThrow(/Cannot query field/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
