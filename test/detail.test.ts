import { describe, expect, it } from 'vitest';
import { DetailParseError, extractAdvert } from '../src/autotrader/detail';
import { checkStatus, extractVrm, normaliseAdvert, parseEngineLitres } from '../src/autotrader/normalise';
import {
  MAZDA_FSH,
  MAZDA_NO_CHECK,
  MAZDA_NO_SELLER_NAME,
  MINI,
  readFixture,
} from './fixtures';

describe('extractAdvert', () => {
  it('pulls the advert out of a real detail page', () => {
    const advert = extractAdvert(readFixture(MINI));
    expect(advert.id).toBe('202608034752643');
  });

  it('throws a typed error when the hydration blob is missing', () => {
    expect(() => extractAdvert('<html><body>nope</body></html>')).toThrow(DetailParseError);
  });
});

describe('normaliseAdvert', () => {
  it('maps the MINI listing', () => {
    const listing = normaliseAdvert(extractAdvert(readFixture(MINI)));

    expect(listing).toMatchObject({
      advertId: '202608034752643',
      make: 'MINI',
      model: 'Cooper',
      year: 2016,
      price: 6550,
      mileage: 64639,
      plateReg: '66',
      engineLitres: 1.5,
      transmission: 'Automatic',
      fuel: 'Petrol',
      bodyType: 'Hatchback',
      doors: 3,
      priceIndicator: 'NOANALYSIS',
      serviceHistory: 'NO_HISTORY',
      writeOff: 'PASSED',
      sellerName: 'Evans Halshaw Ford Gainsborough',
    });
  });

  it('maps full service history including the last service date', () => {
    const listing = normaliseAdvert(extractAdvert(readFixture(MAZDA_FSH)));

    expect(listing.serviceHistory).toBe('FULL');
    expect(listing.lastServiceDate).toBe('19/12/2025');
    expect(listing.make).toBe('Mazda');
    expect(listing.engineLitres).toBe(1.3);
  });

  it('reports a failed check rather than swallowing it', () => {
    const listing = normaliseAdvert(extractAdvert(readFixture(MAZDA_FSH)));

    expect(listing.imported).toBe('FAILED');
    expect(listing.stolen).toBe('PASSED');
  });

  it('survives an advert with no vehicleCheck block at all', () => {
    const listing = normaliseAdvert(extractAdvert(readFixture(MAZDA_NO_CHECK)));

    expect(listing.priceIndicator).toBe('LOW');
    expect(listing.serviceHistory).toBe('UNKNOWN');
    // Crucially UNKNOWN, not PASSED — absent data must never read as "cleared".
    expect(listing.writeOff).toBe('UNKNOWN');
    expect(listing.engineLitres).toBe(1.5);
  });

  it('finds the town when the seller block has no name', () => {
    const listing = normaliseAdvert(extractAdvert(readFixture(MAZDA_NO_SELLER_NAME)));

    // This advert has no `seller.name` at all, and its town is at
    // `seller.location.town` rather than the path the dealer pages use.
    expect(listing.location).toBe('Birmingham');
    expect(listing.sellerName).toBeNull();
  });

  it('strips the "From " prefix the advertiser block adds to dealer names', () => {
    expect(
      normaliseAdvert({ details: { advertiser: { displayName: 'From Evans Halshaw Ford' } } })
        .sellerName,
    ).toBe('Evans Halshaw Ford');
  });

  it('does not throw on an empty advert', () => {
    const listing = normaliseAdvert({});
    expect(listing.priceIndicator).toBe('NOANALYSIS');
    expect(listing.writeOff).toBe('UNKNOWN');
    expect(listing.engineLitres).toBeNull();
  });
});

describe('checkStatus', () => {
  it('returns UNKNOWN for an unrecognised check id', () => {
    const advert = extractAdvert(readFixture(MINI));
    expect(checkStatus(advert, 'NOT_A_REAL_CHECK')).toBe('UNKNOWN');
  });
});

describe('extractVrm', () => {
  it('recovers a plate leaked in a dealer deep-link', () => {
    expect(extractVrm(extractAdvert(readFixture(MINI)))).toBe('YT66CNK');
  });

  it('returns null when no dealer link carries one', () => {
    expect(extractVrm(extractAdvert(readFixture(MAZDA_NO_CHECK)))).toBeNull();
  });
});

describe('parseEngineLitres', () => {
  it.each([
    ['1.5L', 1.5],
    ['2L', 2],
    ['', null],
    [undefined, null],
    ['Electric', null],
  ])('parses %s', (input, expected) => {
    expect(parseEngineLitres(input as string | undefined)).toBe(expected);
  });
});
