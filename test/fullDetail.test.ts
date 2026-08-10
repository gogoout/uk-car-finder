import { describe, expect, it } from 'vitest';
import { extractAdvert } from '../src/autotrader/detail';
import { expandImageUrl, normaliseFullDetail } from '../src/autotrader/fullDetail';
import { MAZDA_FSH, MAZDA_NO_CHECK, MINI, readFixture } from './fixtures';

const detail = (fixture: string) => normaliseFullDetail(extractAdvert(readFixture(fixture)));

describe('expandImageUrl', () => {
  it('fills the {resize} token AutoTrader leaves in the URL', () => {
    expect(
      expandImageUrl('https://m.atcdn.co.uk/a/media/{resize}/abc.jpg', 800),
    ).toBe('https://m.atcdn.co.uk/a/media/w800/abc.jpg');
  });

  it('leaves a URL without the token alone', () => {
    const plain = 'https://m.atcdn.co.uk/a/media/w600/abc.jpg';
    expect(expandImageUrl(plain, 800)).toBe(plain);
  });
});

describe('normaliseFullDetail', () => {
  it('pulls the whole gallery, not just the cover image', () => {
    const mazda = detail(MAZDA_FSH);

    expect(mazda.images).toHaveLength(32);
    expect(mazda.images[0]!.url).toContain('{resize}');
    // Tags drive the Interior/Exterior filter chips.
    expect(new Set(mazda.images.map((i) => i.category))).toContain('Interior');
    expect(new Set(mazda.images.map((i) => i.category))).toContain('Exterior');
  });

  it('handles adverts with very different gallery sizes', () => {
    expect(detail(MINI).images).toHaveLength(10);
    expect(detail(MAZDA_NO_CHECK).images).toHaveLength(44);
  });

  it('extracts the heading, price and pills', () => {
    const mini = detail(MINI);

    expect(mini.advertId).toBe('202608034752643');
    expect(mini.title).toBe('2016 MINI Cooper');
    expect(mini.subTitle).toBe('S 1.5 3dr');
    expect(mini.price).toBe(6550);
    expect(mini.priceLabel).toBe('£6,550');
    expect(mini.pills).toEqual(['64,639 miles', '2016 (66 reg)', 'Automatic', 'Petrol']);
    expect(mini.detailUrl).toBe('https://www.autotrader.co.uk/car-details/202608034752643');
  });

  it('reports no price verdict rather than the NOANALYSIS sentinel', () => {
    expect(detail(MINI).priceIndicator).toBeNull();
    expect(detail(MAZDA_NO_CHECK).priceIndicator).toBe('LOW');
  });

  it('extracts key specs', () => {
    const byLabel = Object.fromEntries(detail(MINI).keySpecs.map((s) => [s.label, s.value]));

    expect(byLabel.Engine).toBe('1.5L');
    expect(byLabel.Gearbox).toBe('Automatic');
    expect(byLabel.Mileage).toBe('64,639 miles');
  });

  it('extracts spec tables grouped by category', () => {
    const specs = detail(MAZDA_NO_CHECK).specs;

    expect(specs.map((s) => s.category)).toEqual(['Performance', 'Size and dimensions']);
    expect(specs[0]!.items.length).toBeGreaterThan(0);
    expect(specs[0]!.items[0]).toHaveProperty('name');
    expect(specs[0]!.items[0]).toHaveProperty('value');
  });

  it('extracts the equipment list with its Standard/Optional marker', () => {
    const features = detail(MAZDA_NO_CHECK).features;

    expect(features.map((f) => f.category)).toContain('Interior');
    const all = features.flatMap((f) => f.items);
    expect(all.length).toBeGreaterThan(20);
    expect(all.some((item) => item.type === 'Standard')).toBe(true);
  });

  it("splits the seller's description into paragraphs", () => {
    const description = detail(MAZDA_FSH).description;

    expect(description.length).toBeGreaterThan(1);
    expect(description[0]).toContain('Mazda 2');
    // Newlines are separators, not content.
    expect(description.every((p) => !p.includes('\n'))).toBe(true);
    expect(description.every((p) => p.trim() !== '')).toBe(true);
  });

  it('extracts history, service and the vehicle checks', () => {
    const mazda = detail(MAZDA_FSH);

    expect(mazda.serviceHistory).toBe('FULL');
    expect(mazda.lastServiceDate).toBe('19/12/2025');
    expect(mazda.motLabel).toContain('17/11/2026');

    const byId = Object.fromEntries(mazda.checks.map((c) => [c.id, c]));
    expect(byId.WRITE_OFF!.label).toBe('Written off');
    expect(byId.IMPORTED!.status).toBe('FAILED');
    expect(byId.STOLEN!.status).toBe('PASSED');
  });

  it('extracts the seller', () => {
    expect(detail(MINI).sellerName).toBe('Evans Halshaw Ford Gainsborough');
    expect(detail(MAZDA_NO_CHECK).sellerName).toBe('3AND1 Car Sales');
  });

  it('survives an advert with no specs, description or vehicle check', () => {
    // A real advert: 110 features but no spec table and no description.
    const mini = detail(MINI);

    expect(mini.specs).toEqual([]);
    expect(mini.description).toEqual([]);
    expect(mini.features.length).toBeGreaterThan(0);

    const noCheck = detail(MAZDA_NO_CHECK);
    expect(noCheck.checks).toEqual([]);
  });

  it('does not throw on an empty advert', () => {
    const empty = normaliseFullDetail({}, 'fallback-id');

    expect(empty.advertId).toBe('fallback-id');
    expect(empty.images).toEqual([]);
    expect(empty.specs).toEqual([]);
    expect(empty.features).toEqual([]);
    expect(empty.description).toEqual([]);
    expect(empty.checks).toEqual([]);
    expect(empty.priceIndicator).toBeNull();
  });
});
