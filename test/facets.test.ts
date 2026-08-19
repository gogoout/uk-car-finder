import { describe, expect, it, vi } from 'vitest';
import { facetFilters, fetchFacets, parseFacetResponse } from '../src/autotrader/facets';
import { migrateCombo, migrateCombos } from '../src/db/migrateCombo';
import { cacheKey } from '../src/db/facetCache';

const rawResponse = {
  searchResults: {
    facets: [
      {
        facet: 'make',
        filters: [
          {
            filter: 'make',
            selected: ['MINI'],
            options: [
              { label: 'MINI', value: 'MINI', count: 11527 },
              { label: 'Mazda', value: 'Mazda', count: 9000 },
            ],
          },
        ],
      },
      {
        facet: 'price',
        filters: [
          { filter: 'min_price', selected: [], options: [{ label: '£500', value: '500', count: null }] },
          { filter: 'max_price', selected: [], options: [{ label: '£1,000', value: '1000', count: null }] },
        ],
      },
    ],
    facetGroups: [
      { facetGroupName: 'make_and_model', title: 'Make and model', helpText: null },
      { facetGroupName: 'price', title: 'Price', helpText: 'Cash price' },
    ],
    page: { results: { count: 42 } },
  },
};

describe('parseFacetResponse', () => {
  it('keys facets by name and preserves AutoTrader group order', () => {
    const data = parseFacetResponse(rawResponse);

    expect(Object.keys(data.facets).sort()).toEqual(['make', 'price']);
    expect(data.groups.map((g) => g.name)).toEqual(['make_and_model', 'price']);
    expect(data.groups[1]!.title).toBe('Price');
    expect(data.resultCount).toBe(42);
  });

  it('keeps min/max filters as a pair so the UI can render a range', () => {
    const data = parseFacetResponse(rawResponse);
    expect(data.facets.price!.filters.map((f) => f.filter)).toEqual(['min_price', 'max_price']);
  });

  it('carries option labels, values and counts', () => {
    const make = parseFacetResponse(rawResponse).facets.make!.filters[0]!;
    expect(make.options[0]).toEqual({ label: 'MINI', value: 'MINI', count: 11527 });
    expect(make.selected).toEqual(['MINI']);
  });

  it('survives nulls and missing fields without throwing', () => {
    const data = parseFacetResponse({
      searchResults: {
        facets: [
          { facet: null, filters: [] },
          { facet: 'colour', filters: null },
          { facet: 'doors_values', filters: [{ filter: 'doors_values', options: null, selected: null }] },
        ],
        facetGroups: [null, { facetGroupName: 'colour', title: null, helpText: null }],
        page: null,
      },
    } as never);

    expect(Object.keys(data.facets).sort()).toEqual(['colour', 'doors_values']);
    expect(data.facets.doors_values!.filters[0]!.options).toEqual([]);
    // Falls back to the machine name when no title is supplied.
    expect(data.groups).toEqual([{ name: 'colour', title: 'colour', helpText: null }]);
    expect(data.resultCount).toBeNull();
  });

  it('treats an empty option list as "no children yet", not an error', () => {
    // This is exactly how the cascade signals "pick a make before a model".
    const data = parseFacetResponse({
      searchResults: {
        facets: [{ facet: 'model', filters: [{ filter: 'model', options: [], selected: [] }] }],
        facetGroups: [],
        page: { results: { count: 0 } },
      },
    } as never);
    expect(data.facets.model!.filters[0]!.options).toEqual([]);
  });
});

describe('facetFilters', () => {
  it('adds the price search type AutoTrader requires', () => {
    expect(facetFilters([])).toEqual([{ filter: 'price_search_type', selected: ['total'] }]);
  });

  it('does not duplicate one already supplied', () => {
    const given = [{ filter: 'price_search_type', selected: ['monthly'] }];
    expect(facetFilters(given)).toEqual(given);
  });
});

describe('fetchFacets', () => {
  it('requests one cheap facet and returns the whole parsed set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: rawResponse }),
    } as Response);

    const data = await fetchFacets([{ filter: 'make', selected: ['MINI'] }], { fetchImpl });

    const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.variables.facets).toEqual(['make']);
    expect(body.variables.channel).toBe('cars');
    // The caller's filters plus the mandatory price search type.
    expect(body.variables.filters).toEqual([
      { filter: 'make', selected: ['MINI'] },
      { filter: 'price_search_type', selected: ['total'] },
    ]);
    expect(Object.keys(data.facets)).toContain('price');
  });
});

describe('cacheKey', () => {
  it('is independent of filter and value order', () => {
    const a = cacheKey([
      { filter: 'make', selected: ['MINI', 'MAZDA'] },
      { filter: 'model', selected: ['Cooper'] },
    ]);
    const b = cacheKey([
      { filter: 'model', selected: ['Cooper'] },
      { filter: 'make', selected: ['MAZDA', 'MINI'] },
    ]);
    expect(a).toBe(b);
  });

  it('distinguishes different selections', () => {
    expect(cacheKey([{ filter: 'make', selected: ['MINI'] }])).not.toBe(
      cacheKey([{ filter: 'make', selected: ['MAZDA'] }]),
    );
  });
});

describe('migrateCombo', () => {
  it('converts a combo saved in the old typed shape', () => {
    const legacy = {
      id: 'mini',
      label: 'MINI Cooper 1.5 Auto',
      make: 'MINI',
      model: 'Cooper',
      minYear: 2015,
      maxYear: 2016,
      minEngineLitres: 1.4,
      maxEngineLitres: 1.6,
      maxMileage: 85000,
      minPrice: 5500,
      maxPrice: 7000,
      transmission: 'Automatic',
      excludeWriteOffs: true,
    };

    expect(migrateCombo(legacy)).toEqual({
      id: 'mini',
      label: 'MINI Cooper 1.5 Auto',
      filters: {
        make: ['MINI'],
        model: ['Cooper'],
        min_year_manufactured: ['2015'],
        max_year_manufactured: ['2016'],
        min_engine_size: ['1.4'],
        max_engine_size: ['1.6'],
        max_mileage: ['85000'],
        min_price: ['5500'],
        max_price: ['7000'],
        transmission: ['Automatic'],
        // Canonical value from AutoTrader's own facet options; the legacy code
        // sent 'false', which their converter also accepts.
        is_writeoff: ['exclude'],
      },
    });
  });

  it('omits absent legacy fields instead of sending empty filters', () => {
    const migrated = migrateCombo({ id: 'a', label: 'Any MINI', make: 'MINI' });
    expect(migrated.filters).toEqual({ make: ['MINI'] });
  });

  it('leaves excludeWriteOffs off when it was false', () => {
    const migrated = migrateCombo({ id: 'a', make: 'MINI', excludeWriteOffs: false });
    expect(migrated.filters.is_writeoff).toBeUndefined();
  });

  it('derives a label when the legacy combo had none', () => {
    expect(migrateCombo({ id: 'a', make: 'MINI', model: 'Cooper' }).label).toBe('MINI Cooper');
  });

  it('is idempotent — a migrated combo passes through untouched', () => {
    const modern = { id: 'a', label: 'Modern', filters: { make: ['MINI'] } };
    expect(migrateCombo(modern)).toEqual(modern);
    expect(migrateCombo(migrateCombo(modern))).toEqual(modern);
  });

  it('keeps the optional flags, which this used to drop on every read', () => {
    // These are written and stored correctly; it was reading them back that
    // lost them. A custom label silently became derived again on reload, and
    // a switched-off combination would have switched itself back on.
    const modern = {
      id: 'a',
      label: 'My wording',
      labelIsCustom: true,
      enabled: false,
      filters: { make: ['MINI'] },
    };

    expect(migrateCombo(modern)).toEqual(modern);
  });

  it('leaves the flags absent when they were never set', () => {
    // Absent means on, so writing `enabled: true` into every old row would be
    // noise — and `toEqual` here would not catch it.
    const migrated = migrateCombo({ id: 'a', label: 'Plain', filters: { make: ['MINI'] } });

    expect('enabled' in migrated).toBe(false);
    expect('labelIsCustom' in migrated).toBe(false);
  });

  it('handles junk without throwing', () => {
    expect(migrateCombo(null).filters).toEqual({});
    expect(migrateCombos(null)).toEqual([]);
    expect(migrateCombos([{ make: 'MINI' }])).toHaveLength(1);
  });
});
