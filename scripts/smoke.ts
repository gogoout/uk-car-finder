/**
 * Live check against AutoTrader. Not part of `npm test` — it makes real
 * requests, so run it by hand when you suspect their schema has drifted.
 *
 *   npm run smoke
 *
 * Schema drift is this project's main long-term failure mode: the gateway
 * returns a GraphQL error naming the offending field, which this surfaces
 * verbatim so the query in src/autotrader/search.ts can be corrected.
 *
 * Deliberately NOT run in CI. It was tried as a post-deploy job and AutoTrader
 * returned HTTP 403 on the first request: they block GitHub Actions' shared IP
 * ranges. The identical commit passes from a laptop, so a CI job would fail on
 * every deploy while telling you nothing about your code.
 */

import { buildFilters } from '../src/autotrader/filters';
import { searchAll } from '../src/autotrader/search';
import { fetchDetailPage } from '../src/autotrader/gateway';
import { extractAdvert } from '../src/autotrader/detail';
import { normaliseAdvert } from '../src/autotrader/normalise';
import { fetchFacets } from '../src/autotrader/facets';
import type { Combo } from '../src/types';

const POSTCODE = process.env.SMOKE_POSTCODE ?? 'SW1A 1AA';

const COMBOS: Combo[] = [
  {
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
    },
  },
  {
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
  },
];

let failures = 0;

function check(condition: boolean, message: string): void {
  console.log(`${condition ? '  ✓' : '  ✗'} ${message}`);
  if (!condition) failures++;
}

/**
 * The filter editor is entirely driven by these, so a change here breaks the UI
 * far more visibly than a change to the search query.
 */
async function checkFacetCascade(): Promise<void> {
  console.log('\nFacet cascade');

  const optionsFor = (data: Awaited<ReturnType<typeof fetchFacets>>, facet: string): number =>
    data.facets[facet]?.filters[0]?.options.length ?? 0;

  const empty = await fetchFacets([]);
  check(empty.groups.length > 0, `facet groups returned (${empty.groups.length})`);
  check(optionsFor(empty, 'make') > 50, `make list populated (${optionsFor(empty, 'make')})`);
  check(optionsFor(empty, 'model') === 0, 'model is empty until a make is chosen');

  const withMake = await fetchFacets([{ filter: 'make', selected: ['MINI'] }]);
  check(optionsFor(withMake, 'model') > 0, `MINI unlocks models (${optionsFor(withMake, 'model')})`);

  const withModel = await fetchFacets([
    { filter: 'make', selected: ['MINI'] },
    { filter: 'model', selected: ['Cooper'] },
  ]);
  check(
    optionsFor(withModel, 'aggregated_trim') > 0,
    `MINI Cooper unlocks variants (${optionsFor(withModel, 'aggregated_trim')})`,
  );

  // Ranges must arrive as min/max pairs, or the editor renders them wrongly.
  const price = withModel.facets.price?.filters.map((f) => f.filter) ?? [];
  check(
    price.includes('min_price') && price.includes('max_price'),
    `price is a min/max pair (${price.join(', ')})`,
  );
}

async function main(): Promise<void> {
  let sampleAdvertId: string | null = null;
  let combosWithResults = 0;

  await checkFacetCascade();

  for (const combo of COMBOS) {
    console.log(`\n${combo.label}`);
    const filters = buildFilters(combo, { postcode: POSTCODE, radius: 200 });
    const { listings, totalResults, pagesFetched } = await searchAll(filters, { maxPages: 2 });

    console.log(`  ${totalResults} results across ${pagesFetched} page(s) fetched`);

    // A tightly-scoped combo legitimately returns nothing on a given day — cars
    // sell. Failing on that would make this script cry wolf and train us to
    // ignore it, which defeats the point. An empty *run* is the real signal.
    if (listings.length === 0) {
      console.log('  — no matches right now; skipping field checks');
      continue;
    }
    combosWithResults++;

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

  console.log('');
  // Every combo coming back empty is far more likely to be a broken query than
  // a genuinely empty market, so that does fail.
  check(combosWithResults > 0, 'at least one combo returned results');

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
