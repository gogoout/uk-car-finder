import { describe, expect, it } from 'vitest';
import { detailMatchesCombo, matchesCombo } from '../src/autotrader/match';
import { normaliseAdvert } from '../src/autotrader/normalise';
import type { Combo, SearchListing } from '../src/types';

const combo: Combo = {
  id: 'mazda',
  label: 'Mazda2 1.5 Skyactiv-G Auto',
  filters: {
    make: ['MAZDA'],
    model: ['Mazda2'],
    min_year_manufactured: ['2015'],
    min_engine_size: ['1.4'],
    max_engine_size: ['1.6'],
    max_mileage: ['80000'],
    min_price: ['6000'],
    max_price: ['8000'],
    transmission: ['Automatic'],
  },
};

/** Convenience for variants of the combo above. */
const withFilters = (extra: Record<string, string[]>): Combo => ({
  ...combo,
  filters: { ...combo.filters, ...extra },
});

const listing = (overrides: Partial<SearchListing> = {}): SearchListing => ({
  advertId: '1',
  title: 'Mazda Mazda2',
  subTitle: '1.5 SKYACTIV-G SE-L Nav Auto',
  attentionGrabber: null,
  price: 7600,
  mileage: 50000,
  year: 2016,
  plateReg: '16',
  priceIndicator: null,
  sellerType: 'TRADE',
  detailPath: '/car-details/1',
  imageCount: 10,
  imageUrl: null,
  ...overrides,
});

describe('matchesCombo', () => {
  it('accepts a listing inside every bound', () => {
    expect(matchesCombo(listing(), combo).matches).toBe(true);
  });

  // These are the exact promoted adverts AutoTrader returned for this combo
  // during a live run, despite the price and year filters being sent.
  it('rejects the £17,250 2024 promoted advert', () => {
    const result = matchesCombo(listing({ price: 17250, year: 2024, mileage: 7372 }), combo);
    expect(result.matches).toBe(false);
    expect(result.reason).toContain('price');
  });

  it('rejects the £11,400 2022 promoted advert', () => {
    expect(matchesCombo(listing({ price: 11400, year: 2022 }), combo).matches).toBe(false);
  });

  /**
   * A real promoted advert: a £11,700 Mazda6 returned for a Mazda2 search. It
   * passed the make and price checks, so only a model check catches it.
   */
  it('rejects a promoted advert for the wrong model of the right make', () => {
    const result = matchesCombo(listing({ title: 'Mazda Mazda6', price: 7500 }), combo);

    expect(result.matches).toBe(false);
    expect(result.reason).toContain('model mismatch');
  });

  it('matches a model whose punctuation differs from the title', () => {
    // The facet says "C-Class"; the title says "C Class".
    const merc: Combo = {
      id: 'm',
      label: 'C-Class',
      filters: { make: ['MERCEDES-BENZ'], model: ['C-Class'] },
    };
    expect(matchesCombo(listing({ title: 'Mercedes-Benz C Class' }), merc).matches).toBe(true);
  });

  it('accepts any of several selected models', () => {
    const multi = withFilters({ model: ['Mazda2', 'Mazda3'] });
    expect(matchesCombo(listing({ title: 'Mazda Mazda3' }), multi).matches).toBe(true);
    expect(matchesCombo(listing({ title: 'Mazda Mazda6' }), multi).matches).toBe(false);
  });

  it('rejects a car below the minimum year', () => {
    const result = matchesCombo(listing({ year: 2012 }), combo);
    expect(result.reason).toBe('year 2012 < 2015');
  });

  it('rejects a car above the maximum year when one is set', () => {
    const capped = withFilters({ max_year_manufactured: ['2016'] });
    expect(matchesCombo(listing({ year: 2018 }), capped).matches).toBe(false);
  });

  it('rejects a car over the mileage cap', () => {
    expect(matchesCombo(listing({ mileage: 95000 }), combo).matches).toBe(false);
  });

  it('rejects a promoted advert for a different make', () => {
    const result = matchesCombo(listing({ title: 'Ford Fiesta' }), combo);
    expect(result.matches).toBe(false);
    expect(result.reason).toContain('make mismatch');
  });

  it('matches a multi-word make against the title', () => {
    const landRover: Combo = { id: 'lr', label: 'Discovery', filters: { make: ['LAND ROVER'] } };
    expect(matchesCombo(listing({ title: 'Land Rover Discovery' }), landRover).matches).toBe(true);
  });

  it('accepts a listing matching any make when several are selected', () => {
    const multi: Combo = { id: 'm', label: 'Small autos', filters: { make: ['MINI', 'MAZDA'] } };
    expect(matchesCombo(listing({ title: 'Mazda Mazda2' }), multi).matches).toBe(true);
    expect(matchesCombo(listing({ title: 'MINI Cooper' }), multi).matches).toBe(true);
    expect(matchesCombo(listing({ title: 'Ford Fiesta' }), multi).matches).toBe(false);
  });

  it('rejects a car below a minimum mileage when one is set', () => {
    const floor = withFilters({ min_mileage: ['20000'] });
    expect(matchesCombo(listing({ mileage: 5000 }), floor).matches).toBe(false);
  });

  it('keeps a listing whose price is unknown rather than discarding it', () => {
    expect(matchesCombo(listing({ price: null }), combo).matches).toBe(true);
    expect(matchesCombo(listing({ year: null, mileage: null }), combo).matches).toBe(true);
  });

  it('accepts anything when the combo sets no bounds', () => {
    const open: Combo = { id: 'any', label: 'Any Mazda', filters: { make: ['MAZDA'] } };
    expect(matchesCombo(listing({ price: 40000, year: 2026 }), open).matches).toBe(true);
  });

  it('ignores filters it cannot evaluate from a search result', () => {
    // Variant, colour and the like are trusted to AutoTrader — they must not
    // cause a rejection here, or every result would be discarded.
    const trimmed = withFilters({ aggregated_trim: ['Sport Nav'], colour: ['Blue'] });
    expect(matchesCombo(listing(), trimmed).matches).toBe(true);
  });
});

describe('detailMatchesCombo', () => {
  const detail = (overrides = {}) => ({ ...normaliseAdvert({}), advertId: '1', ...overrides });

  it('accepts an engine inside the window', () => {
    expect(detailMatchesCombo(detail({ engineLitres: 1.5, transmission: 'Automatic' }), combo).matches).toBe(true);
  });

  it('rejects an engine outside the window', () => {
    const result = detailMatchesCombo(detail({ engineLitres: 2.0 }), combo);
    expect(result.matches).toBe(false);
    expect(result.reason).toContain('engine');
  });

  it('tolerates rounding at the window edges', () => {
    // AutoTrader advertises to 0.1L, so a 1.4 combo bound must not reject 1.4.
    expect(detailMatchesCombo(detail({ engineLitres: 1.4 }), combo).matches).toBe(true);
    expect(detailMatchesCombo(detail({ engineLitres: 1.6 }), combo).matches).toBe(true);
  });

  it('rejects the wrong gearbox', () => {
    const result = detailMatchesCombo(detail({ transmission: 'Manual' }), combo);
    expect(result.matches).toBe(false);
    expect(result.reason).toContain('transmission');
  });

  it('keeps a listing whose engine or gearbox could not be read', () => {
    expect(detailMatchesCombo(detail({ engineLitres: null, transmission: null }), combo).matches).toBe(true);
  });

  it('accepts any of several selected gearboxes', () => {
    const either = withFilters({ transmission: ['Automatic', 'Manual'] });
    expect(detailMatchesCombo(detail({ transmission: 'Manual' }), either).matches).toBe(true);
  });

  it('checks fuel type, body type and doors', () => {
    const strict = withFilters({
      fuel_type: ['Petrol'],
      body_type: ['Hatchback'],
      doors_values: ['5'],
    });

    expect(
      detailMatchesCombo(detail({ fuel: 'Petrol', bodyType: 'Hatchback', doors: 5 }), strict).matches,
    ).toBe(true);
    expect(detailMatchesCombo(detail({ fuel: 'Diesel' }), strict).reason).toContain('fuel');
    expect(detailMatchesCombo(detail({ bodyType: 'Estate' }), strict).reason).toContain('body type');
    expect(detailMatchesCombo(detail({ doors: 3 }), strict).reason).toContain('doors');
  });

  it('rejects a confirmed write-off when the combo excludes them', () => {
    const noWriteOffs = withFilters({ is_writeoff: ['exclude'] });

    expect(detailMatchesCombo(detail({ writeOff: 'FAILED' }), noWriteOffs).matches).toBe(false);
    expect(detailMatchesCombo(detail({ writeOff: 'PASSED' }), noWriteOffs).matches).toBe(true);
    // UNKNOWN means AutoTrader published no check — not a positive result.
    expect(detailMatchesCombo(detail({ writeOff: 'UNKNOWN' }), noWriteOffs).matches).toBe(true);
  });

  it('does not check variant, which only exists as free text in the subtitle', () => {
    const withVariant = withFilters({ aggregated_trim: ['Sport Nav'] });
    expect(detailMatchesCombo(detail({ engineLitres: 1.5 }), withVariant).matches).toBe(true);
  });
});
