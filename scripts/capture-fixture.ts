/**
 * Captures a test fixture from a live AutoTrader detail page.
 *
 *   pnpm run capture:fixture <advertId> [suffix]
 *
 * Only the `__staticRouterHydrationData` script is kept — that is the sole part
 * of the page our parser reads. The rest of a real page is ~200KB of adverts,
 * trackers and third-party config, which is not just dead weight: AutoTrader
 * embeds their own Google Maps API key in `AT_SPA_JS_CONFIG`, and committing a
 * whole page republishes it and trips secret scanners.
 *
 * Keep fixtures minimal by construction rather than remembering to scrub them.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchDetailPage } from '../src/autotrader/gateway';
import { extractHydrationData } from '../src/autotrader/detail';

const HYDRATION_RE =
  /window\.__staticRouterHydrationData\s*=\s*JSON\.parse\(\s*("(?:[^"\\]|\\.)*")\s*\)/;

/** Strips a full page down to the one script our parser needs. */
export function minimiseDetailPage(html: string, advertId: string): string {
  const match = html.match(HYDRATION_RE);
  if (!match?.[1]) {
    throw new Error('No __staticRouterHydrationData found — did the page layout change?');
  }

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    `  <title>AutoTrader fixture ${advertId}</title>`,
    '  <!-- Trimmed capture: only the hydration payload our parser reads is kept.',
    '       Regenerate with `pnpm run capture:fixture <advertId> [suffix]`. -->',
    '</head>',
    '<body>',
    `<script nonce="nocsp">window.__staticRouterHydrationData = JSON.parse(${match[1]});</script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const [advertId, suffix] = process.argv.slice(2);
  if (!advertId) {
    console.error('Usage: pnpm run capture:fixture <advertId> [suffix]');
    process.exit(1);
  }

  const minimal = minimiseDetailPage(await fetchDetailPage(advertId), advertId);

  // Fail loudly rather than write a fixture that a secret scanner will flag.
  const keyLike = minimal.match(/AIza[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}/);
  if (keyLike) throw new Error(`Refusing to write: fixture contains a key-like string ${keyLike[0]}`);

  const name = `car-details-${advertId}${suffix ? `-${suffix}` : ''}.html`;
  const path = join(import.meta.dirname, '..', 'test', 'fixtures', name);
  writeFileSync(path, minimal, 'utf8');

  // Prove the result is still parseable before declaring success.
  extractHydrationData(minimal);

  const kb = (minimal.length / 1024).toFixed(0);
  console.log(`Wrote test/fixtures/${name} (${kb}KB)`);
}

// Only run when invoked directly, so the transform can be unit-tested.
if (process.argv[1]?.endsWith('capture-fixture.ts')) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
