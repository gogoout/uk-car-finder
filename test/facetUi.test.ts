import { describe, expect, it } from 'vitest';
import {
  applyCascade,
  buildGroups,
  controlKind,
  groupFilterNames,
  humanise,
  summariseGroup,
} from '../src/facetUi';
import type { Facet, FacetData } from '../src/autotrader/facets';

const facet = (name: string, filters: [string, [string, string][]][]): Facet => ({
  facet: name,
  filters: filters.map(([filter, options]) => ({
    filter,
    selected: [],
    options: options.map(([value, label]) => ({ value, label, count: null })),
  })),
});

const data = (overrides: Partial<FacetData> = {}): FacetData => ({
  groups: [
    { name: 'make_and_model', title: 'Make and model', helpText: null },
    { name: 'price', title: 'Price', helpText: null },
    { name: 'gearbox', title: 'Gearbox', helpText: null },
    { name: 'distance', title: 'Distance from you', helpText: null },
  ],
  facets: {
    make: facet('make', [['make', [['MINI', 'MINI']]]]),
    model: facet('model', [['model', [['Cooper', 'Cooper']]]]),
    aggregated_trim: facet('aggregated_trim', [['aggregated_trim', [['Classic', 'Classic']]]]),
    price: facet('price', [
      ['min_price', [['5500', '£5,500']]],
      ['max_price', [['7000', '£7,000']]],
    ]),
    transmission: facet('transmission', [
      ['transmission', [['Automatic', 'Automatic'], ['Manual', 'Manual']]],
    ]),
    distance: facet('distance', [['distance', [['50', 'Within 50 miles']]]]),
    ...overrides.facets,
  },
  resultCount: 10,
  ...overrides,
});

describe('buildGroups', () => {
  it('uses AutoTrader titles', () => {
    const groups = buildGroups(data());
    expect(groups.map((g) => g.title)).toEqual(['Make and model', 'Price', 'Gearbox']);
  });

  it('leads with make and model, which AutoTrader returns buried alphabetically', () => {
    const alphabetical = data();
    alphabetical.groups = [
      { name: 'colour', title: 'Colour', helpText: null },
      { name: 'gearbox', title: 'Gearbox', helpText: null },
      { name: 'make_and_model', title: 'Make and model', helpText: null },
      { name: 'price', title: 'Price', helpText: null },
    ];
    alphabetical.facets.colour = facet('colour', [['colour', [['Blue', 'Blue']]]]);

    expect(buildGroups(alphabetical).map((g) => g.name)).toEqual([
      'make_and_model',
      'price',
      'gearbox',
      // Non-priority groups keep AutoTrader's relative order behind them.
      'colour',
    ]);
  });

  it('collects the three cascade facets under one group', () => {
    const makeModel = buildGroups(data())[0]!;
    expect(makeModel.facets.map((f) => f.facet)).toEqual(['make', 'model', 'aggregated_trim']);
  });

  it('maps a group whose facet has a different name', () => {
    // The "Gearbox" group is backed by the `transmission` facet.
    const gearbox = buildGroups(data()).find((g) => g.title === 'Gearbox')!;
    expect(gearbox.facets[0]!.facet).toBe('transmission');
  });

  it('omits search-level facets, which belong to the search not the combo', () => {
    const titles = buildGroups(data()).map((g) => g.title);
    expect(titles).not.toContain('Distance from you');
  });

  it('drops a group whose facets are absent rather than showing an empty row', () => {
    const withoutPrice = data();
    delete withoutPrice.facets.price;
    expect(buildGroups(withoutPrice).map((g) => g.title)).not.toContain('Price');
  });

  it('gives an unrecognised facet its own group, so new filters still appear', () => {
    const extended = data();
    extended.facets.some_new_filter = facet('some_new_filter', [
      ['some_new_filter', [['a', 'Option A']]],
    ]);

    const group = buildGroups(extended).find((g) => g.name === 'some_new_filter');
    expect(group).toBeDefined();
    expect(group!.title).toBe('Some new filter');
  });
});

describe('controlKind', () => {
  it('treats a min/max pair as a range', () => {
    expect(controlKind(data().facets.price!)).toBe('range');
  });

  it('treats everything else as multi-select', () => {
    expect(controlKind(data().facets.transmission!)).toBe('multi');
    expect(controlKind(data().facets.make!)).toBe('multi');
  });

  it('does not mistake a lone min_ filter for a range', () => {
    const lonely = facet('mileage', [['min_mileage', [['0', '0 miles']]]]);
    expect(controlKind(lonely)).toBe('multi');
  });

  it('classifies a range it has never seen by shape alone', () => {
    const invented = facet('wingspan', [
      ['min_wingspan', [['1', '1m']]],
      ['max_wingspan', [['9', '9m']]],
    ]);
    expect(controlKind(invented)).toBe('range');
  });
});

describe('summariseGroup', () => {
  const groups = buildGroups(data());
  const priceGroup = groups.find((g) => g.title === 'Price')!;
  const makeGroup = groups[0]!;

  it('renders a full range with option labels, not raw values', () => {
    expect(summariseGroup(priceGroup, { min_price: ['5500'], max_price: ['7000'] })).toBe(
      '£5,500 – £7,000',
    );
  });

  it('renders open-ended ranges', () => {
    expect(summariseGroup(priceGroup, { min_price: ['5500'] })).toBe('from £5,500');
    expect(summariseGroup(priceGroup, { max_price: ['7000'] })).toBe('up to £7,000');
  });

  it('is empty when nothing is selected', () => {
    expect(summariseGroup(priceGroup, {})).toBe('');
  });

  it('joins the cascade selections', () => {
    expect(
      summariseGroup(makeGroup, { make: ['MINI'], model: ['Cooper'], aggregated_trim: ['Classic'] }),
    ).toBe('MINI · Cooper · Classic');
  });

  it('collapses a long multi-selection to a count', () => {
    const gearbox = groups.find((g) => g.title === 'Gearbox')!;
    expect(summariseGroup(gearbox, { transmission: ['Automatic', 'Manual'] })).toBe(
      'Automatic, Manual',
    );

    const many = { make: ['MINI', 'MAZDA', 'FORD', 'AUDI'] };
    expect(summariseGroup(makeGroup, many)).toBe('4 selected');
  });
});

describe('groupFilterNames', () => {
  it('lists every filter a group owns, so it can be cleared at once', () => {
    const priceGroup = buildGroups(data()).find((g) => g.title === 'Price')!;
    expect(groupFilterNames(priceGroup)).toEqual(['min_price', 'max_price']);
  });
});

describe('applyCascade', () => {
  const full = { make: ['MINI'], model: ['Cooper'], aggregated_trim: ['Classic'], max_price: ['7000'] };

  it('clears model and variant when the make changes', () => {
    expect(applyCascade(full, 'make')).toEqual({ make: ['MINI'], max_price: ['7000'] });
  });

  it('clears only the variant when the model changes', () => {
    expect(applyCascade(full, 'model')).toEqual({
      make: ['MINI'],
      model: ['Cooper'],
      max_price: ['7000'],
    });
  });

  it('leaves unrelated filters alone', () => {
    expect(applyCascade(full, 'max_price')).toEqual(full);
  });

  it('does not mutate the input', () => {
    const before = { ...full };
    applyCascade(full, 'make');
    expect(full).toEqual(before);
  });
});

describe('humanise', () => {
  it.each([
    ['doors_values', 'Doors'],
    ['ni_only', 'Northern Ireland only'],
    ['is_manufacturer_approved', 'Manufacturer approved'],
  ])('%s -> %s', (input, expected) => {
    expect(humanise(input)).toBe(expected);
  });
});
