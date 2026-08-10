/**
 * Live check against AutoTrader. Not part of `npm test` — it makes real
 * requests, so run it by hand when you suspect their schema has drifted.
 *
 *   npm run smoke
 *
 * Schema drift is this project's main long-term failure mode: the gateway
 * returns a GraphQL error naming the offending field, which this surfaces
 * verbatim so the query in src/autotrader/search.ts can be corrected.
 */

import { buildFilters } from '../src/autotrader/filters';
import { searchAll } from '../src/autotrader/search';
import { fetchDetailPage } from '../src/autotrader/gateway';
import { extractAdvert } from '../src/autotrader/detail';
import { normaliseAdvert } from '../src/autotrader/normalise';
import type { Combo } from '../src/types';

const POSTCODE = process.env.SMOKE_POSTCODE ?? 'SW1A 1AA';

const COMBOS: Combo[] = [
  {
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
  },
  {
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
  },
];

let failures = 0;

function check(condition: boolean, message: string): void {
  console.log(`${condition ? '  ✓' : '  ✗'} ${message}`);
  if (!condition) failures++;
}

async function main(): Promise<void> {
  let sampleAdvertId: string | null = null;

  for (const combo of COMBOS) {
    console.log(`\n${combo.label}`);
    const filters = buildFilters(combo, { postcode: POSTCODE, radius: 200 });
    const { listings, totalResults, pagesFetched } = await searchAll(filters, { maxPages: 2 });

    console.log(`  ${totalResults} results across ${pagesFetched} page(s) fetched`);
    check(listings.length > 0, 'search returned listings');
    check(
      listings.every((l) => l.advertId && l.detailPath.startsWith('/car-details/')),
      'every listing has an id and detail path',
    );
    check(listings.some((l) => l.price !== null), 'prices parsed');
    check(listings.some((l) => l.mileage !== null), 'mileage badges parsed');
    check(listings.some((l) => l.year !== null), 'registration year badges parsed');

    const rated = listings.filter((l) => l.priceIndicator !== null);
    console.log(`  ${rated.length}/${listings.length} carry a price-indicator badge`);

    sampleAdvertId ??= listings[0]?.advertId ?? null;
  }

  const advertId: string | null = sampleAdvertId;
  if (advertId === null) {
    throw new Error('No listing available to test the detail page against');
  }

  console.log(`\nDetail page ${advertId}`);
  const detail = normaliseAdvert(extractAdvert(await fetchDetailPage(advertId)));
  check(detail.advertId === advertId, 'advert id round-trips');
  check(detail.make !== null, 'make extracted');
  check(detail.price !== null, 'price extracted');
  check(detail.transmission !== null, 'transmission extracted');
  check(detail.engineLitres !== null, 'engine size extracted');
  check(
    ['FULL', 'PART', 'NO_HISTORY', 'UNKNOWN'].includes(detail.serviceHistory),
    `service history recognised (${detail.serviceHistory})`,
  );
  check(
    ['PASSED', 'FAILED', 'UNKNOWN'].includes(detail.writeOff),
    `write-off check recognised (${detail.writeOff})`,
  );
  console.log(`  price indicator: ${detail.priceIndicator}`);

  console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSmoke run failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
