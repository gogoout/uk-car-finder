/**
 * Creates a test search, so you don't have to click through the editor to get
 * something on screen.
 *
 *   pnpm run seed                 # create the search
 *   pnpm run seed --refresh       # ...and run it against AutoTrader straight away
 *   pnpm run seed --url https://uk-car-finder.<you>.workers.dev
 *
 * Goes through the API rather than writing to D1 directly: it exercises the
 * same validation the browser does, works against a deployed Worker as well as
 * `pnpm run dev`, and avoids the SQLITE_BUSY you get from touching the local
 * database while wrangler holds it.
 */

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const BASE = (flag('url') ?? process.env.SEED_URL ?? 'http://localhost:8787').replace(/\/$/, '');
const POSTCODE = flag('postcode') ?? process.env.SEED_POSTCODE ?? 'SW1A 1AA';
const REFRESH = args.includes('--refresh');

/** The worked example this project was built around. */
const SEARCH = {
  name: 'Small autos',
  postcode: POSTCODE,
  radius: 200,
  combos: [
    {
      label: 'MINI Cooper 1.5 Auto',
      labelIsCustom: true,
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
        is_writeoff: ['exclude'],
      },
    },
    {
      label: 'Mazda2 1.5 Skyactiv-G Auto',
      labelIsCustom: true,
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
        is_writeoff: ['exclude'],
      },
    },
  ],
};

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await res.text();
  if (!res.ok) {
    // The API reports validation problems in `error`; surface it rather than a
    // bare status code.
    let detail = text.slice(0, 300);
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? detail;
    } catch {
      // Not JSON — the raw body is the best we have.
    }
    throw new Error(`POST ${path} failed (${res.status}): ${detail}`);
  }
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const search = await post<{ id: string; name: string; combos: unknown[] }>('/api/searches', SEARCH);

  console.log(`Created "${search.name}" with ${search.combos.length} combinations`);
  console.log(`  ${BASE}/s/${search.id}`);

  if (!REFRESH) {
    console.log('\nRun it with:');
    console.log(`  curl -X POST ${BASE}/api/searches/${search.id}/refresh`);
    console.log('  (or re-run this with --refresh)');
    return;
  }

  console.log('\nRunning it against AutoTrader…');
  const run = await post<Record<string, number>>(`/api/searches/${search.id}/refresh`);
  console.log(
    `  ${run.listingsSeen} matched, ${run.newCount} new, ` +
      `${run.rejectedCount} rejected as not actually matching`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\nSeed failed: ${message}`);
  if (/fetch failed|ECONNREFUSED/i.test(message)) {
    console.error(`Is the app running? Start it with \`pnpm run dev\`, or pass --url.`);
  }
  process.exit(1);
});
