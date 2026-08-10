import { describe, expect, it } from 'vitest';
import { detailMatchesCombo, matchesCombo } from '../src/autotrader/match';
import { normaliseAdvert } from '../src/autotrader/normalise';
import type { Combo, SearchListing } from '../src/types';

const combo: Combo = {
  id: 'mazda',
  label: 'Mazda2 1.5 Skyactiv-G Auto',
  make: 'MAZDA',
  model: 'Mazda2',
  minYear: 2015,
  minEngineLitres: 1.4,
  maxEngineLitres: 1.6,
  maxMileage: 80000,
  minPrice: 6000,
  maxPrice: 8000,
  transmission: 'Automatic',
};

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

  it('rejects a car below the minimum year', () => {
    const result = matchesCombo(listing({ year: 2012 }), combo);
    expect(result.reason).toBe('year 2012 < 2015');
  });

  it('rejects a car above the maximum year when one is set', () => {
    const capped = { ...combo, maxYear: 2016 };
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
    const landRover: Combo = { id: 'lr', label: 'Discovery', make: 'LAND ROVER' };
    expect(matchesCombo(listing({ title: 'Land Rover Discovery' }), landRover).matches).toBe(true);
  });

  it('keeps a listing whose price is unknown rather than discarding it', () => {
    expect(matchesCombo(listing({ price: null }), combo).matches).toBe(true);
    expect(matchesCombo(listing({ year: null, mileage: null }), combo).matches).toBe(true);
  });

  it('accepts anything when the combo sets no bounds', () => {
    const open: Combo = { id: 'any', label: 'Any Mazda', make: 'MAZDA' };
    expect(matchesCombo(listing({ price: 40000, year: 2026 }), open).matches).toBe(true);
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
});
